// IMANES PRUEBA (Carlos, 19-nov-2026: "midamos los imanes primero, pero llámalo imanes prueba...
// hazlos aparte, no quiero que interfiera con lo que tengo ahora porque es prueba").
//
// Mide, con las repeticiones guardadas (data/vision-futura/replay-*.json, pasos de 5 min) y velas
// reales de 1 min, qué tan seguido el precio LLEGA a cada imán. Nada de la app importa este archivo:
// no cambia pantalla, alertas, backtest ni Excel existentes. PURO (sin red ni disco).
//
// Imanes medidos:
//   Actuales (reconstruidos desde la repetición; los de flujo van en $ y a 5 min → aproximados):
//     gex_pos / gex_neg   Imán positivo / negativo del GEX (keyLevels de la repetición, tal cual)
//     magneto             Magneto (keyLevels)
//     gex_lado_pos/neg    Imán GEX × lado: mayor |GEX| a ±40 con lado = agresor $ de 5 min (aprox)
//     flujo15_pos/neg     Imán de flujo 15 min, ±70 (en $, aprox)
//     ref5_pos/neg        Imán Referencia: neto del último paso de 5 min (la app usa 1 min → aprox)
//     acum_pos/neg        Imán acumulado del día, ±75 (en $)
//   Candidatos nuevos (las ideas para hacerlos más precisos):
//     p_gex_tiempo_arr/abj  GEX pesado por el movimiento que todavía cabe antes del cierre
//     p_confluencia         strike donde coinciden ≥2 imanes actuales (±5 pts)
//     p_lado_estable_pos/neg  GEX × lado, pero el lado tiene que sostenerse 3 pasos (15 min)
//     p_acum_alcance_pos/neg  acumulado, pero solo dentro del movimiento que todavía cabe
//
// Medida por lectura (cada paso de 5 min de 9:45 a 15:30) y horizonte H (15 / 30 / 60 min):
//   llega   = alguna vela de 1 min en (t, t+H] tocó el strike (low ≤ K ≤ high)
//   espejo  = ¿llegó al strike a la MISMA distancia del lado contrario? (¿el imán eligió bien el lado?)
//   base    = qué tan seguido se llega a CUALQUIER nivel a esa distancia (todas las lecturas, ambos
//             lados) → un imán a 3 pts "acierta" casi siempre; lo que importa es ganarle a la base.
//   cerca   = lo más cerca que pasó el precio (pts).

export const IMANES_PRUEBA_TUNING = {
  /** Lecturas desde 9:45 hasta 15:30 (minutos desde las 9:30). */
  fromMin: 15,
  toMin: 360,
  horizons: [15, 30, 60] as const,
  gexLadoRadius: 40,
  gexLadoMinGexM: 5,
  /** Lado en $ (la repetición no guarda contratos por lado): agresor neto mínimo del paso. */
  minSideUsd: 25_000,
  flujoRadius: 70,
  refRadius: 75,
  acumRadius: 75,
  minFlowUsd: 50_000,
  /** Confluencia: imanes a ≤ esta distancia cuentan juntos. */
  confluenceTol: 5,
  /** Movimiento que todavía cabe: mínimo (pts SPX). */
  minReachPts: 5,
  /** Pasos seguidos con el mismo lado para el GEX × lado estable. */
  stableSteps: 3,
  /** Cubetas de distancia (pts) para la base. */
  distBuckets: [0, 5, 10, 15, 20, 30, 40, 60, 80, 1e9],
};

export interface PruebaRow {
  spx: number;
  netGex: number;
  callAsk?: number; callBid?: number; putAsk?: number; putBid?: number;
  callFlow?: number; putFlow?: number; compras?: number; ventas?: number;
}
export interface PruebaTick {
  time: number; // segundos
  spot: { spx: number };
  rows: PruebaRow[];
  keyLevels: { kind: string; spx: number }[];
  expectedMove?: { points: number } | null;
}
export interface Bar { time: number; high: number; low: number }

export interface MagnetReading {
  id: string;
  strike: number;
}

