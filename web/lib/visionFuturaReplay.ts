// "Repetir sesión" de VisionFutura (Carlos, oct 2026: "reconstruir todo el
// día de hoy... como si el mercado hubiese abierto y poder ir viendo los
// cambios de imán, Magneto, todo eso, así sea en intervalos de 5 minutos").
//
// Reconstruye la última sesión disponible tick por tick (cada 5 min, 9:30 a
// 16:00 NY) SIN mirar el futuro: en cada tick solo se usan datos con hora ≤ t.
//
// Fuentes (MarketSnack):
//   - precio SPX y SPY: /chart (5 min) — real
//   - Magneto, Call/Put Wall, flip, max pain: gex_stats_chart (último bucket ≤ t) — real
//   - VIX y Magneto VIX: /chart y gex_stats_chart de VIX — real
//   - flujo por strike (dealers, posicionamiento, agresor): trade_summaries de
//     cada contrato SPXW del día, sumando solo buckets cerrados antes de t — real
//   - GEX por strike (imanes ±, resistencias/pisos secundarios, charm): el
//     open interest real del día (option_chain_extended del vencimiento) con
//     gamma ESTIMADA por Black-Scholes usando el VIX del tick como IV (no hay
//     historial de gamma intradía; después del vencimiento la cadena ya no trae
//     greeks reales).
//   - /ES: no hay historial intradía → sin conversión a /ES en la repetición.
//
// Las alertas se evalúan con el mismo motor de pantalla (visionFuturaAlerts.ts)
// y el mismo cooldown, en memoria — no tocan el estado de las alertas en vivo.
// Resultado cacheado en data/vision-futura/replay-{fecha}.json.

import { runMoneySession, type MoneyReading, type MoneyTrade } from "./visionFuturaMoneyFlow";
import { evaluateLottos, lottoPnlAtExpiry, lottoTradeFrom, LOTTO_TUNING, nyHm, type LottoIdea, type LottoQuote, type LottoTrade } from "./visionFuturaLottos";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildVisionFutura, yearsToExpiry, type VisionFuturaReport, type VixReading } from "./visionFutura";
import { evaluateVisionAlerts, type VisionAlert } from "./visionFuturaAlerts";
import { fetchAssetPriceChart, fetchContractTradeSummary, fetchGexStats, fetchOptionChainExtended } from "./marketsnack";
import { fetchMacroQuote, fetchUnderlyingQuote } from "./tastytrade";
import {
  instrumentOf, labelsOf, REL_VOL, scaleFor, strikeStepNear,
  type InstrumentId, type InstrumentLabels,
} from "./visionFuturaInstruments";
import { bsDelta, bsGamma, bsPrice } from "./blackScholes";
import { buildSpreads, spreadPnlAtExpiry, spreadsForAlert, type SpreadIdea, type SpreadQuoteRow } from "./visionFuturaSpreads";
import { buildOccSymbol, marketDateStr } from "./occ";
import { isMarketOpen } from "./marketHours";
import type { ExtendedChainContract } from "./spxLevels";

const FIVE_MIN = 5 * 60_000;
const COOLDOWN_MS = 20 * 60_000;
const RADIUS = 60;
/** Subir cuando cambie el motor de alertas o el formato: invalida los caches viejos. */
const REPLAY_VERSION = 12;
const DIR = join(process.cwd(), "data", "vision-futura");

export interface ReplayAlert extends VisionAlert {
  firedAt: number;
  lastSeenAt: number;
}

export interface ReplayTick extends VisionFuturaReport {
  /** Lottos al cierre: mejores candidatos de este momento (desde las 15:00). */
  lottos?: LottoIdea[];
  /** Señal del dinero: lectura de este momento (desde las 9:45). */
  money?: MoneyReading;
  /** Hora del tick (segundos unix). */
  time: number;
  gexAsOf: string | null;
  vixMagnet: number | null;
  /** Ids de alertas que se cumplían en este tick. */
  activeIds: string[];
  watch: VisionAlert[];
}

/**
 * Spread "ejecutado" por una alerta en la repetición (backtest de spreads):
 * se abre al precio de ese momento y se mantiene hasta el vencimiento (16:00).
 */
