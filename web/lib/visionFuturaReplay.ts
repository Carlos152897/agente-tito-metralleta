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

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildVisionFutura, yearsToExpiry, type VisionFuturaReport, type VixReading } from "./visionFutura";
import { evaluateVisionAlerts, type VisionAlert } from "./visionFuturaAlerts";
import { fetchAssetPriceChart, fetchContractTradeSummary, fetchGexStats, fetchOptionChainExtended } from "./marketsnack";
import { fetchMacroQuote } from "./tastytrade";
import { bsDelta, bsGamma, bsPrice } from "./blackScholes";
import { buildSpreads, spreadPnlAtExpiry, spreadsForAlert, type SpreadIdea, type SpreadQuoteRow } from "./visionFuturaSpreads";
import { buildOccSymbol, marketDateStr } from "./occ";
import { isMarketOpen } from "./marketHours";
import type { ExtendedChainContract } from "./spxLevels";

const FIVE_MIN = 5 * 60_000;
const COOLDOWN_MS = 20 * 60_000;
const RADIUS = 60;
/** Subir cuando cambie el motor de alertas o el formato: invalida los caches viejos. */
const REPLAY_VERSION = 6;
const DIR = join(process.cwd(), "data", "vision-futura");

export interface ReplayAlert extends VisionAlert {
  firedAt: number;
  lastSeenAt: number;
}

export interface ReplayTick extends VisionFuturaReport {
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
  /** Precio de liquidación (cierre del SPX) — null si la sesión sigue en curso. */
  settle: number | null;
  /** Resultado por acción al vencimiento (×100 = $). */
  pnl: number | null;
  pnlUsd: number | null;
}