export const MAGNET_LABELS: Record<string, string> = {
  gex_pos: "Imán + GEX (actual)",
  gex_neg: "Imán − GEX (actual)",
  magneto: "Magneto (actual)",
  gex_lado_pos: "Imán GEX × lado + (actual, aprox)",
  gex_lado_neg: "Imán GEX × lado − (actual, aprox)",
  flujo15_pos: "Imán flujo 15m + (actual, aprox)",
  flujo15_neg: "Imán flujo 15m − (actual, aprox)",
  ref5_pos: "Imán Referencia + (aprox 5m)",
  ref5_neg: "Imán Referencia − (aprox 5m)",
  acum_pos: "Imán acumulado + (actual)",
  acum_neg: "Imán acumulado − (actual)",
  p_gex_tiempo_arr: "PRUEBA GEX × tiempo ↑ arriba",
  p_gex_tiempo_abj: "PRUEBA GEX × tiempo ↓ abajo",
  p_confluencia: "PRUEBA Confluencia (≥2 imanes)",
  p_lado_estable_pos: "PRUEBA GEX × lado estable +",
  p_lado_estable_neg: "PRUEBA GEX × lado estable −",
  p_acum_alcance_pos: "PRUEBA Acumulado al alcance +",
  p_acum_alcance_neg: "PRUEBA Acumulado al alcance −",
};

const T = IMANES_PRUEBA_TUNING;
// Repeticiones viejas (antes del 17-nov) no traen ask/bid por tipo: callFlow = callAsk − callBid,
// putFlow = putAsk − putBid, compras = callAsk + putAsk, ventas = callBid + putBid (verificado).
const net = (r: PruebaRow) => r.callAsk != null
  ? r.callAsk + (r.putBid ?? 0) - (r.callBid ?? 0) - (r.putAsk ?? 0)
  : (r.callFlow ?? 0) - (r.putFlow ?? 0);
const aggr = (r: PruebaRow) => r.callAsk != null
  ? r.callAsk + (r.putAsk ?? 0) - (r.callBid ?? 0) - (r.putBid ?? 0)
  : (r.compras ?? 0) - (r.ventas ?? 0);

/** Valor acumulado de cada strike en el tick (para restar ventanas). */
const mapOf = (tick: PruebaTick | undefined, f: (r: PruebaRow) => number) =>
  new Map((tick?.rows ?? []).map((r) => [r.spx, f(r)]));

/** Δ por strike entre `cur` y `prev` (solo strikes que estaban en los dos). */
function diff(cur: PruebaTick, prev: PruebaTick | undefined, f: (r: PruebaRow) => number): Map<number, number> {
  const out = new Map<number, number>();
  if (!prev) return out;
  const p = mapOf(prev, f);
  for (const r of cur.rows) { const b = p.get(r.spx); if (b != null) out.set(r.spx, f(r) - b); }
  return out;
}

function pickFlow(vals: Map<number, number>, spot: number, radius: number, min: number) {
  let pos: { strike: number; v: number } | null = null;
  let neg: { strike: number; v: number } | null = null;
  for (const [k, v] of vals) {
    if (Math.abs(k - spot) > radius) continue;
    if (v >= min && (!pos || v > pos.v)) pos = { strike: k, v };
    if (-v >= min && (!neg || -v > neg.v)) neg = { strike: k, v: -v };
  }
  return { pos, neg };
}

function pickGexSide(tick: PruebaTick, sides: Map<number, number>, spot: number, radius: number) {
  let pos: { strike: number; g: number } | null = null;
  let neg: { strike: number; g: number } | null = null;
  for (const r of tick.rows) {
    if (Math.abs(r.spx - spot) > radius) continue;
    const g = Math.abs(r.netGex) / 1e6;
    if (g < T.gexLadoMinGexM) continue;
    const s = sides.get(r.spx) ?? 0;
    if (s >= T.minSideUsd && (!pos || g > pos.g)) pos = { strike: r.spx, g };
    if (s <= -T.minSideUsd && (!neg || g > neg.g)) neg = { strike: r.spx, g };
  }
  return { pos, neg };
}

/** Movimiento que todavía cabe antes del cierre: movimiento esperado del día × √(min que faltan / 390). */
export function reachPts(tick: PruebaTick, minutesLeft: number, scale = 1): number {
  const em = tick.expectedMove?.points ?? 0;
  return Math.max(T.minReachPts * scale, em * Math.sqrt(Math.max(0, minutesLeft) / 390));
}

/**
 * Todos los imanes (actuales y de prueba) en el tick `i`. `minutesLeft` = minutos al cierre.
 * `scale` escala los radios (SPX = 1).
 */