export interface ReplaySpreadTrade {
  id: string;
  alertId: string;
  alertTitle: string;
  direction: "alcista" | "bajista";
  /** "credito" = prima con alta probabilidad; "debito" = direccional hacia el objetivo. */
  kind: "credito" | "debito";
  openedAt: number;
  spotAtOpen: number;
  idea: SpreadIdea;
  /** De dónde salió el precio de cada pata: llenado real promedio de MarketSnack o teórico. */
  legSources: ("real" | "estimado")[];
  /** Precio de liquidación (cierre del subyacente) — null si la sesión sigue en curso. */
  settle: number | null;
  /** Resultado por acción al vencimiento (×100 = $). */
  pnl: number | null;
  pnlUsd: number | null;
}

export interface ReplayPayload {
  version: number;
  instrument: InstrumentId;
  labels: InstrumentLabels;
  /** Escala de los umbrales usada (1 = SPX). */
  scale: number;
  /** IV del instrumento ÷ VIX usada para la gamma estimada (congelada junto con `scale`). */
  ivRel?: number;
  strikeStep: number;
  /** Vencimiento de las opciones usado (TSLA no vence todos los días). */
  expiration: string;
  date: string;
  builtAt: string;
  /** La sesión todavía está en curso (la repetición llega hasta ahora). */
  partial: boolean;
  radius: number;
  priceSeries: { time: number; value: number }[];
  history: { time: number; magnet: number; callWall: number; putWall: number; gammaFlip: number | null; maxPain: number }[];
  ticks: ReplayTick[];
  alerts: ReplayAlert[];
  spreadTrades: ReplaySpreadTrade[];
  /** Lottos "comprados" en las lecturas de 15:00/15:15/15:30/15:45 (solo con precio real). */
  lottoTrades?: LottoTrade[];
  /** Señales del dinero (long/short con objetivo y stop) del día, ya simuladas. */
  moneyTrades?: MoneyTrade[];
  notes: string[];
}

const nyDate = (ms: number) => marketDateStr(new Date(ms));
const nyMinutes = (ms: number) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  const h = Number(p.find((x) => x.type === "hour")?.value) % 24;
  const m = Number(p.find((x) => x.type === "minute")?.value);
  return h * 60 + m;
};
const isRth = (ms: number) => { const m = nyMinutes(ms); return m >= 9 * 60 + 30 && m <= 16 * 60; };
const latestAtOrBefore = <T extends { ms: number }>(arr: T[], ms: number): T | null => {
  let r: T | null = null;
  for (const x of arr) { if (x.ms <= ms) r = x; else break; }
  return r;
};

/** Archivo de la repetición guardada (SPX conserva el nombre original). */
export const replayFileName = (inst: string, date: string) => (inst === "SPX" ? `replay-${date}.json` : `replay-${inst}-${date}.json`);

