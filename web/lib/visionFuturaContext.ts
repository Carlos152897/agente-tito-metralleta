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
export interface ContextPoint {
  t: number; price: number; pos: number | null; neg: number | null;
  /** true = reconstruido (no grabado en vivo): OI del día + gamma Black-Scholes al precio de ese minuto. */
  rebuilt?: boolean;
}
export interface TechPoint extends TechReading { t: number; rebuilt?: boolean }

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

// ── Imanes reconstruidos (2-nov-2026: "así quiero que se vea", con imanes desde las 9:30) ──
// Los imanes solo se graban con la página o la vigilancia abiertas. Para los minutos sin grabación se
// reconstruyen: el OI no cambia durante el día, así que GEX(strike, minuto) = gamma BS(precio del
// minuto, strike, tiempo al vencimiento, IV del contrato) × OI × 100 × precio² × 0.01.

export interface RebuildContract { strike: number; type: "call" | "put"; oi: number; iv: number }

function gammaBS(spot: number, strike: number, T: number, iv: number): number {
  if (!(spot > 0 && strike > 0 && T > 0 && iv > 0)) return 0;
  const sq = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + 0.5 * iv * iv * T) / (iv * sq);
  return Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (spot * iv * sq);
}

/** GEX neto por strike a un precio y un tiempo al vencimiento (años). */
export function gexAt(chain: RebuildContract[], spot: number, T: number): Map<number, StrikeGex> {
  const out = new Map<number, StrikeGex>();
  for (const c of chain) {
    if (!(c.oi > 0)) continue;
    const g = gammaBS(spot, c.strike, T, c.iv) * c.oi * 100 * spot * spot * 0.01;
    if (!g) continue;
    const e = out.get(c.strike) ?? { netGex: 0 };
    e.netGex += c.type === "call" ? g : -g;
    out.set(c.strike, e);
  }
  return out;
}

/**
 * Llena los minutos de `line` que no tienen grabación con imanes reconstruidos y devuelve la serie
 * completa ordenada. Lo grabado siempre manda. `expCloseSec` = cierre del vencimiento (segundos).
 */
export function fillMagnets(
  recorded: ContextPoint[], line: { t: number; v: number }[], chain: RebuildContract[], band: number, expCloseSec: number,
): ContextPoint[] {
  const have = new Set(recorded.map((p) => p.t));
  const valid = chain.filter((c) => c.oi > 0 && c.iv > 0.01 && c.iv < 5);
  if (valid.length === 0) return recorded;
  const out: ContextPoint[] = [...recorded];
  const MIN_T = 15 * 60; // nunca menos de 15 min al vencimiento (la gamma explota)
  for (const p of line) {
    const t = Math.floor(p.t / 60) * 60;
    if (have.has(t) || !(p.v > 0)) continue;
    const T = Math.max(expCloseSec - t, MIN_T) / (365 * 86_400);
    const m = magnetsInBand(gexAt(valid, p.v, T), p.v, band);
    out.push({ t, price: p.v, pos: m.pos, neg: m.neg, rebuilt: true });
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface TechRebuildInput {
  ticker: string;
  /** Cierre de cada vela de 1 min del día. */
  line: { t: number; v: number }[];
  chain: RebuildContract[];
  expCloseSec: number;
}

/**
 * Vigía tecnológico reconstruido: en cada minuto sin grabación, el Imán + mayor a ±5% de cada
 * empresa (gamma BS al precio de ese minuto) → conteo / balance / jalón de SPX y NDX. Lo grabado manda.
 * Los minutos salen de la línea de la empresa con más velas.
 */
export function fillTech(recorded: Record<TechIndex, TechPoint[]>, inputs: TechRebuildInput[]): Record<TechIndex, TechPoint[]> {
  const usable = inputs
    .map((c) => ({ ...c, chain: c.chain.filter((x) => x.oi > 0 && x.iv > 0.01 && x.iv < 5) }))
    .filter((c) => c.line.length > 0 && c.chain.length > 0);
  if (usable.length === 0) return recorded;
  const ref = usable.reduce((a, b) => (b.line.length > a.line.length ? b : a));
  const minutes = ref.line.map((p) => Math.floor(p.t / 60) * 60);
  const have: Record<TechIndex, Set<number>> = { SPX: new Set(recorded.SPX.map((p) => p.t)), NDX: new Set(recorded.NDX.map((p) => p.t)) };
  const out: Record<TechIndex, TechPoint[]> = { SPX: [...recorded.SPX], NDX: [...recorded.NDX] };
  const MIN_T = 15 * 60;
  const idxPos = new Map(usable.map((c) => [c.ticker, 0]));
  for (const t of minutes) {
    if (have.SPX.has(t) && have.NDX.has(t)) continue;
    const companies: TechCompany[] = [];
    for (const c of usable) {
      // Último cierre ≤ t de esa empresa (las líneas van ordenadas: se avanza un puntero).
      let i = idxPos.get(c.ticker)!;
      while (i + 1 < c.line.length && c.line[i + 1].t <= t + 59) i++;
      idxPos.set(c.ticker, i);
      const px = c.line[i].t <= t + 59 ? c.line[i].v : null;
      if (!px) continue;
      const T = Math.max(c.expCloseSec - t, MIN_T) / (365 * 86_400);
      companies.push(techCompany(c.ticker, px, null, gexAt(c.chain, px, T), null));
    }
    for (const idx of ["SPX", "NDX"] as TechIndex[]) {
      if (have[idx].has(t)) continue;
      const rd = techReading(companies, idx);
      if (rd) out[idx].push({ t, ...rd, rebuilt: true });
    }
  }
  out.SPX.sort((a, b) => a.t - b.t);
  out.NDX.sort((a, b) => a.t - b.t);
  return out;
}