export function magnetsAt(ticks: PruebaTick[], i: number, minutesLeft: number, scale = 1): MagnetReading[] {
  const tick = ticks[i];
  const spot = tick.spot.spx;
  const out: MagnetReading[] = [];
  const add = (id: string, strike: number | null | undefined) => { if (strike != null && Number.isFinite(strike)) out.push({ id, strike }); };

  for (const k of tick.keyLevels) {
    if (k.kind === "iman_positivo") add("gex_pos", k.spx);
    if (k.kind === "iman_negativo") add("gex_neg", k.spx);
    if (k.kind === "magneto") add("magneto", k.spx);
  }

  const side5 = diff(tick, ticks[i - 1], aggr);
  const gl = pickGexSide(tick, side5, spot, T.gexLadoRadius * scale);
  add("gex_lado_pos", gl.pos?.strike); add("gex_lado_neg", gl.neg?.strike);

  const f15 = pickFlow(diff(tick, ticks[i - 3], net), spot, T.flujoRadius * scale, T.minFlowUsd);
  add("flujo15_pos", f15.pos?.strike); add("flujo15_neg", f15.neg?.strike);

  const r5 = pickFlow(diff(tick, ticks[i - 1], net), spot, T.refRadius * scale, T.minFlowUsd);
  add("ref5_pos", r5.pos?.strike); add("ref5_neg", r5.neg?.strike);

  const cum = mapOf(tick, net);
  const ac = pickFlow(cum, spot, T.acumRadius * scale, T.minFlowUsd);
  add("acum_pos", ac.pos?.strike); add("acum_neg", ac.neg?.strike);

  // ── PRUEBA 1: GEX × tiempo. Peso = |GEX| × e^(−(dist/alcance)²): lo que no cabe antes del cierre casi no cuenta.
  const reach = reachPts(tick, minutesLeft, scale);
  let up: { k: number; w: number } | null = null;
  let dn: { k: number; w: number } | null = null;
  for (const r of tick.rows) {
    const d = r.spx - spot;
    const w = Math.abs(r.netGex) * Math.exp(-((d / reach) ** 2));
    if (d > 0 && (!up || w > up.w)) up = { k: r.spx, w };
    if (d < 0 && (!dn || w > dn.w)) dn = { k: r.spx, w };
  }
  add("p_gex_tiempo_arr", up?.k); add("p_gex_tiempo_abj", dn?.k);

  // ── PRUEBA 2: confluencia de los imanes actuales (sin contar el mismo imán dos veces).
  const current = out.filter((m) => !m.id.startsWith("p_"));
  let best: { strike: number; n: number; d: number } | null = null;
  for (const m of current) {
    const near = current.filter((o) => Math.abs(o.strike - m.strike) <= T.confluenceTol * scale);
    const ids = new Set(near.map((o) => o.id.replace(/_(pos|neg)$/, "")));
    if (ids.size < 2) continue;
    const ks = near.map((o) => o.strike).sort((a, b) => a - b);
    const strike = ks[Math.floor(ks.length / 2)];
    const d = Math.abs(strike - spot);
    if (!best || ids.size > best.n || (ids.size === best.n && d < best.d)) best = { strike, n: ids.size, d };
  }
  add("p_confluencia", best?.strike);

  // ── PRUEBA 3: GEX × lado ESTABLE: el lado tiene que tener el mismo signo los últimos N pasos.
  const steps: Map<number, number>[] = [];
  for (let s = 0; s < T.stableSteps; s++) steps.push(diff(ticks[i - s] ?? tick, ticks[i - s - 1], aggr));
  const stable = new Map<number, number>();
  for (const r of tick.rows) {
    const vals = steps.map((m) => m.get(r.spx) ?? 0);
    if (vals.every((v) => v >= T.minSideUsd)) stable.set(r.spx, Math.min(...vals));
    else if (vals.every((v) => v <= -T.minSideUsd)) stable.set(r.spx, Math.max(...vals));
  }
  const gs = pickGexSide(tick, stable, spot, T.gexLadoRadius * scale);
  add("p_lado_estable_pos", gs.pos?.strike); add("p_lado_estable_neg", gs.neg?.strike);

  // ── PRUEBA 4: acumulado, pero solo dentro de lo que todavía cabe.
  const aa = pickFlow(cum, spot, Math.min(T.acumRadius * scale, reach), T.minFlowUsd);
  add("p_acum_alcance_pos", aa.pos?.strike); add("p_acum_alcance_neg", aa.neg?.strike);

  return out;
}

