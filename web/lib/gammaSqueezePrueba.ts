// GAMMA SQUEEZE PRUEBA (Carlos, 19-nov-2026: "me gustaría trabajar en el Gamma Squeeze para los
// últimos minutos... los contratos menores a $1 se tiran a $300, $400, así como el loto").
//
// APARTE de la app (nada la importa; el motor de Lottos de VisionFutura sigue igual). PURO.
// Usa PRECIOS REALES de 1 min de cada contrato 0DTE (velas de tastytrade/DXLink, que siguen
// disponibles después del vencimiento) + la repetición del día (GEX por strike, régimen) + velas
// de 1 min del SPX.
//
// Candidato = en cada lectura (15:00, 15:05 … 15:50 NY), cada call arriba / put abajo del precio a
// ≤ `maxDistPts`, cuyo último precio operado está entre $0.05 y $1.00. Entrada = apertura de la
// primera vela DESPUÉS de la lectura + `slippage` (lo que costaría de verdad, sin mirar el futuro).
// Resultado = lo más alto que llegó antes del cierre (veces la entrada) y lo que valió al vencimiento.
// Salida simulada: vender todo en `exitMult`× (orden límite) si llega; si no, al vencimiento.
//
// Condiciones medidas (cada una por separado y juntas, para ver cuál sube la probabilidad):
//   gex_neg       GEX neto del día negativo (dealers cortos de gamma → aceleran)
//   camino_neg    GEX neto de los strikes ENTRE el precio y el strike < 0 (el camino acelera)
//   al_alcance    distancia ≤ 1 σ de lo que queda; σ = straddle ATM real ÷ 0.8
//   momentum      el SPX se movió ≥ 3 pts hacia el strike en los últimos 10 min
//   compran       en el contrato, compras al ask > ventas al bid en los últimos 10 min
//   volumen       volumen del contrato en los últimos 10 min ≥ 2× su promedio de 10 min desde las 14:30
//   prima_sube    el contrato ya subió ≥ 30% en los últimos 10 min

export const SQUEEZE_TUNING = {
  /** Lecturas: minutos desde las 9:30 (330 = 15:00, 380 = 15:50). */
  readings: [330, 335, 340, 345, 350, 355, 360, 365, 370, 375, 380],
  minPrice: 0.05,
  maxPrice: 1.0,
  maxDistPts: 40,
  minDistPts: 3,
  /** Costo extra por entrar (spread de una opción barata). */
  slippage: 0.05,
  /** Entrada = apertura de la primera vela en los siguientes N min (si no hubo operaciones, no entra). */
  entryWithinMin: 3,
  /** El último precio operado tiene que ser de hace ≤ N min. */
  lastTradeMaxAgeMin: 5,
  lookbackMin: 10,
  momentumPts: 3,
  volumeSurge: 2,
  premiumRise: 0.3,
  reachSigma: 1,
  /** Múltiplos que se cuentan como "explotó". */
  mults: [3, 5, 10] as const,
  /** Salida simulada. */
  exitMult: 5,
  /** Desde cuándo se mira el volumen de referencia (min desde 9:30; 300 = 14:30). */
  volumeBaseFromMin: 300,
};

