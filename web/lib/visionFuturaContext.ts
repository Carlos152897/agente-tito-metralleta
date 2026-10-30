// Panel derecho de VisionFutura (Carlos, 29-oct-2026, con captura de referencia):
//   1. "VIX · SPY · QQQ": precio del día + Imán + (strike con mayor GEX neto positivo) e Imán −
//      (mayor GEX neto negativo) a ±25% del precio en el VIX y ±1% en SPY y QQQ, minuto a minuto.
//   2. "Vigía tecnológico": las 11 tecnológicas grandes; de cada una, su Imán + mayor a ±5% del
//      precio y si queda ARRIBA o ABAJO del precio → conteo / balance ponderado / jalón ponderado.
// PURO (sin fetch ni disco): los datos viven en lib/visionFuturaContextData.ts.

export interface StrikeGex { netGex: number }

export interface MagnetPair {
  /** Imán +: strike con mayor GEX neto positivo dentro de la banda. */
  pos: number | null;
  /** Imán −: strike con mayor GEX neto negativo (más negativo) dentro de la banda. */
  neg: number | null;
  posGex: number;
  negGex: number;
}

/** Imán + e Imán − dentro de ±`band` (fracción: 0.01 = 1%) del precio. */
export function magnetsInBand(gex: Map<number, StrikeGex>, spot: number, band: number): MagnetPair {
  const out: MagnetPair = { pos: null, neg: null, posGex: 0, negGex: 0 };
  if (!(spot > 0)) return out;
  const lo = spot * (1 - band), hi = spot * (1 + band);
  for (const [strike, g] of gex) {
    if (strike < lo || strike > hi) continue;
    if (g.netGex > out.posGex) { out.pos = strike; out.posGex = g.netGex; }
    if (g.netGex < out.negGex) { out.neg = strike; out.negGex = g.netGex; }
  }
  return out;
}

export type ContextSymbol = "VIX" | "SPY" | "QQQ";

export const CONTEXT_SYMBOLS: { sym: ContextSymbol; kind: "index" | "equity"; band: number; digits: number }[] = [
  { sym: "VIX", kind: "index", band: 0.25, digits: 2 },
  { sym: "SPY", kind: "equity", band: 0.01, digits: 2 },
  { sym: "QQQ", kind: "equity", band: 0.01, digits: 2 },
];

/** Banda del Vigía tecnológico: Imán + mayor a ±5% del precio. */
export const TECH_BAND = 0.05;

export type TechIndex = "SPX" | "NDX";

/**
 * Pesos APROXIMADOS (%) de cada empresa en el índice — solo ordenan la lista y pesan el balance.
 * SPX: los de la captura de referencia de Carlos (29-oct-2026). NDX: aproximados. Ajustar aquí.
 */
export const TECH_WEIGHTS: Record<TechIndex, Record<string, number>> = {
  SPX: { NVDA: 7.8, AAPL: 7.6, MSFT: 5.9, GOOGL: 5.4, AMZN: 3.7, AVGO: 2.4, META: 2.4, TSLA: 1.5, AMD: 1.3, PLTR: 0.7, NFLX: 0.4 },
  NDX: { NVDA: 9.6, AAPL: 8.6, MSFT: 8.0, AMZN: 5.5, AVGO: 5.2, META: 3.4, TSLA: 3.1, GOOGL: 3.0, PLTR: 2.0, AMD: 1.7, NFLX: 1.6 },
};

export const TECH_TICKERS = Object.keys(TECH_WEIGHTS.SPX);

export interface TechCompany {
  ticker: string;
  price: number | null;
  prevClose: number | null;
  /** Imán + mayor a ±5% (null = sin GEX positivo en la banda). */
  magnet: number | null;
  /** 1 = el imán está arriba del precio, −1 = abajo, 0 = sin lectura / en el precio. */
  dir: 1 | -1 | 0;
  /** Distancia del precio al imán en % (con signo: + arriba). */
  distPct: number | null;
  /** Vencimiento usado para el GEX. */
  expiration: string | null;
}

export function techCompany(ticker: string, price: number | null, prevClose: number | null, gex: Map<number, StrikeGex> | null, expiration: string | null): TechCompany {
  const m = gex && price ? magnetsInBand(gex, price, TECH_BAND) : null;
  const magnet = m?.pos ?? null;
  const distPct = magnet != null && price ? ((magnet - price) / price) * 100 : null;
  const dir: 1 | -1 | 0 = distPct == null || Math.abs(distPct) < 1e-9 ? 0 : distPct > 0 ? 1 : -1;
  return { ticker, price, prevClose, magnet, dir, distPct, expiration };
}

export interface TechReading {
  /** Conteo de imanes: cuántas tienen su Imán + arriba del precio (0…n). */
  count: number;
  /** Cuántas tienen lectura (el máximo del conteo). */
  n: number;
  /** Balance ponderado: Σ peso × (+1 arriba / −1 abajo) ÷ Σ peso, en % (−100…+100). */
  balance: number;
  /** Imán mayor ponderado: promedio ponderado de la distancia al imán, en % del precio (+ = jala arriba). */
  pull: number;
}

export function techReading(companies: TechCompany[], index: TechIndex): TechReading | null {
  const w = TECH_WEIGHTS[index];
  const ok = companies.filter((c) => c.dir !== 0 && c.distPct != null && w[c.ticker] != null);
  if (ok.length === 0) return null;
  const tw = ok.reduce((a, c) => a + w[c.ticker], 0);
  return {
    count: ok.filter((c) => c.dir > 0).length,
    n: ok.length,
    balance: (ok.reduce((a, c) => a + w[c.ticker] * c.dir, 0) / tw) * 100,
    pull: ok.reduce((a, c) => a + w[c.ticker] * (c.distPct as number), 0) / tw,
  };
}

/** Punto por minuto de VIX/SPY/QQQ (t = inicio del minuto, en segundos). */
export interface ContextPoint { t: number; price: number; pos: number | null; neg: number | null }
export interface TechPoint extends TechReading { t: number }

/** Mete el punto en la serie: si ya hay uno del mismo minuto lo reemplaza (el minuto se cierra con el último). */
export function upsertMinute<T extends { t: number }>(series: T[], p: T): T[] {
  const last = series.at(-1);
  if (last && last.t === p.t) return [...series.slice(0, -1), p];
  if (last && last.t > p.t) return series;
  return [...series, p];
}

/** Valor de una serie escalonada en el segundo `t` (el último punto ≤ t). */
export function stepAt<T extends { t: number }>(series: T[], t: number): T | null {
  let r: T | null = null;
  for (const p of series) { if (p.t <= t) r = p; else break; }
  return r;
}