/** ¿El precio tocó `level` en (fromSec, toSec]? y lo más cerca que pasó. */
export function touch(bars: Bar[], fromSec: number, toSec: number, level: number): { hit: boolean; closest: number } {
  let closest = Infinity;
  for (const b of bars) {
    if (b.time < fromSec || b.time >= toSec) continue; // vela [time, time+60): la del minuto t ya es futuro
    if (b.low <= level && level <= b.high) return { hit: true, closest: 0 };
    closest = Math.min(closest, Math.abs(b.low - level), Math.abs(b.high - level));
  }
  return { hit: false, closest };
}

export interface Observation {
  date: string;
  time: number;
  id: string;
  strike: number;
  spot: number;
  dist: number;
  horizon: number;
  hit: boolean;
  mirrorHit: boolean;
  closest: number;
}

/** Lecturas de un día: cada imán × cada horizonte. */
export function observeDay(date: string, ticks: PruebaTick[], bars: Bar[], closeSec: number, openSec: number, scale = 1): Observation[] {
  const out: Observation[] = [];
  const lastBar = bars.reduce((m, b) => Math.max(m, b.time), 0);
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i].time;
    const minFromOpen = (t - openSec) / 60;
    if (minFromOpen < T.fromMin || minFromOpen > T.toMin) continue;
    const spot = ticks[i].spot.spx;
    const left = (closeSec - t) / 60;
    for (const m of magnetsAt(ticks, i, left, scale)) {
      const dist = Math.abs(m.strike - spot);
      for (const h of T.horizons) {
        const end = Math.min(t + h * 60, closeSec);
        if (end <= t || lastBar < end - 60) continue; // sin velas suficientes
        const a = touch(bars, t, end, m.strike);
        const mirror = touch(bars, t, end, spot - (m.strike - spot));
        out.push({ date, time: t, id: m.id, strike: m.strike, spot, dist, horizon: h, hit: a.hit, mirrorHit: mirror.hit, closest: a.closest });
      }
    }
  }
  return out;
}

const bucketOf = (d: number) => {
  const b = T.distBuckets;
  for (let i = 1; i < b.length; i++) if (d < b[i]) return i - 1;
  return b.length - 2;
};
export const bucketLabel = (i: number) => {
  const b = T.distBuckets;
  return b[i + 1] >= 1e9 ? `${b[i]}+ pts` : `${b[i]}–${b[i + 1]} pts`;
};

/**
 * Base por (horizonte, cubeta de distancia): % de veces que el precio llega a un nivel a esa
 * distancia, usando las MISMAS lecturas (nivel del imán y su espejo). La base de cada imán se arma
 * con SU mezcla de distancias, para compararlo parejo.
 */
export function baseTable(obs: Observation[]): Map<string, number> {
  const acc = new Map<string, { n: number; h: number }>();
  for (const o of obs) {
    const key = `${o.horizon}|${bucketOf(o.dist)}`;
    const a = acc.get(key) ?? { n: 0, h: 0 };
    a.n += 2; a.h += (o.hit ? 1 : 0) + (o.mirrorHit ? 1 : 0);
    acc.set(key, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.n ? a.h / a.n : 0]));
}

export interface MagnetStats {
  id: string;
  label: string;
  horizon: number;
  n: number;
  hitPct: number;
  mirrorPct: number;
  basePct: number;
  /** Acierto − base (puntos porcentuales). Positivo = el imán sí atrae más que un nivel cualquiera. */
  edge: number;
  avgDist: number;
  /** Lo más cerca que pasó cuando NO llegó (mediana, pts). */
  missMedian: number | null;
  days: number;
}

