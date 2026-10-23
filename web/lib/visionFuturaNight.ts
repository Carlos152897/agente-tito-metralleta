// Modo noche 🌙 de VisionFutura (Carlos, oct 2026: "¿cómo haríamos para operar el
// NQ y ES futuros en la noche?"). De noche SPX/NDX no cotizan y MarketSnack no
// tiene niveles, pero las opciones de CME sobre /ES y /NQ siguen operando casi
// 24 h en tastytrade. Acá se arma el mismo reporte que de día, solo que:
//   · el precio es el futuro activo (/ESZ6, /NQZ6), sin conversiones;
//   · los niveles (Magneto, Call/Put Wall, gamma flip, max pain) se calculan con
//     gamma × OI de esas opciones (mismo método que el Agente 0DTE), no los de MarketSnack;
//   · el flujo comprador/vendedor sale del streamer de futuros si está corriendo;
//   · la gráfica es la de las muestras propias de precio (no hay velas de futuros).
// De noche el OI es el del cierre anterior y el volumen es bajo: los niveles son
// menos confiables que los del día (la pantalla lo avisa).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildVisionFutura, yearsToExpiry, type VixReading } from "./visionFutura";
import {
  fetchActiveFuture, fetchFuturesOptionQuotesByType, fetchFuturesQuote, fetchNestedFuturesOptionChain,
  type FuturesOptionExpiration,
} from "./tastytrade";
import { buildSpreads, type SpreadQuoteRow, type SpreadsReport } from "./visionFuturaSpreads";
import { labelsOf, scaleFor, strikeStepNear, type InstrumentConfig } from "./visionFuturaInstruments";
import { isFuturesMarketOpen } from "./marketHours";
import { marketDateStr } from "./occ";
import { maxPainStrike, zeroDteGex } from "./zerodte";
import { loadNativeFuture, nativeFresh } from "./futuresNative";
import type { ExtendedChainContract, GexStatsBucket } from "./spxLevels";
import type { ZRow } from "./zerodteTypes";
import type { ExpirationChip, VisionFuturaPayload } from "./visionFuturaData";

/** Cuánto se mira alrededor del precio (6%): de sobra para ±30 strikes de /ES y /NQ. */
const RANGE_PCT = 0.06;
const SERIES_KEEP_MS = 18 * 3600_000;
const SERIES_EVERY_MS = 15_000;

// ── Gráfica: muestras propias del precio del futuro (memoria + disco) ──
const SERIES_DIR = join(process.cwd(), "data", "vision-futura", "night");
type Pt = { time: number; value: number };
const g = globalThis as unknown as { __vfNightSeries?: Map<string, Pt[]> };
const seriesMem = (g.__vfNightSeries ??= new Map<string, Pt[]>());

function seriesOf(inst: string): Pt[] {
  let s = seriesMem.get(inst);
  if (!s) {
    try {
      const f = join(SERIES_DIR, `${inst}-series.json`);
      s = existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Pt[]) : [];
    } catch { s = []; }
    seriesMem.set(inst, s);
  }
  return s;
}

/** Guarda una muestra del precio (como mucho una cada 15 s). La usan la carga y la ruta /live. */
export function recordNightPrice(inst: string, tMs: number, value: number) {
  if (!(value > 0)) return;
  const s = seriesOf(inst);
  const time = Math.floor(tMs / 1000);
  const last = s.at(-1);
  if (last && (time - last.time) * 1000 < SERIES_EVERY_MS) return;
  s.push({ time, value });
  const cut = Math.floor((tMs - SERIES_KEEP_MS) / 1000);
  while (s.length && s[0].time < cut) s.shift();
  try {
    mkdirSync(SERIES_DIR, { recursive: true });
    writeFileSync(join(SERIES_DIR, `${inst}-series.json`), JSON.stringify(s), "utf8");
  } catch { /* no crítico */ }
}

// ── Cadena anidada de opciones del futuro (cambia poco: 30 min) ──
const nestedCache = new Map<string, { at: number; exps: FuturesOptionExpiration[] }>();
async function nestedFut(product: string): Promise<FuturesOptionExpiration[]> {
  const c = nestedCache.get(product);
  if (c && Date.now() - c.at < 30 * 60_000) return c.exps;
  const exps = await fetchNestedFuturesOptionChain(product);
  nestedCache.set(product, { at: Date.now(), exps });
  return exps;
}