export const CONDITIONS = ["gex_neg", "camino_neg", "al_alcance", "momentum", "compran", "volumen", "prima_sube"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = {
  gex_neg: "GEX neto del día negativo",
  camino_neg: "GEX negativo en el camino al strike",
  al_alcance: "Strike a ≤ 1σ de lo que queda (straddle real)",
  momentum: "SPX ≥ 3 pts hacia el strike en 10 min",
  compran: "Compras al ask > ventas al bid (10 min)",
  volumen: "Volumen del contrato ≥ 2× su promedio",
  prima_sube: "El contrato ya subió ≥ 30% en 10 min",
};

export interface OptBar { time: number; open: number; high: number; low: number; close: number; volume?: number; bidVolume?: number; askVolume?: number }
export interface SpxBar { time: number; high: number; low: number; close?: number }
export interface SqTick { time: number; spot: { spx: number }; netGex: number; rows: { spx: number; netGex: number }[] }

export interface Contract { type: "call" | "put"; strike: number; bars: OptBar[] }

export interface SqCandidate {
  date: string;
  readMin: number;
  type: "call" | "put";
  strike: number;
  spot: number;
  dist: number;
  sigma: number | null;
  lastPrice: number;
  entry: number;
  entryT: number;
  maxPrice: number;
  maxMult: number;
  maxT: number;
  expiryValue: number;
  /** Resultado por $1 invertido con la salida simulada (vender en exitMult× o al vencimiento). */
  pnlPerDollar: number;
  cond: Record<Condition, boolean>;
  score: number;
}

const sortBars = <T extends { time: number }>(b: T[]) => [...b].sort((x, y) => x.time - y.time);

/** Precio del SPX al cierre de un minuto ≤ t (close o medio de la vela). */
function spxAt(bars: SpxBar[], t: number): number | null {
  let r: SpxBar | null = null;
  for (const b of bars) { if (b.time + 60 <= t) r = b; else break; }
  return r ? (r.close ?? (r.high + r.low) / 2) : null;
}

/** Último precio operado ≤ t (cierre de la vela que terminó antes de t). */
function lastTrade(bars: OptBar[], t: number, maxAgeSec: number): number | null {
  let r: OptBar | null = null;
  for (const b of bars) { if (b.time + 60 <= t) r = b; else break; }
  return r && t - (r.time + 60) <= maxAgeSec ? r.close : null;
}

/** σ de lo que queda hasta el cierre con el straddle ATM real (call + put del strike más cercano). */
export function straddleSigma(contracts: Contract[], spot: number, t: number): number | null {
  const ks = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
  for (const k of ks.slice(0, 3)) {
    const c = contracts.find((x) => x.type === "call" && x.strike === k);
    const p = contracts.find((x) => x.type === "put" && x.strike === k);
    const cp = c && lastTrade(c.bars, t, 600);
    const pp = p && lastTrade(p.bars, t, 600);
    if (cp != null && pp != null) return (cp + pp) / 0.8;
  }
  return null;
}

/** Valor al vencimiento con el último precio del SPX. */
export const intrinsic = (type: "call" | "put", strike: number, settle: number) =>
  Math.max(0, type === "call" ? settle - strike : strike - settle);

/** Resultado por $1 con la salida simulada. */
export function pnlPerDollar(entry: number, maxPrice: number, expiryValue: number, exitMult: number): number {
  if (maxPrice >= entry * exitMult) return exitMult - 1;
  return expiryValue / entry - 1;
}

export function squeezeCandidates(
  date: string, openSec: number, ticks: SqTick[], spx: SpxBar[], contracts: Contract[], t = SQUEEZE_TUNING,
): SqCandidate[] {
  const closeSec = openSec + 390 * 60;
  const spxS = sortBars(spx);
  const cs = contracts.map((c) => ({ ...c, bars: sortBars(c.bars) }));
  const settle = spxS.length ? (spxS[spxS.length - 1].close ?? (spxS[spxS.length - 1].high + spxS[spxS.length - 1].low) / 2) : null;
  if (settle == null) return [];
  const out: SqCandidate[] = [];
  for (const rm of t.readings) {
    const rt = openSec + rm * 60;
    const spot = spxAt(spxS, rt);
    if (spot == null) continue;
    let tick: SqTick | null = null;
    for (const k of ticks) { if (k.time <= rt) tick = k; else break; }
    if (!tick) continue;
    const sigma = straddleSigma(cs, spot, rt);
    const spotAgo = spxAt(spxS, rt - t.lookbackMin * 60);
    for (const c of cs) {
      const dist = c.type === "call" ? c.strike - spot : spot - c.strike;
      if (dist < t.minDistPts || dist > t.maxDistPts) continue;
      const last = lastTrade(c.bars, rt, t.lastTradeMaxAgeMin * 60);
      if (last == null || last < t.minPrice || last > t.maxPrice) continue;
      const nb = c.bars.find((b) => b.time >= rt && b.time < rt + t.entryWithinMin * 60);
      if (!nb) continue;
      const entry = nb.open + t.slippage;
      let maxPrice = 0, maxT = nb.time;
      for (const b of c.bars) {
        if (b.time < nb.time || b.time >= closeSec) continue;
        // En la vela de entrada solo cuenta lo de después de la apertura: se usa el cierre.
        const hi = b.time === nb.time ? b.close : b.high;
        if (hi > maxPrice) { maxPrice = hi; maxT = b.time; }
      }
      const expiryValue = intrinsic(c.type, c.strike, settle);

      // ── Condiciones (todo con datos ≤ rt).
      const between = tick.rows.filter((r) => (c.type === "call" ? r.spx > spot && r.spx <= c.strike : r.spx < spot && r.spx >= c.strike));
      const recent = c.bars.filter((b) => b.time >= rt - t.lookbackMin * 60 && b.time + 60 <= rt);
      const base = c.bars.filter((b) => b.time >= openSec + t.volumeBaseFromMin * 60 && b.time + 60 <= rt);
      const volRecent = recent.reduce((s, b) => s + (b.volume ?? 0), 0);
      const baseMin = Math.max(1, (rt - (openSec + t.volumeBaseFromMin * 60)) / 60);
      const volBasePer10 = (base.reduce((s, b) => s + (b.volume ?? 0), 0) / baseMin) * t.lookbackMin;
      const ask = recent.reduce((s, b) => s + (b.askVolume ?? 0), 0);
      const bid = recent.reduce((s, b) => s + (b.bidVolume ?? 0), 0);
      const priceAgo = lastTrade(c.bars, rt - t.lookbackMin * 60, 15 * 60);
      const cond: Record<Condition, boolean> = {
        gex_neg: tick.netGex < 0,
        camino_neg: between.length > 0 && between.reduce((s, r) => s + r.netGex, 0) < 0,
        al_alcance: sigma != null && dist <= t.reachSigma * sigma,
        momentum: spotAgo != null && (c.type === "call" ? spot - spotAgo : spotAgo - spot) >= t.momentumPts,
        compran: ask > bid,
        volumen: volBasePer10 > 0 && volRecent >= t.volumeSurge * volBasePer10,
        prima_sube: priceAgo != null && priceAgo > 0 && last >= priceAgo * (1 + t.premiumRise),
      };
      out.push({
        date, readMin: rm, type: c.type, strike: c.strike, spot, dist, sigma, lastPrice: last, entry, entryT: nb.time,
        maxPrice, maxMult: maxPrice / entry, maxT, expiryValue,
        pnlPerDollar: pnlPerDollar(entry, maxPrice, expiryValue, t.exitMult),
        cond, score: CONDITIONS.filter((k) => cond[k]).length,
      });
    }
  }
  return out;
}

export interface SqGroupStats {
  label: string;
  n: number;
  days: number;
  /** % que llegó a ≥ m× (por cada m de `mults`). */
  hit: Record<number, number>;
  /** Resultado promedio por $1 con la salida simulada. */
  avgPnl: number;
  /** Mejor múltiplo visto. */
  best: number;
}

export function groupStats(label: string, g: SqCandidate[], t = SQUEEZE_TUNING): SqGroupStats {
  const n = g.length;
  const hit: Record<number, number> = {};
  for (const m of t.mults) hit[m] = n ? g.filter((c) => c.maxMult >= m).length / n : 0;
  return {
    label, n, days: new Set(g.map((c) => c.date)).size, hit,
    avgPnl: n ? g.reduce((s, c) => s + c.pnlPerDollar, 0) / n : 0,
    best: g.reduce((m, c) => Math.max(m, c.maxMult), 0),
  };
}

/** Base, cada condición sí/no, y por puntaje (cuántas condiciones a la vez). */
export function summarizeSqueeze(cands: SqCandidate[], t = SQUEEZE_TUNING) {
  const base = groupStats("TODOS los contratos ≤ $1", cands, t);
  const byCond = CONDITIONS.map((k) => ({
    cond: k, label: CONDITION_LABELS[k],
    yes: groupStats(`${CONDITION_LABELS[k]} · SÍ`, cands.filter((c) => c.cond[k]), t),
    no: groupStats(`${CONDITION_LABELS[k]} · NO`, cands.filter((c) => !c.cond[k]), t),
  }));
  const maxScore = CONDITIONS.length;
  const byScore = Array.from({ length: maxScore + 1 }, (_, s) => groupStats(`${s}+ condiciones`, cands.filter((c) => c.score >= s), t));
  return { base, byCond, byScore };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EN PAPEL (Carlos, 19-nov: "sí, en papel"). Reglas CONGELADAS con lo mejor de los 19 días de
// prueba y calificadas solo en días nuevos (desde SQUEEZE_PAPEL_START). Una operación por día y por
// lado (la primera señal), 1 contrato, vender todo en `exitMult`× (límite) o sostener al vencimiento.
// No manda nada ni toca la app.

export const SQUEEZE_PAPEL_START = "2026-11-20";

export interface SqueezeRule { id: string; label: string; minScore: number; maxDist: number; minPrice: number; maxPrice: number; exitMult: number }

export const SQUEEZE_RULES: SqueezeRule[] = [
  { id: "v1", label: "Squeeze v1 · 4+ condiciones · ≤20 pts · $0.50–1.00 · vender en 3×", minScore: 4, maxDist: 20, minPrice: 0.5, maxPrice: 1.0, exitMult: 3 },
  { id: "v1_amplia", label: "Squeeze v1 amplia · 4+ condiciones · cualquier strike/precio · vender en 3×", minScore: 4, maxDist: 40, minPrice: 0.05, maxPrice: 1.0, exitMult: 3 },
];

export interface SqueezeTrade {
  date: string;
  rule: string;
  type: "call" | "put";
  strike: number;
  readMin: number;
  entryT: number;
  entry: number;
  maxPrice: number;
  maxMult: number;
  exitMult: number;
  /** "vendido" = llegó al múltiplo; "vencimiento" = se sostuvo. */
  salida: "vendido" | "vencimiento";
  exitPrice: number;
  /** $ por contrato (×100). */
  pnlUsd: number;
  score: number;
}

export function paperSqueezeDay(cands: SqCandidate[], rules = SQUEEZE_RULES): SqueezeTrade[] {
  const out: SqueezeTrade[] = [];
  for (const r of rules) {
    const taken = new Set<string>();
    const ok = cands
      .filter((c) => c.score >= r.minScore && c.dist <= r.maxDist && c.lastPrice >= r.minPrice && c.lastPrice <= r.maxPrice)
      .sort((a, b) => a.readMin - b.readMin || b.score - a.score || a.dist - b.dist);
    for (const c of ok) {
      const k = `${c.date}|${c.type}`;
      if (taken.has(k)) continue;
      taken.add(k);
      const sold = c.maxPrice >= c.entry * r.exitMult;
      const exitPrice = sold ? c.entry * r.exitMult : c.expiryValue;
      out.push({
        date: c.date, rule: r.id, type: c.type, strike: c.strike, readMin: c.readMin, entryT: c.entryT, entry: c.entry,
        maxPrice: c.maxPrice, maxMult: c.maxMult, exitMult: r.exitMult, salida: sold ? "vendido" : "vencimiento",
        exitPrice, pnlUsd: (exitPrice - c.entry) * 100, score: c.score,
      });
    }
  }
  return out;
}