export function summarize(obs: Observation[]): MagnetStats[] {
  const base = baseTable(obs);
  const groups = new Map<string, Observation[]>();
  for (const o of obs) { const k = `${o.id}|${o.horizon}`; const g = groups.get(k) ?? []; g.push(o); groups.set(k, g); }
  const out: MagnetStats[] = [];
  for (const [k, g] of groups) {
    const [id, hs] = k.split("|");
    const n = g.length;
    const hits = g.filter((o) => o.hit).length;
    const mir = g.filter((o) => o.mirrorHit).length;
    const b = g.reduce((s, o) => s + (base.get(`${o.horizon}|${bucketOf(o.dist)}`) ?? 0), 0) / n;
    const misses = g.filter((o) => !o.hit && Number.isFinite(o.closest)).map((o) => o.closest).sort((a, c) => a - c);
    out.push({
      id, label: MAGNET_LABELS[id] ?? id, horizon: Number(hs), n,
      hitPct: hits / n, mirrorPct: mir / n, basePct: b, edge: hits / n - b,
      avgDist: g.reduce((s, o) => s + o.dist, 0) / n,
      missMedian: misses.length ? misses[Math.floor(misses.length / 2)] : null,
      days: new Set(g.map((o) => o.date)).size,
    });
  }
  return out.sort((a, c) => a.horizon - c.horizon || c.edge - a.edge);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// REBOTE (Carlos, 19-nov: "sí, medir rebote"). Cuando el precio TOCA el imán, ¿rebota o lo atraviesa?
//   Se mira desde la lectura hasta `touchWithinMin` por el primer toque; luego hasta `afterMin`:
//   rebote    = se aleja X pts de vuelta (hacia donde venía) ANTES de pasarlo X pts
//   atraviesa = lo pasa X pts antes de rebotar X
//   nada      = ninguna de las dos en `afterMin`;  ambiguo = las dos en la misma vela de 1 min
// Cada toque cuenta UNA vez (lecturas seguidas del mismo imán en el mismo strike = mismo toque).
// BASE = lo mismo para TODOS los strikes de la cuadrícula a ±40 pts → ¿el imán rebota más que un
// strike cualquiera? Las cubetas de distancia se mezclan igual que las del imán.

export const REBOTE_TUNING = {
  touchWithinMin: 60,
  afterMin: 30,
  pts: [3, 5] as const,
  baseRadius: 40,
  /** Precio pegado al strike al leer: no se sabe de qué lado viene → se salta. */
  minDist: 1,
};

export type BounceOutcome = "rebote" | "atraviesa" | "nada" | "ambiguo";

/**
 * Primer toque de `level` en [fromSec, toSec) viniendo desde `from` ("abajo" = el precio está debajo
 * y sube hacia el nivel) y qué pasa después con `x` pts. null = no lo tocó.
 */
export function bounceAt(
  bars: Bar[], fromSec: number, toSec: number, level: number, from: "abajo" | "arriba", x: number, afterSec: number,
): { touchT: number; outcome: BounceOutcome } | null {
  const sorted = bars.filter((b) => b.time >= fromSec).sort((a, b) => a.time - b.time);
  const idx = sorted.findIndex((b) => b.time < toSec && b.low <= level && level <= b.high);
  if (idx < 0) return null;
  const touchT = sorted[idx].time;
  // Rebote = volver hacia donde venía; atraviesa = seguir de largo.
  const backLvl = from === "abajo" ? level - x : level + x;
  const thruLvl = from === "abajo" ? level + x : level - x;
  const hitBack = (b: Bar) => (from === "abajo" ? b.low <= backLvl : b.high >= backLvl);
  const hitThru = (b: Bar) => (from === "abajo" ? b.high >= thruLvl : b.low <= thruLvl);
  for (let j = idx; j < sorted.length && sorted[j].time < touchT + afterSec; j++) {
    const b = sorted[j];
    const back = hitBack(b);
    const thru = hitThru(b);
    if (j === idx) {
      // En la vela del toque solo cuenta lo que no pudo pasar antes de tocar: si ya venía de lejos,
      // el extremo opuesto de la vela es del camino de llegada → solo se mira "atraviesa".
      if (thru) return { touchT, outcome: "atraviesa" };
      continue;
    }
    if (back && thru) return { touchT, outcome: "ambiguo" };
    if (back) return { touchT, outcome: "rebote" };
    if (thru) return { touchT, outcome: "atraviesa" };
  }
  return { touchT, outcome: "nada" };
}

export interface BounceEvent {
  date: string;
  id: string; // id del imán o "base"
  strike: number;
  readT: number;
  touchT: number;
  dist: number;
  from: "abajo" | "arriba";
  x: number;
  outcome: BounceOutcome;
}

/** Toques y rebotes de un día para cada imán y para la cuadrícula base. */
export function bounceDay(
  date: string, ticks: PruebaTick[], bars: Bar[], closeSec: number, openSec: number, scale = 1, strikeStep = 5,
): BounceEvent[] {
  const R = REBOTE_TUNING;
  const out: BounceEvent[] = [];
  const seen = new Set<string>();
  const lastBar = bars.reduce((m, b) => Math.max(m, b.time), 0);
  const push = (id: string, strike: number, spot: number, t: number, x: number) => {
    const dist = Math.abs(strike - spot);
    if (dist < R.minDist) return;
    const from = strike > spot ? "abajo" : "arriba";
    const end = Math.min(t + R.touchWithinMin * 60, closeSec);
    const r = bounceAt(bars, t, end, strike, from, x * scale, R.afterMin * 60);
    if (!r) return;
    if (r.outcome === "nada" && r.touchT + R.afterMin * 60 > lastBar + 60 && r.touchT + R.afterMin * 60 <= closeSec) return;
    const key = `${id}|${strike}|${r.touchT}|${x}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ date, id, strike, readT: t, touchT: r.touchT, dist, from, x, outcome: r.outcome });
  };
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i].time;
    const m = (t - openSec) / 60;
    if (m < T.fromMin || m > T.toMin) continue;
    const spot = ticks[i].spot.spx;
    const mags = magnetsAt(ticks, i, (closeSec - t) / 60, scale);
    const lo = Math.ceil((spot - R.baseRadius * scale) / strikeStep) * strikeStep;
    for (const x of R.pts) {
      for (const mg of mags) push(mg.id, mg.strike, spot, t, x);
      for (let k = lo; k <= spot + R.baseRadius * scale; k += strikeStep) push("base", k, spot, t, x);
    }
  }
  return out;
}

export interface BounceStats {
  id: string;
  label: string;
  x: number;
  toques: number;
  rebotePct: number;
  atraviesaPct: number;
  nadaPct: number;
  baseRebotePct: number;
  baseAtraviesaPct: number;
  /** Rebote − base (pp). */
  ventajaRebote: number;
  /** Atraviesa − base (pp). */
  ventajaAtraviesa: number;
  days: number;
}

export function summarizeBounces(ev: BounceEvent[]): BounceStats[] {
  const valid = ev.filter((e) => e.outcome !== "ambiguo");
  const base = new Map<string, { n: number; r: number; a: number }>();
  for (const e of valid.filter((v) => v.id === "base")) {
    const k = `${e.x}|${bucketOf(e.dist)}`;
    const b = base.get(k) ?? { n: 0, r: 0, a: 0 };
    b.n++; if (e.outcome === "rebote") b.r++; if (e.outcome === "atraviesa") b.a++;
    base.set(k, b);
  }
  const groups = new Map<string, BounceEvent[]>();
  for (const e of valid) { const k = `${e.id}|${e.x}`; const g = groups.get(k) ?? []; g.push(e); groups.set(k, g); }
  const out: BounceStats[] = [];
  for (const [k, g] of groups) {
    const [id, xs] = k.split("|");
    const n = g.length;
    let br = 0, ba = 0;
    for (const e of g) {
      const b = base.get(`${e.x}|${bucketOf(e.dist)}`);
      if (b && b.n) { br += b.r / b.n; ba += b.a / b.n; }
    }
    br /= n; ba /= n;
    const reb = g.filter((e) => e.outcome === "rebote").length / n;
    const atr = g.filter((e) => e.outcome === "atraviesa").length / n;
    out.push({
      id, label: id === "base" ? "BASE (cualquier strike ±40)" : (MAGNET_LABELS[id] ?? id), x: Number(xs), toques: n,
      rebotePct: reb, atraviesaPct: atr, nadaPct: 1 - reb - atr,
      baseRebotePct: br, baseAtraviesaPct: ba, ventajaRebote: reb - br, ventajaAtraviesa: atr - ba,
      days: new Set(g.map((e) => e.date)).size,
    });
  }
  return out.sort((a, b) => a.x - b.x || b.ventajaRebote - a.ventajaRebote);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RUPTURA (Carlos, 19-nov: "probar flujo como ruptura"). Del rebote salió que los imanes de FLUJO
// se atraviesan más que un strike cualquiera. Acá se simula entrar a favor de la ruptura en el
// toque: precio en el strike, en la dirección en que venía (sube hacia el strike → largo), stop
// fijo y objetivo fijo, máximo `afterMin`. Si stop y objetivo caen en la misma vela de 1 min cuenta
// el STOP (conservador); en la vela del toque solo cuenta el objetivo (el otro extremo es la llegada).
// Se separa "flujo a favor" (Imán + tocado subiendo / Imán − tocado bajando) de "en contra".
// Base = la misma operación en cualquier strike ±40 tocado.

export const RUPTURA_TUNING = {
  stopPts: 3,
  targets: [5, 10] as const,
  afterMin: 30,
};

/** Imanes que salen del flujo de opciones (los que tienen lado comprador/vendedor). */
export const FLOW_IDS = ["gex_lado", "flujo15", "ref5", "acum", "p_lado_estable", "p_acum_alcance"];

export type Favor = "a_favor" | "en_contra" | "sin_lado";

export function favorOf(id: string, from: "abajo" | "arriba"): Favor {
  const m = id.match(/^(.*)_(pos|neg)$/);
  if (!m || !FLOW_IDS.includes(m[1])) return "sin_lado";
  const up = from === "abajo";
  return (m[2] === "pos") === up ? "a_favor" : "en_contra";
}

export interface BreakoutResult { outcome: "objetivo" | "stop" | "tiempo"; pts: number; /** Lo más lejos que siguió de largo (pts). */ mfe: number; /** Segundo en que se cerró (fin de la vela de salida). */ exitT?: number }

/** Operación de ruptura desde el toque. `bars` con close opcional (si no, salida al medio de la vela). */
export function breakoutTrade(
  bars: (Bar & { close?: number })[], touchT: number, level: number, from: "abajo" | "arriba", stop: number, target: number, afterSec: number,
): BreakoutResult | null {
  const dir = from === "abajo" ? 1 : -1;
  const seq = bars.filter((b) => b.time >= touchT && b.time < touchT + afterSec).sort((a, b) => a.time - b.time);
  if (!seq.length) return null;
  let mfe = 0;
  for (let j = 0; j < seq.length; j++) {
    const b = seq[j];
    const fav = dir > 0 ? b.high - level : level - b.low;
    const adv = dir > 0 ? level - b.low : b.high - level;
    mfe = Math.max(mfe, fav);
    const hitT = fav >= target;
    const hitS = adv >= stop;
    const exitT = b.time + 60;
    if (j === 0) { if (hitT) return { outcome: "objetivo", pts: target, mfe, exitT }; continue; }
    if (hitS) return { outcome: "stop", pts: -stop, mfe, exitT };
    if (hitT) return { outcome: "objetivo", pts: target, mfe, exitT };
  }
  const last = seq[seq.length - 1];
  const px = last.close ?? (last.high + last.low) / 2;
  return { outcome: "tiempo", pts: dir * (px - level), mfe, exitT: last.time + 60 };
}

export interface BreakoutStats {
  id: string;
  label: string;
  favor: Favor | "todos";
  target: number;
  n: number;
  winPct: number;
  stopPct: number;
  /** Puntos promedio por operación. */
  avgPts: number;
  totalPts: number;
  /** Mediana de lo que siguió de largo (pts). */
  mfeMedian: number;
  baseWinPct: number;
  baseAvgPts: number;
  days: number;
}

/**
 * Usa los toques únicos de `bounceDay` (solo x = 3, para no duplicar) y simula la ruptura.
 * `barsByDate` = velas de 1 min por día.
 */
export function summarizeBreakouts(ev: BounceEvent[], barsByDate: Record<string, (Bar & { close?: number })[]>): BreakoutStats[] {
  const R = RUPTURA_TUNING;
  const touches = ev.filter((e) => e.x === REBOTE_TUNING.pts[0]);
  type Row = { e: BounceEvent; favor: Favor; tgt: number; r: BreakoutResult };
  const rows: Row[] = [];
  for (const e of touches) {
    for (const tgt of R.targets) {
      const r = breakoutTrade(barsByDate[e.date] ?? [], e.touchT, e.strike, e.from, R.stopPts, tgt, R.afterMin * 60);
      if (r) rows.push({ e, favor: e.id === "base" ? "sin_lado" : favorOf(e.id, e.from), tgt, r });
    }
  }
  const base = new Map<number, { n: number; w: number; pts: number }>();
  for (const x of rows.filter((x) => x.e.id === "base")) {
    const b = base.get(x.tgt) ?? { n: 0, w: 0, pts: 0 };
    b.n++; if (x.r.outcome === "objetivo") b.w++; b.pts += x.r.pts;
    base.set(x.tgt, b);
  }
  const groups = new Map<string, Row[]>();
  const add = (k: string, x: Row) => { const g = groups.get(k) ?? []; g.push(x); groups.set(k, g); };
  for (const x of rows) {
    add(`${x.e.id}|todos|${x.tgt}`, x);
    if (x.favor !== "sin_lado") add(`${x.e.id}|${x.favor}|${x.tgt}`, x);
  }
  const out: BreakoutStats[] = [];
  for (const [k, g] of groups) {
    const [id, favor, ts] = k.split("|");
    const tgt = Number(ts);
    const b = base.get(tgt);
    const mf = g.map((x) => x.r.mfe).sort((a, c) => a - c);
    const total = g.reduce((s, x) => s + x.r.pts, 0);
    out.push({
      id, label: id === "base" ? "BASE (cualquier strike ±40)" : (MAGNET_LABELS[id] ?? id), favor: favor as Favor | "todos", target: tgt,
      n: g.length,
      winPct: g.filter((x) => x.r.outcome === "objetivo").length / g.length,
      stopPct: g.filter((x) => x.r.outcome === "stop").length / g.length,
      avgPts: total / g.length, totalPts: total,
      mfeMedian: mf[Math.floor(mf.length / 2)],
      baseWinPct: b && b.n ? b.w / b.n : 0,
      baseAvgPts: b && b.n ? b.pts / b.n : 0,
      days: new Set(g.map((x) => x.e.date)).size,
    });
  }
  return out.sort((a, c) => a.target - c.target || c.avgPts - a.avgPts);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EN PAPEL (Carlos, 19-nov: "probarla en vivo"). La regla que salió mejor en los 19 días queda
// CONGELADA y se califica en días NUEVOS (desde el 20-nov) para ver si se sostiene fuera de muestra:
//   Imán flujo 15m + o Imán Referencia + DEBAJO del precio; el precio cae y lo toca → CORTO en la
//   ruptura, stop 3 / objetivo 5 (y una variante con objetivo 10), máximo 30 min.
// Una operación a la vez por regla (si hay una abierta, los toques siguientes se ignoran). Sin mirar
// el futuro: el imán sale del paso de 5 min ya cerrado y la entrada es el toque posterior.
// Nada se manda (Telegram pausado) ni toca las alertas de la app.

export const PAPEL_START = "2026-11-20";

export interface PaperRule { id: string; label: string; magnets: string[]; target: number }

export const PAPER_RULES: PaperRule[] = [
  { id: "flujo15_obj5", label: "Ruptura de Imán flujo 15m + bajando · obj 5", magnets: ["flujo15_pos"], target: 5 },
  { id: "flujo15_obj10", label: "Ruptura de Imán flujo 15m + bajando · obj 10", magnets: ["flujo15_pos"], target: 10 },
  { id: "ref_obj5", label: "Ruptura de Imán Referencia + bajando · obj 5", magnets: ["ref5_pos"], target: 5 },
  { id: "cualquiera_obj5", label: "Ruptura de cualquiera de los dos · obj 5", magnets: ["flujo15_pos", "ref5_pos"], target: 5 },
];

export interface PaperTrade {
  date: string;
  rule: string;
  magnet: string;
  strike: number;
  readT: number;
  entryT: number;
  exitT: number;
  side: "corto";
  entry: number;
  stop: number;
  target: number;
  outcome: BreakoutResult["outcome"];
  pts: number;
}

/** Operaciones en papel de un día, una a la vez por regla. */
export function paperDay(
  date: string, ticks: PruebaTick[], bars: (Bar & { close?: number })[], closeSec: number, openSec: number, scale = 1, strikeStep = 5,
): PaperTrade[] {
  const R = RUPTURA_TUNING;
  const touches = bounceDay(date, ticks, bars, closeSec, openSec, scale, strikeStep)
    .filter((e) => e.x === REBOTE_TUNING.pts[0] && e.id !== "base" && favorOf(e.id, e.from) === "en_contra" && e.from === "arriba")
    .sort((a, b) => a.touchT - b.touchT || a.readT - b.readT);
  const out: PaperTrade[] = [];
  for (const rule of PAPER_RULES) {
    let busyUntil = 0;
    const usedTouch = new Set<string>();
    for (const e of touches) {
      if (!rule.magnets.includes(e.id) || e.touchT < busyUntil) continue;
      const key = `${e.strike}|${e.touchT}`;
      if (usedTouch.has(key)) continue; // el mismo toque visto por los dos imanes
      const r = breakoutTrade(bars, e.touchT, e.strike, e.from, R.stopPts * scale, rule.target * scale, Math.min(R.afterMin * 60, closeSec - e.touchT));
      if (!r) continue;
      usedTouch.add(key);
      busyUntil = r.exitT ?? e.touchT + 60;
      out.push({
        date, rule: rule.id, magnet: e.id, strike: e.strike, readT: e.readT, entryT: e.touchT, exitT: busyUntil, side: "corto",
        entry: e.strike, stop: e.strike + R.stopPts * scale, target: e.strike - rule.target * scale, outcome: r.outcome, pts: r.pts,
      });
    }
  }
  return out;
}