const futCache = new Map<string, { at: number; symbol: string }>();
export async function activeFutureSymbol(product: string): Promise<string | null> {
  const c = futCache.get(product);
  if (c && Date.now() - c.at < 3_600_000) return c.symbol;
  const f = await fetchActiveFuture(product).catch(() => null);
  if (f) futCache.set(product, { at: Date.now(), symbol: f.symbol });
  return f?.symbol ?? c?.symbol ?? null;
}

const num = (v: string | number | undefined | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const pos = (v: string | number | undefined | null) => { const n = num(v); return n != null && n > 0 ? n : null; };

/** Niveles propios con gamma × OI (lo que de día da MarketSnack). PURA. */
export function nightGexStats(rows: ZRow[], spot: number, now: Date): GexStatsBucket | null {
  const gex = zeroDteGex(rows, spot);
  if (gex.n === 0 || gex.kingStrike == null) return null;
  const callWall = gex.nodes.reduce((a, b) => (b.callGex > a.callGex ? b : a)).strike;
  const putWall = gex.nodes.reduce((a, b) => (b.putGex > a.putGex ? b : a)).strike;
  return {
    t: now.toISOString(),
    net_gex: gex.totalNetGex,
    call_wall: callWall,
    put_wall: putWall,
    magnet: gex.kingStrike,
    max_pain: maxPainStrike(rows, spot) ?? gex.kingStrike,
    gamma_flip: gex.flipStrike != null ? Math.round(gex.flipStrike * 100) / 100 : null,
    asset_price: spot,
  };
}

export async function loadNightVisionFutura(cfg: InstrumentConfig, now: Date, radius: number, expIndex: number): Promise<VisionFuturaPayload> {
  const night = cfg.night!;
  const futSymbol = await activeFutureSymbol(night.product);
  if (!futSymbol) throw new Error(`tastytrade no devolvió el futuro activo de /${night.product}.`);
  const [spot, exps, esRef] = await Promise.all([
    fetchFuturesQuote(futSymbol),
    nestedFut(night.product),
    // Referencia para la escala de /NQ: /ES (de noche SPX no se mueve).
    night.product === "ES" ? Promise.resolve(null) : activeFutureSymbol("ES").then((s) => (s ? fetchFuturesQuote(s) : null)).catch(() => null),
  ]);
  if (!spot || spot <= 0) throw new Error(`Sin precio en vivo para ${futSymbol}.`);

  // Solo opciones que liquidan contra el futuro activo y que todavía cotizan.
  const live = exps
    .filter((e) => e["underlying-symbol"] === futSymbol && new Date(e["stops-trading-at"]) > now)
    .sort((a, b) => Date.parse(a["stops-trading-at"]) - Date.parse(b["stops-trading-at"]));
  const expirations: ExpirationChip[] = live.slice(0, 6).map((e, dte) => ({ date: e["expiration-date"], dte }));
  const target = live[Math.min(Math.max(0, expIndex), Math.max(0, Math.min(5, live.length - 1)))];
  if (!target) throw new Error(`tastytrade no tiene opciones vivas de ${futSymbol}.`);
  const expiration = target["expiration-date"];

  const strikes = target.strikes.filter((s) => Math.abs(Number(s["strike-price"]) - spot) <= spot * RANGE_PCT);
  const symbols = strikes.flatMap((s) => [s.call, s.put]).filter(Boolean);
  const [quotes, nf] = await Promise.all([
    fetchFuturesOptionQuotesByType(symbols),
    loadNativeFuture(night.product, marketDateStr(now)).catch(() => null),
  ]);
  // Flujo (comprado al ask / vendido al bid) del streamer de futuros, si está vivo y es este vencimiento.
  const flowOk = nativeFresh(nf, now.getTime()) && nf?.exp === expiration;

  const zrows: ZRow[] = [];
  const contracts: ExtendedChainContract[] = [];
  const spreadRows: SpreadQuoteRow[] = [];
  for (const s of strikes) {
    const strike = Number(s["strike-price"]);
    for (const [type, sym] of [["call", s.call], ["put", s.put]] as const) {
      if (!sym) continue;
      const q = quotes.get(sym);
      const oi = num(q?.["open-interest"]) ?? 0;
      const volume = num(q?.volume) ?? 0;
      const gamma = num(q?.gamma);
      const iv = num(q?.volatility);
      const bid = pos(q?.bid), ask = pos(q?.ask);
      zrows.push({
        optionTicker: sym, contractType: type, expiration, strike, openInterest: oi, volume, bid, ask,
        greeks: { delta: num(q?.delta), gamma, theta: num(q?.theta), vega: num(q?.vega), iv },
      });
      const b = flowOk ? nf!.acc.buckets[`${type}:${strike}`] : undefined;
      const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
      contracts.push({
        symbol: sym, strike, type, expiration, open_interest: oi, volume: b?.volume ?? volume, price: mid,
        greeks: { delta: num(q?.delta) ?? 0, gamma: gamma ?? 0, theta: num(q?.theta) ?? 0, vega: num(q?.vega) ?? 0 },
        implied_volatility: iv,
        premium_breakdown: b
          ? {
              ask: b.ask * (b.askPrice ?? mid ?? 0) * night.mult,
              bid: b.bid * (b.bidPrice ?? mid ?? 0) * night.mult,
              mid: b.mid * (mid ?? 0) * night.mult,
            }
          : { bid: 0, mid: 0, ask: 0 },
      });
      if (q) spreadRows.push({ type, strike, bid, ask, delta: num(q.delta), iv, openInterest: oi, volume });
    }
  }

  const gexStats = nightGexStats(zrows, spot, now);
  const strikeStep = strikeStepNear(strikes.map((s) => Number(s["strike-price"])), spot);
  const atmStrikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 2);
  const ivs = contracts.filter((c) => atmStrikes.includes(c.strike) && c.implied_volatility != null && c.implied_volatility > 0.02 && c.implied_volatility < 3).map((c) => c.implied_volatility!);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const scale = scaleFor(cfg, spot, { spxSpot: esRef, vix: null, atmIv });
  // /ES usa las mismas ventanas que SPX (±30/60/120 pts); /NQ, 10/20/30 strikes por lado.
  const effRadius = night.product === "ES" ? radius : (radius <= 30 ? 10 : radius <= 60 ? 20 : 30) * strikeStep;
  const vix: VixReading | null = atmIv
    ? { last: Math.round(atmIv * 10_000) / 100, prevClose: Math.round(atmIv * 10_000) / 100, changePct: 0 }
    : null;
  const T = yearsToExpiry(expiration, now);

  const report = buildVisionFutura({
    contracts, spot, gexStats, spy: null, es: null, vix, radius: effRadius, strikeStep, yearsToExpiry: T,
  });

  recordNightPrice(cfg.id, now.getTime(), spot);
  const priceSeries = [...seriesOf(cfg.id)];

  let spreads: SpreadsReport | null = null;
  let spreadsError: string | null = null;
  try {
    const near = spreadRows.filter((r) => Math.abs(r.strike - spot) <= 80 * scale);
    const snap = (v: number) => Math.max(strikeStep, Math.round(v / strikeStep) * strikeStep);
    const widths = night.product === "ES" ? [5, 10] : [...new Set([snap(5 * scale), snap(10 * scale)])];
    spreads = near.length === 0 ? null : buildSpreads({
      rows: near, spot, days: T * 365,
      keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, expectedMove: report.expectedMove,
      fallbackIv: atmIv ?? 0.18, scale, widths, multiplier: night.mult,
    });
    if (near.length === 0) spreadsError = `tastytrade no tiene cotizaciones de opciones de ${futSymbol} para ${expiration}.`;
  } catch (e) {
    spreadsError = e instanceof Error ? e.message : "No se pudieron leer las cotizaciones de tastytrade.";
  }

  const resumen = [
    `🌙 Modo noche: niveles calculados con las opciones de ${futSymbol} (vencen ${expiration}). El OI es el del cierre anterior y de noche hay poco volumen: menos confiable que de día.`,
    flowOk
      ? "Flujo comprador/vendedor: streamer de futuros de tastytrade (en vivo)."
      : "Sin flujo comprador/vendedor en vivo (el streamer de futuros no está corriendo): posicionamiento de dealers y agresor quedan vacíos.",
    ...report.resumen,
  ];

  return {
    ...report,
    resumen,
    instrument: cfg.id,
    labels: labelsOf(cfg, futSymbol),
    scale,
    strikeStep,
    expirations,
    spreads,
    spreadsError,
    asOf: now.toISOString(),
    gexAsOf: gexStats?.t ?? null,
    marketOpen: isFuturesMarketOpen(now),
    expiration,
    esSymbol: futSymbol,
    radius: effRadius,
    priceSeries,
    priceSeriesApprox: false,
    history: [],
    vixMagnet: null,
  };
}