export interface ReplayPayload {
  version: number;
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

export async function buildReplay(now: Date, opts: { force?: boolean } = {}): Promise<ReplayPayload> {
  const [spxChart, spyChart, vixChart, gexRaw, vixGexRaw] = await Promise.all([
    fetchAssetPriceChart("SPX"),
    fetchAssetPriceChart("SPY").catch(() => []),
    fetchAssetPriceChart("VIX").catch(() => []),
    fetchGexStats("SPX", { period: "1d" }),
    fetchGexStats("VIX", { period: "1d" }).catch(() => []),
  ]);
  if (spxChart.length === 0) throw new Error("MarketSnack no devolvió el precio intradía de SPX.");

  const lastMs = Date.parse(spxChart[spxChart.length - 1].t);
  const date = nyDate(lastMs);
  const partial = date === marketDateStr(now) && isMarketOpen(now);
  const cacheFile = join(DIR, `replay-${date}.json`);
  if (!opts.force) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as ReplayPayload;
      // Sesión cerrada: el cache sirve para siempre. En curso: 5 min.
      const fresh = !cached.partial || now.getTime() - Date.parse(cached.builtAt) < FIVE_MIN;
      if (cached.version === REPLAY_VERSION && fresh) return cached;
    } catch { /* sin cache */ }
  }

  const sameDay = <T extends { t: string }>(arr: T[]) =>
    arr.map((x) => ({ ...x, ms: Date.parse(x.t) })).filter((x) => nyDate(x.ms) === date).sort((a, b) => a.ms - b.ms);
  const spx = sameDay(spxChart).filter((p) => isRth(p.ms));
  const spy = sameDay(spyChart);
  const vix = sameDay(vixChart);
  const gex = sameDay(gexRaw);
  const vixGex = sameDay(vixGexRaw);

  // Cierre previo del VIX (solo si se repite el día de hoy; si no, % desde la apertura).
  let vixPrevClose: number | null = null;
  if (date === marketDateStr(now)) vixPrevClose = (await fetchMacroQuote({ index: "VIX" }).catch(() => null))?.prevClose ?? null;
  const vixOpen = latestAtOrBefore(vix, spx[0].ms)?.v ?? vix[0]?.v ?? null;

  // Open interest real del día (al inicio de la sesión, no cambia intradía).
  const chain = await fetchOptionChainExtended("SPX", date).catch(() => [] as ExtendedChainContract[]);
  const oi = new Map<string, number>();
  for (const c of chain) oi.set(`${c.type}:${c.strike}`, c.open_interest || 0);

  // Flujo por contrato, cada 5 min.
  const prices = spx.map((p) => p.v);
  const lo = Math.floor((Math.min(...prices) - RADIUS) / 5) * 5;
  const hi = Math.ceil((Math.max(...prices) + RADIUS) / 5) * 5;
  const strikes: number[] = [];
  for (let s = lo; s <= hi; s += 5) strikes.push(s);
  const flow = new Map<string, { ms: number; ask: number; bid: number; askVol: number; bidVol: number; vol: number }[]>();
  const jobs = strikes.flatMap((s) => (["call", "put"] as const).map((type) => ({ s, type })));
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map(async ({ s, type }) => {
      const sym = buildOccSymbol({ underlying: "SPXW", expiration: date, type, strike: s });
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

  const ticks: ReplayTick[] = [];
  const fired: ReplayAlert[] = [];
  let lastFlip: number | null = null;

  for (const p of spx) {
    const T = p.ms;
    const g = latestAtOrBefore(gex, T);
    for (const b of gex) { if (b.ms > T) break; if (b.gamma_flip != null) lastFlip = b.gamma_flip; }
    const gexStats = g ? { ...g, gamma_flip: g.gamma_flip ?? lastFlip, asset_price: p.v } : null;
    const vixNow = latestAtOrBefore(vix, T)?.v ?? null;
    const iv = vixNow != null && vixNow > 0 ? vixNow / 100 : 0.18;
    const years = yearsToExpiry(date, new Date(T));
    const spyNow = latestAtOrBefore(spy, T)?.v ?? null;

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
          symbol: "", strike: s, type, expiration: date,
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
      contracts, spot: p.v, gexStats, spy: spyNow, es: null, vix: vixReading, radius: RADIUS, yearsToExpiry: years,
    });
    const vixMagnet = latestAtOrBefore(vixGex, T)?.magnet ?? null;

    const ev = evaluateVisionAlerts({
      now: T, spot: p.v, conversion: report.conversion,
      keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, rows: report.rows, regime: report.regime,
      prices: spx.filter((x) => x.ms <= T).map((x) => ({ t: x.ms, v: x.v })),
      vix: vix.filter((x) => x.ms <= T).map((x) => ({ t: x.ms, v: x.v })),
      vixMagnet, aggressorNow: aggNow, aggressorPrev: aggPrev,
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
            qRows.push({ type, strike: s, bid: q.bid > 0 ? q.bid : null, ask: q.ask, delta: bsDelta(p.v, s, years, iv, type), iv, openInterest: oi.get(`${type}:${s}`) ?? 0, volume: 0 });
          }
        }
        const sp = buildSpreads({
          rows: qRows, spot: p.v, days: years * 365,
          keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, expectedMove: report.expectedMove, fallbackIv: iv,
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

    ticks.push({ ...report, time: Math.floor(T / 1000), gexAsOf: g?.t ?? null, vixMagnet, activeIds, watch });
  }

  // Liquidación al vencimiento (SPXW 0DTE vencen al cierre): valor intrínseco al último precio del día.
  if (!partial && spx.length > 0) {
    const settle = spx[spx.length - 1].v;
    for (const t of spreadTrades) {
      t.settle = settle;
      t.pnl = spreadPnlAtExpiry(t.idea, settle);
      t.pnlUsd = Math.round(t.pnl * 100);
    }
  }

  const payload: ReplayPayload = {
    version: REPLAY_VERSION,
    date,
    builtAt: now.toISOString(),
    partial,
    radius: RADIUS,
    priceSeries: spx.map((p) => ({ time: Math.floor(p.ms / 1000), value: p.v })),
    history: gex.map((b) => ({
      time: Math.floor(b.ms / 1000), magnet: b.magnet, callWall: b.call_wall, putWall: b.put_wall,
      gammaFlip: b.gamma_flip, maxPain: b.max_pain,
    })),
    ticks,
    alerts: fired,
    spreadTrades,
    notes: [
      "Precio, Magneto, paredes, flip, max pain, VIX y flujo por strike: datos reales de MarketSnack de cada momento.",
      "Imanes ±, resistencias/pisos secundarios y charm: estimados con el open interest real y gamma de Black-Scholes usando el VIX como volatilidad.",
      "Sin /ES en la repetición: no hay historial intradía del futuro.",
      "Spreads: precio de cada pata = promedio real al que se llenó en MarketSnack en los últimos 15 min (si no hubo operaciones, teórico con el VIX, marcado 'estimado'); se mantienen hasta el vencimiento y se liquidan al cierre.",
      "Resolución de 5 minutos.",
    ],
  };
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(payload), "utf8");
  } catch { /* sin cache en disco: igual se devuelve */ }
  return payload;
}