export async function buildReplay(now: Date, opts: { force?: boolean; inst?: string } = {}): Promise<ReplayPayload> {
  const cfg = instrumentOf(opts.inst);
  // Precio del día: el del instrumento o, si MarketSnack no tiene su gráfica (NDX), la del ETF.
  const [mainChartRaw, etfChart, vixChart, gexRaw, vixGexRaw, spxChartRef] = await Promise.all([
    cfg.chartFromEtf ? Promise.resolve([]) : fetchAssetPriceChart(cfg.msTicker),
    cfg.etf ? fetchAssetPriceChart(cfg.etf).catch(() => []) : Promise.resolve([]),
    fetchAssetPriceChart("VIX").catch(() => []),
    fetchGexStats(cfg.msTicker, { period: "1d" }),
    fetchGexStats("VIX", { period: "1d" }).catch(() => []),
    cfg.id === "SPX" ? Promise.resolve([]) : fetchAssetPriceChart("SPX").catch(() => []),
  ]);
  const baseChart = cfg.chartFromEtf ? etfChart : mainChartRaw;
  if (baseChart.length === 0) throw new Error(`MarketSnack no devolvió el precio intradía de ${cfg.chartFromEtf ? cfg.etf : cfg.main}.`);

  // Último día con sesión regular en la gráfica (la de un ETF trae también pre/post-market).
  const rthDays = [...new Set(baseChart.map((p) => Date.parse(p.t)).filter((ms) => isRth(ms)).map((ms) => nyDate(ms)))].sort();
  const date = rthDays.at(-1) ?? nyDate(Date.parse(baseChart[baseChart.length - 1].t));
  const partial = date === marketDateStr(now) && isMarketOpen(now);
  const cacheFile = join(DIR, replayFileName(cfg.id, date));
  let previous: ReplayPayload | null = null;
  try { previous = JSON.parse(readFileSync(cacheFile, "utf8")) as ReplayPayload; } catch { /* sin cache */ }
  if (!opts.force && previous) {
    // Sesión cerrada: el cache sirve para siempre. En curso: 5 min.
    const fresh = !previous.partial || now.getTime() - Date.parse(previous.builtAt) < FIVE_MIN;
    if (previous.version === REPLAY_VERSION && fresh) return previous;
  }

  const sameDay = <T extends { t: string }>(arr: T[]) =>
    arr.map((x) => ({ ...x, ms: Date.parse(x.t) })).filter((x) => nyDate(x.ms) === date).sort((a, b) => a.ms - b.ms);
  const etf = sameDay(etfChart);
  const vix = sameDay(vixChart);
  const gex = sameDay(gexRaw);
  const vixGex = sameDay(vixGexRaw);

  // NDX = QQQ × (NDX al cierre ÷ QQQ al cierre): aproximado (MarketSnack no tiene la gráfica del NDX).
  let spx: { ms: number; v: number; t: string }[];
  if (cfg.chartFromEtf) {
    const etfRth = etf.filter((p) => isRth(p.ms));
    const mainClose = await fetchUnderlyingQuote(cfg.main, !!cfg.tastyMain.index).catch(() => null);
    const etfClose = etfRth.at(-1)?.v ?? null;
    if (!mainClose || !etfClose) throw new Error(`No se pudo convertir ${cfg.etf} a ${cfg.main}.`);
    const ratio = mainClose / etfClose;
    spx = etfRth.map((p) => ({ ...p, v: Math.round(p.v * ratio * 100) / 100 }));
  } else {
    spx = sameDay(mainChartRaw).filter((p) => isRth(p.ms));
  }
  if (spx.length === 0) throw new Error(`Sin precio de la sesión ${date} para ${cfg.main}.`);
  const spxRefClose = cfg.id === "SPX" ? null : sameDay(spxChartRef).filter((p) => isRth(p.ms)).at(-1)?.v ?? null;

  // Cierre previo del VIX (solo si se repite el día de hoy; si no, % desde la apertura).
  let vixPrevClose: number | null = null;
  if (date === marketDateStr(now)) vixPrevClose = (await fetchMacroQuote({ index: "VIX" }).catch(() => null))?.prevClose ?? null;
  const vixOpen = latestAtOrBefore(vix, spx[0].ms)?.v ?? vix[0]?.v ?? null;

  // Vencimiento: el del día si existe (0DTE); si no (TSLA no vence todos los días), el siguiente.
  // MarketSnack deja de devolver la cadena de un vencimiento pocas horas después de vencer (visto
  // el 2026-10-22: SPX disponible esa noche, ya no a la mañana siguiente). Por eso la primera vez
  // que se consigue se guarda una copia (strike, tipo, OI, IV) y se reusa al reconstruir.
  let expiration = date;
  let chain: ExtendedChainContract[] = [];
  for (let i = 0; i <= 6; i++) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const exp = d.toISOString().slice(0, 10);
    const c = (await fetchOptionChainExtended(cfg.msTicker, exp).catch(() => [] as ExtendedChainContract[]));
    const got = c.length > 0 ? c : loadChainSnapshot(cfg.id, exp);
    if (got.length > 0) {
      expiration = exp;
      chain = got;
      if (c.length > 0) saveChainSnapshot(cfg.id, exp, c);
      break;
    }
  }
  // Con vencimientos diarios (SPX, NDX) el 0DTE del día SIEMPRE existe aunque MarketSnack ya no
  // devuelva su cadena (pasa con NDX después de vencer): se usan sus contratos igual — el flujo por
  // contrato sí sigue disponible — con strikes sintéticos al paso de la cadena siguiente y sin OI.
  let chainMissing = false;
  if (expiration !== date && cfg.dailyExpirations) {
    chainMissing = true;
    expiration = date;
  }
  const expiresToday = expiration === date;

  // Escala del instrumento (SPX = 1) y volatilidad para la gamma estimada.
  const closeMain = spx[spx.length - 1].v;
  const vixClose = vix.filter((p) => isRth(p.ms)).at(-1)?.v ?? 18;
  const atmIvChain = (() => {
    const ks = [...new Set(chain.map((c) => c.strike))].sort((a, b) => Math.abs(a - closeMain) - Math.abs(b - closeMain)).slice(0, 2);
    const ivs = chain.filter((c) => ks.includes(c.strike) && c.implied_volatility && c.implied_volatility > 0.05 && c.implied_volatility < 3).map((c) => c.implied_volatility!);
    return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  })();
  // Escala e IV relativa CONGELADAS por día: la primera repetición de la sesión las fija y cada
  // reconstrucción las reusa. Si no, cambian según la hora en que se reconstruye (visto con TSLA el
  // 23-oct: 0.208 a las 7:36 pm → 0.112 a las 11:35 pm, porque la cadena ya vencida trae una IV basura)
  // y el backtest del día se mueve solo. Repeticiones viejas sin `ivRel`: se lee de sus notas.
  const frozen = previous && previous.date === date && (previous.instrument ?? "SPX") === cfg.id ? previous : null;
  const frozenIvRel = frozen?.ivRel ?? (() => {
    const m = frozen?.notes?.map((n) => /IV = VIX × ([\d.]+)/.exec(n)).find(Boolean);
    return m ? Number(m[1]) : frozen && frozen.notes?.some((n) => n.includes("(IV = VIX).")) ? 1 : null;
  })();
  const scale = frozen?.scale ?? scaleFor(cfg, closeMain, { spxSpot: spxRefClose, vix: vixClose, atmIv: atmIvChain });
  // IV del instrumento relativa al VIX (para la gamma de Black-Scholes en cada momento):
  // SPX 1; NQ 1.2; acciones: su IV ATM ÷ VIX (si la cadena trae una IV razonable), si no 3.
  const ivRel = frozenIvRel ?? (cfg.id === "SPX" ? 1 : REL_VOL[cfg.id] ?? (atmIvChain && atmIvChain !== 20 ? atmIvChain / (vixClose / 100) : 3));

  // Open interest real del día (al inicio de la sesión, no cambia intradía).
  const oi = new Map<string, number>();
  for (const c of chain) oi.set(`${c.type}:${c.strike}`, c.open_interest || 0);

  // Flujo por contrato, cada 5 min: los strikes reales de la cadena dentro del rango del día ± la ventana.
  const prices = spx.map((p) => p.v);
  const strikeStep = cfg.id === "SPX" ? 5 : strikeStepNear(chain.map((c) => c.strike), closeMain);
  if (chainMissing) { chain = []; oi.clear(); } // era la cadena de otro vencimiento: solo servía para el paso de strike
  const radius = cfg.id === "SPX" ? RADIUS : 20 * strikeStep;
  const lo = Math.min(...prices) - radius, hi = Math.max(...prices) + radius;
  const strikes: number[] = cfg.id === "SPX" || chainMissing
    ? (() => { const out: number[] = []; for (let k = Math.floor(lo / strikeStep) * strikeStep; k <= Math.ceil(hi / strikeStep) * strikeStep; k += strikeStep) out.push(k); return out; })()
    : [...new Set(chain.map((c) => c.strike))].filter((k) => k >= lo && k <= hi).sort((a, b) => a - b);
  const flow = new Map<string, { ms: number; ask: number; bid: number; askVol: number; bidVol: number; vol: number }[]>();
  const jobs = strikes.flatMap((s) => (["call", "put"] as const).map((type) => ({ s, type })));
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map(async ({ s, type }) => {
      const sym = buildOccSymbol({ underlying: cfg.occRoot, expiration, type, strike: s });
      const b = await fetchContractTradeSummary(sym).catch(() => []);
      flow.set(`${type}:${s}`, b.map((x) => ({
        ms: Date.parse(x.t), ask: x.ask_premium || 0, bid: x.bid_premium || 0,
        askVol: x.ask_volume || 0, bidVol: x.bid_volume || 0,
        vol: (x.ask_volume || 0) + (x.bid_volume || 0) + (x.mid_volume || 0),
      })));
    }));
  }
  const cumulative = (key: string, beforeMs: number) => {
    let ask = 0, bid = 0, vol = 0;
    for (const b of flow.get(key) ?? []) if (b.ms < beforeMs) { ask += b.ask; bid += b.bid; vol += b.vol; }
    return { ask, bid, vol };
  };

  // Precio de un contrato a la hora T para los spreads: el precio PROMEDIO al
  // que se llenó realmente cada lado en el último bloque de 5 min con
  // operaciones de ese lado (ask_premium / ask_volume / 100, idem bid), dentro
  // de los últimos 15 min. Sin operaciones → Black-Scholes con el VIX como IV,
  // ± un medio-spread, marcado "estimado".
  const QUOTE_WINDOW = 15 * 60_000;
  const quoteAt = (type: "call" | "put", strike: number, T: number, spot: number, years: number, iv: number) => {
    let ask: number | null = null, bid: number | null = null;
    for (const b of flow.get(`${type}:${strike}`) ?? []) {
      if (b.ms >= T || b.ms < T - QUOTE_WINDOW) continue;
      if (b.askVol > 0) ask = b.ask / (b.askVol * 100);
      if (b.bidVol > 0) bid = b.bid / (b.bidVol * 100);
    }
    // Los promedios de cada lado son de momentos distintos y pueden cruzarse: el menor es el bid.
    if (ask != null && bid != null && ask < bid) { const lo = ask; ask = bid; bid = lo; }
    const real = ask != null && bid != null && ask > 0 && bid > 0;
    if (!real) {
      const theo = bsPrice(spot, strike, years, iv, type);
      const half = Math.max(0.05, theo * 0.03);
      ask = Math.max(0.05, theo + half);
      bid = Math.max(0, theo - half);
    }
    return { bid: Math.round(bid! * 100) / 100, ask: Math.round(ask! * 100) / 100, real };
  };
  const spreadTrades: ReplaySpreadTrade[] = [];
  const lottoTrades: LottoTrade[] = [];
  // Flujo direccional acumulado hasta T: Σ net premium de calls − Σ net premium de puts (todos los strikes).
  const dirFlow = (beforeMs: number) => {
    let v = 0;
    for (const s of strikes) {
      const c = cumulative(`call:${s}`, beforeMs), q = cumulative(`put:${s}`, beforeMs);
      v += (c.ask - c.bid) - (q.ask - q.bid);
    }
    return v;
  };
  const LOTTO_FROM = 15 * 60;

  const ticks: ReplayTick[] = [];
  const fired: ReplayAlert[] = [];
  let lastFlip: number | null = null;

  for (const p of spx) {
    const T = p.ms;
    const g = latestAtOrBefore(gex, T);
    for (const b of gex) { if (b.ms > T) break; if (b.gamma_flip != null) lastFlip = b.gamma_flip; }
    const gexStats = g ? { ...g, gamma_flip: g.gamma_flip ?? lastFlip, asset_price: p.v } : null;
    const vixNow = latestAtOrBefore(vix, T)?.v ?? null;
    const iv = (vixNow != null && vixNow > 0 ? vixNow / 100 : 0.18) * ivRel;
    const years = yearsToExpiry(expiration, new Date(T));
    const spyNow = cfg.etf ? latestAtOrBefore(etf, T)?.v ?? null : null;

    const contracts: ExtendedChainContract[] = [];
    const aggNow = new Map<number, { compras: number; ventas: number }>();
    const aggPrev = new Map<number, { compras: number; ventas: number }>();
    for (const s of strikes) {
      let cN = 0, vN = 0, cP = 0, vP = 0;
      for (const type of ["call", "put"] as const) {
        const now5 = cumulative(`${type}:${s}`, T);
        const prev5 = cumulative(`${type}:${s}`, T - FIVE_MIN);
        cN += now5.ask; vN += now5.bid; cP += prev5.ask; vP += prev5.bid;
        contracts.push({
          symbol: "", strike: s, type, expiration,
          open_interest: oi.get(`${type}:${s}`) ?? 0, volume: now5.vol, price: null,
          greeks: { delta: 0, gamma: bsGamma(p.v, s, years, iv), theta: 0, vega: 0 },
          implied_volatility: iv,
          premium_breakdown: { bid: now5.bid, mid: 0, ask: now5.ask },
        });
      }
      aggNow.set(s, { compras: cN, ventas: vN });
      aggPrev.set(s, { compras: cP, ventas: vP });
    }

    const vixReading: VixReading | null = vixNow != null
      ? (() => {
          const base = vixPrevClose ?? vixOpen;
          return { last: vixNow, prevClose: base ?? vixNow, changePct: base ? ((vixNow - base) / base) * 100 : 0 };
        })()
      : null;
    const report = buildVisionFutura({
      contracts, spot: p.v, gexStats, spy: spyNow, es: null, vix: vixReading, radius, strikeStep, yearsToExpiry: years,
    });
    const vixMagnet = cfg.id === "SPX" ? latestAtOrBefore(vixGex, T)?.magnet ?? null : null;

    const ev = evaluateVisionAlerts({
      now: T, spot: p.v, conversion: report.conversion,
      keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, rows: report.rows, regime: report.regime,
      prices: spx.filter((x) => x.ms <= T).map((x) => ({ t: x.ms, v: x.v })),
      vix: vix.filter((x) => x.ms <= T).map((x) => ({ t: x.ms, v: x.v })),
      vixMagnet, aggressorNow: aggNow, aggressorPrev: aggPrev,
      scale,
      instrumentos: cfg.etf || cfg.future
        ? { largo: `Calls de ${cfg.main}${cfg.etf ? `/${cfg.etf}` : ""}`, corto: `Puts de ${cfg.main}${cfg.etf ? `/${cfg.etf}` : ""}` }
        : { largo: `Comprar ${cfg.main} (acciones o calls)`, corto: `Vender ${cfg.main} (acciones o puts)` },
      recentFired: fired,
    });
    const activeIds: string[] = [];
    for (const a of ev.filter((x) => x.fires)) {
      activeIds.push(a.id);
      const existing = fired.find((f) => f.id === a.id && T - f.lastSeenAt < COOLDOWN_MS);
      if (existing) existing.lastSeenAt = T;
      else {
        fired.push({ ...a, firedAt: T, lastSeenAt: T });
        // Alerta nueva → se "ejecutan" sus spreads con los precios de este momento.
        const sources = new Map<string, boolean>();
        const qRows: SpreadQuoteRow[] = [];
        for (const s of strikes) {
          for (const type of ["call", "put"] as const) {
            const q = quoteAt(type, s, T, p.v, years, iv);
            sources.set(`${type}:${s}`, q.real);
            // Solo precios reales para EJECUTAR: una pata sin operaciones queda sin bid/ask y ese
            // spread no se arma (mezclar una pata real con una teórica da créditos imposibles —
            // visto en NDX el 2026-10-22: $17.71 de crédito en un spread de 20 pts).
            qRows.push({ type, strike: s, bid: q.real && q.bid > 0 ? q.bid : null, ask: q.real ? q.ask : null, delta: bsDelta(p.v, s, years, iv, type), iv, openInterest: oi.get(`${type}:${s}`) ?? 0, volume: 0 });
          }
        }
        const sp = buildSpreads({
          rows: qRows, spot: p.v, days: years * 365,
          keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, expectedMove: report.expectedMove, fallbackIv: iv,
          scale,
          widths: cfg.id === "SPX" ? [5, 10] : [...new Set([5 * scale, 10 * scale].map((w) => Math.max(strikeStep, Math.round(w / strikeStep) * strikeStep)))],
        });
        const picked = spreadsForAlert(sp, a);
        for (const [kind, idea] of [["credito", picked.credit], ["debito", picked.debit]] as const) {
          if (!idea) continue;
          spreadTrades.push({
            id: `${a.id}@${T}:${idea.id}`, alertId: a.id, alertTitle: a.title, direction: a.direction, kind,
            openedAt: T, spotAtOpen: p.v, idea,
            legSources: idea.legs.map((l) => (sources.get(`${l.type}:${l.strike}`) ? "real" : "estimado")),
            settle: null, pnl: null, pnlUsd: null,
          });
        }
      }
    }
    const watch = ev.filter((a) => !a.fires)
      .sort((a, b) => b.score - a.score || Math.abs(a.level.spx - a.price.spx) - Math.abs(b.level.spx - b.price.spx))
      .slice(0, 4);

    // Lottos al cierre (solo con opciones que vencen hoy): candidatos desde las 15:00; en cada
    // lectura se "compra" el mejor que cumpla, con el precio real de llenado.
    let lottos: LottoIdea[] | undefined;
    if (expiresToday && nyMinutes(T) >= LOTTO_FROM && nyMinutes(T) < 16 * 60) {
      const ago = latestAtOrBefore(spx, T - 15 * 60_000);
      const lq: LottoQuote[] = [];
      for (const s of strikes) for (const type of ["call", "put"] as const) {
        const q = quoteAt(type, s, T, p.v, years, iv);
        if (q.real) lq.push({ type, strike: s, bid: q.bid, ask: q.ask, real: true });
      }
      const ideas = evaluateLottos({
        now: T, spot: p.v, keyLevels: report.keyLevels, regime: report.regime, vix: vixNow != null ? vixNow * ivRel : null,
        priceAgo15: ago && ago.ms < T ? ago.v : null, flowChange15: dirFlow(T) - dirFlow(T - 15 * 60_000), quotes: lq, scale,
      });
      lottos = ideas.slice(0, 3);
      if ((LOTTO_TUNING.lecturas as readonly string[]).includes(nyHm(T))) {
        const tr = ideas[0] ? lottoTradeFrom(ideas[0], T, p.v) : null;
        if (tr) lottoTrades.push(tr);
      }
    }

    ticks.push({ ...report, time: Math.floor(T / 1000), gexAsOf: g?.t ?? null, vixMagnet, activeIds, watch, ...(lottos ? { lottos } : {}) });
  }

  // Resultado: si las opciones vencen hoy (0DTE), valor intrínseco al cierre. Si no (TSLA en un
  // día sin vencimiento), valor de mercado al cierre: recomprar lo vendido al ask y vender lo
  // comprado al bid, con los llenados reales de los últimos 15 min (o teórico si no hubo).
  if (!partial && spx.length > 0) {
    const last = spx[spx.length - 1];
    const settle = last.v;
    const closeT = last.ms + 1;
    const yearsClose = yearsToExpiry(expiration, new Date(last.ms));
    const ivClose = (vixClose / 100) * ivRel;
    for (const t of spreadTrades) {
      t.settle = settle;
      if (expiresToday) t.pnl = spreadPnlAtExpiry(t.idea, settle);
      else {
        let v = t.idea.netPrice;
        for (const l of t.idea.legs) {
          const q = quoteAt(l.type, l.strike, closeT, settle, yearsClose, ivClose);
          v += l.action === "COMPRAR" ? q.bid : -q.ask;
        }
        t.pnl = Math.round(v * 100) / 100;
      }
      t.pnlUsd = Math.round(t.pnl * 100);
    }
    for (const t of lottoTrades) {
      t.settle = settle;
      t.pnlUsd = lottoPnlAtExpiry(t, settle);
      // Mejor venta posible después de la compra: el promedio real de llenado al bid más alto.
      let best: { price: number; at: number } | null = null;
      for (const b of flow.get(`${t.side}:${t.strike}`) ?? []) {
        if (b.ms < t.openedAt || b.bidVol <= 0) continue;
        const px = Math.round((b.bid / (b.bidVol * 100)) * 100) / 100;
        if (!best || px > best.price) best = { price: px, at: b.ms };
      }
      t.bestExit = best;
    }
  }

  // Señal del dinero: lectura en cada paso y operaciones simuladas sobre el precio real de 5 min.
  const moneyRun = runMoneySession(
    ticks.map((tk) => ({ t: tk.time * 1000, spot: tk.spot.spx, keyLevels: tk.keyLevels, rows: tk.rows })),
    spx.map((p) => ({ t: p.ms, v: p.v })), scale, !partial,
  );
  ticks.forEach((tk, i) => { const rd = moneyRun.readings[i]; if (rd) tk.money = rd; });

  const payload: ReplayPayload = {
    version: REPLAY_VERSION,
    instrument: cfg.id,
    labels: { ...labelsOf(cfg), future: null },
    scale,
    ivRel,
    strikeStep,
    expiration,
    date,
    builtAt: now.toISOString(),
    partial,
    radius,
    priceSeries: spx.map((p) => ({ time: Math.floor(p.ms / 1000), value: p.v })),
    history: gex.map((b) => ({
      time: Math.floor(b.ms / 1000), magnet: b.magnet, callWall: b.call_wall, putWall: b.put_wall,
      gammaFlip: b.gamma_flip, maxPain: b.max_pain,
    })),
    ticks,
    alerts: fired,
    spreadTrades,
    lottoTrades,
    moneyTrades: moneyRun.trades,
    notes: [
      `Magneto, paredes, flip, max pain, VIX y flujo por strike: datos reales de MarketSnack de cada momento (${cfg.main}).`,
      cfg.chartFromEtf
        ? `Precio de ${cfg.main}: ${cfg.etf} de MarketSnack × (${cfg.main} ÷ ${cfg.etf} al cierre) — aproximado (MarketSnack no tiene la gráfica intradía de ${cfg.main}).`
        : `Precio de ${cfg.main}: real, cada 5 min (MarketSnack).`,
      `Imanes ±, resistencias/pisos secundarios y charm: estimados con el open interest real y gamma de Black-Scholes (IV = VIX${ivRel !== 1 ? ` × ${ivRel.toFixed(2)}` : ""}).`,
      cfg.future ? `Sin ${cfg.future === "ES" ? "/ES" : `/${cfg.future}`} en la repetición: no hay historial intradía del futuro.` : "Acción: sin conversiones.",
      expiresToday ? `Opciones del vencimiento ${expiration} (vencen ese día).` : `Opciones del vencimiento ${expiration}: no vencen ese día, los spreads se valúan al precio de cierre del día.`,
      cfg.id === "SPX" ? "Umbrales de SPX (escala 1)." : `Umbrales escalados ×${scale.toFixed(2)} respecto a SPX.`,
      ...(chainMissing ? [`MarketSnack ya no devuelve la cadena de ${cfg.main} de ${date} (venció): se usan sus contratos 0DTE con el flujo real, pero sin open interest — no hay imanes ±, resistencias/pisos secundarios ni charm; sí Magneto, paredes, flip y max pain.`] : []),
      "Spreads: solo se ejecutan si las DOS patas tuvieron operaciones reales en los últimos 15 min (precio = promedio real de llenado en MarketSnack); se mantienen hasta el vencimiento (o se valúan al cierre si no vencen ese día).",
      "Lottos al cierre: lecturas 15:00/15:15/15:30/15:45 con la regla de lib/visionFuturaLottos.ts; prima = promedio real de llenado al ask; se sostienen al vencimiento. 'Mejor venta' = el promedio de llenado al bid más alto después de la compra.",
      "Señal del dinero: lib/visionFuturaMoneyFlow.ts (Magneto, apuestas del día, dinero nuevo de 15 min, barra más grande); una operación a la vez; stop/objetivo sobre el precio de 5 min (si caen en el mismo intervalo cuenta el stop).",
      "Resolución de 5 minutos.",
    ],
  };
  // Nunca reemplazar una repetición que se armó CON la cadena (OI) por una que ya no la tiene:
  // se conserva la anterior (aunque sea de una versión vieja del motor).
  const hadOi = (r: ReplayPayload) => r.ticks.some((t) => t.rows.some((row) => row.netGex !== 0));
  if (chainMissing && previous && hadOi(previous) && !hadOi(payload)) return previous;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(payload), "utf8");
  } catch { /* sin cache en disco: igual se devuelve */ }
  return payload;
}

// ── Copia de la cadena (OI/IV) de cada vencimiento ──
const CHAIN_DIR = join(DIR, "chains");

/**
 * Copia de la cadena DURANTE el día, para que la repetición tenga OI (y gamma por
 * strike) aunque se arme después de que MarketSnack borre el vencimiento. Pasó con
 * NDX el 2026-10-22: la repetición se armó tarde y salió sin GEX por strike.
 * Se llama desde cada carga de VisionFutura (cualquier instrumento); como mucho
 * una vez cada 30 min, y solo de 9 am a 11 pm NY entre semana.
 */
let lastCapture = 0;
export async function captureChainsForReplay(now: Date): Promise<void> {
  if (now.getTime() - lastCapture < 30 * 60_000) return;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const wd = p.find((x) => x.type === "weekday")?.value ?? "";
  const hr = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  if (wd === "Sat" || wd === "Sun" || hr < 9 || hr >= 23) return;
  lastCapture = now.getTime();
  const date = marketDateStr(now);
  for (const cfg of [instrumentOf("SPX"), instrumentOf("NQ"), instrumentOf("TSLA")]) {
    // Mismo vencimiento que buscará la repetición: el primero desde hoy que tenga cadena.
    for (let i = 0; i <= 6; i++) {
      const d = new Date(`${date}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const exp = d.toISOString().slice(0, 10);
      const c = await fetchOptionChainExtended(cfg.msTicker, exp).catch(() => [] as ExtendedChainContract[]);
      if (c.length === 0) continue;
      if (c.some((x) => x.open_interest > 0)) saveChainSnapshot(cfg.id, exp, c);
      break;
    }
  }
}

function saveChainSnapshot(inst: string, exp: string, c: ExtendedChainContract[]) {
  try {
    mkdirSync(CHAIN_DIR, { recursive: true });
    const slim = c.map((x) => ({ strike: x.strike, type: x.type, open_interest: x.open_interest, implied_volatility: x.implied_volatility }));
    writeFileSync(join(CHAIN_DIR, `${inst}-${exp}.json`), JSON.stringify(slim), "utf8");
  } catch { /* no crítico */ }
}
function loadChainSnapshot(inst: string, exp: string): ExtendedChainContract[] {
  try {
    const slim = JSON.parse(readFileSync(join(CHAIN_DIR, `${inst}-${exp}.json`), "utf8")) as { strike: number; type: "call" | "put"; open_interest: number; implied_volatility: number | null }[];
    return slim.map((x) => ({
      symbol: "", strike: x.strike, type: x.type, expiration: exp, open_interest: x.open_interest, volume: 0, price: null,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 }, implied_volatility: x.implied_volatility,
      premium_breakdown: { bid: 0, mid: 0, ask: 0 },
    }));
  } catch {
    return [];
  }
}
