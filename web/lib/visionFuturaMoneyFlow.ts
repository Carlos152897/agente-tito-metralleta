// "Señal del dinero" de VisionFutura (Carlos, 23-oct-2026: "hacia dónde probablemente va el dinero,
// dame alertas long/short con objetivos y stops claros"). Es la receta de las 5 preguntas hecha regla:
//
//   Votos (cada uno +1 arriba / −1 abajo / 0):
//     1. Imán: el Magneto está arriba o abajo del precio (≥ 5 pts).
//     2. Apuestas del día: verde (calls compradas + puts vendidas) vs morado (calls vendidas + puts
//        compradas) en la pantalla; vota si un lado supera al otro por ≥ 20% del total.
//     3. Dinero NUEVO (15 min): cuánto creció el verde vs el morado. Es el voto que manda: tiene que
//        votar, y a favor ("los ▲ importan más que el tamaño").
//     4. Barra más grande: el strike con más posicionamiento está arriba o abajo (≥ 5 pts).
//   Dispara cuando el voto 3 vota y al menos 2 de los otros 3 van al mismo lado.
//   Objetivo: el nivel más cercano en esa dirección (Magneto, imanes, techo/piso, barra más grande)
//   a ≥ 8 pts. Stop: detrás del nivel más cercano en contra + 2 pts, entre 5 y 15 pts. R:B ≥ 1.2.
//   Todo en pts de SPX; se escala por instrumento con `scale`.
// PURO: sin red ni disco.

import type { KeyLevel } from "./visionFutura";
import { positioningParts } from "./visionFuturaFlowChanges";

export const MONEY_TUNING = {
  minLevelDist: 5,
  leanRatio: 0.2,
  /** Dinero nuevo mínimo en 15 min para que el voto 3 cuente ($, no se escala: es dinero). */
  newMoneyMinUsd: 500_000,
  /** …y que un lado le gane al otro por ≥ este % de lo nuevo. */
  newMoneyRatio: 0.15,
  minTarget: 8,
  stopBuffer: 2,
  minStop: 5,
  maxStop: 15,
  minRb: 1.2,
  cooldownMs: 30 * 60_000,
};

export interface MoneyRow {
  spx: number;
  callFlow: number;
  putFlow: number;
}

export interface MoneyVote { label: string; vote: -1 | 0 | 1; detail: string }

export interface MoneySignal {
  side: "largo" | "corto";
  direction: "alcista" | "bajista";
  entry: number;
  stop: number;
  target: number;
  targetLabel: string;
  stopLabel: string;
  riskPts: number;
  rewardPts: number;
  rb: number;
}

export interface MoneyReading {
  votes: MoneyVote[];
  /** Suma de votos (−4…+4). */
  score: number;
  /** Lado al que apunta el dinero (null = sin dirección clara). */
  lean: "alcista" | "bajista" | null;
  signal: MoneySignal | null;
  /** Por qué no hay señal (si no la hay). */
  blocked: string | null;
  biggest: { strike: number; total: number } | null;
  /**
   * El mismo "dinero nuevo 15 min" pero con la prima por MINUTO de MarketSnack
   * (lib/visionFuturaPremium.ts). Solo informa: NO cuenta en los votos.
   */
  msNewMoney?: { vote: -1 | 0 | 1; net: number; detail: string } | null;
}

export interface MoneyInput {
  spot: number;
  keyLevels: KeyLevel[];
  rows: MoneyRow[];
  /** Filas de hace ~15 min (null = sin historial todavía). */
  rows15: MoneyRow[] | null;
  scale?: number;
}

const sideTotals = (rows: MoneyRow[]) => {
  let up = 0, down = 0;
  for (const r of rows) {
    const p = positioningParts(r);
    up += p.callsBought + p.putsSold;
    down += p.callsSold + p.putsBought;
  }
  return { up, down };
};
const money = (v: number) => `$${(Math.abs(v) / 1e6).toFixed(1)}M`;

export function readMoney(input: MoneyInput, t = MONEY_TUNING): MoneyReading {
  const sc = input.scale ?? 1;
  const minD = t.minLevelDist * sc;
  const spot = input.spot;
  const votes: MoneyVote[] = [];

  // 1. Imán
  const magnet = input.keyLevels.find((k) => k.kind === "magneto");
  const dm = magnet ? magnet.spx - spot : 0;
  votes.push({
    label: "Imán (Magneto)",
    vote: !magnet || Math.abs(dm) < minD ? 0 : dm > 0 ? 1 : -1,
    detail: magnet ? `${magnet.spx} · ${Math.abs(dm).toFixed(1)} pts ${dm >= 0 ? "arriba" : "abajo"}` : "sin dato",
  });

  // 2. Apuestas del día
  const now = sideTotals(input.rows);
  const tot = now.up + now.down;
  const lean = tot > 0 ? (now.up - now.down) / tot : 0;
  votes.push({
    label: "Apuestas del día",
    vote: lean >= t.leanRatio ? 1 : lean <= -t.leanRatio ? -1 : 0,
    detail: `verde ${money(now.up)} · morado ${money(now.down)}`,
  });

  // 3. Dinero nuevo (15 min) — el que manda
  let v3: -1 | 0 | 1 = 0;
  let d3 = "sin historial de hace 15 min";
  if (input.rows15) {
    const before = sideTotals(input.rows15);
    const dUp = now.up - before.up, dDown = now.down - before.down;
    const gross = Math.abs(dUp) + Math.abs(dDown);
    const diff = dUp - dDown;
    v3 = gross >= t.newMoneyMinUsd && Math.abs(diff) >= t.newMoneyRatio * gross ? (diff > 0 ? 1 : -1) : 0;
    d3 = `verde ${dUp >= 0 ? "+" : "−"}${money(dUp)} · morado ${dDown >= 0 ? "+" : "−"}${money(dDown)}`;
  }
  votes.push({ label: "Dinero nuevo 15 min", vote: v3, detail: d3 });

  // 4. Barra más grande
  let biggest: { strike: number; total: number } | null = null;
  for (const r of input.rows) {
    const p = positioningParts(r);
    const total = p.callsBought + p.putsSold + p.callsSold + p.putsBought;
    if (!biggest || total > biggest.total) biggest = { strike: r.spx, total };
  }
  const db = biggest ? biggest.strike - spot : 0;
  votes.push({
    label: "Barra más grande",
    vote: !biggest || biggest.total === 0 || Math.abs(db) < minD ? 0 : db > 0 ? 1 : -1,
    detail: biggest && biggest.total > 0 ? `${biggest.strike} (${money(biggest.total)}) · ${Math.abs(db).toFixed(1)} pts ${db >= 0 ? "arriba" : "abajo"}` : "sin dato",
  });

  const score = votes.reduce((a, v) => a + v.vote, 0);
  const others = votes.filter((_, i) => i !== 2);
  const dir = v3;
  const agree = others.filter((v) => v.vote === dir).length;
  const leanSide: MoneyReading["lean"] = score >= 2 ? "alcista" : score <= -2 ? "bajista" : null;
  const out: MoneyReading = { votes, score, lean: leanSide, signal: null, blocked: null, biggest };
  if (dir === 0) { out.blocked = "el dinero nuevo no tiene dirección"; return out; }
  if (agree < 2) { out.blocked = `solo ${agree} de 3 votos acompañan al dinero nuevo`; return out; }

  // Objetivo y stop
  const up = dir > 0;
  const cands: { spx: number; label: string }[] = input.keyLevels
    .filter((k) => ["magneto", "iman_positivo", "iman_negativo", "resistencia", "piso", "max_pain"].includes(k.kind))
    .map((k) => ({ spx: k.spx, label: k.label }));
  if (biggest && biggest.total > 0) cands.push({ spx: biggest.strike, label: "Barra más grande" });
  const ahead = cands
    .filter((c) => (up ? c.spx - spot : spot - c.spx) >= t.minTarget * sc)
    .sort((a, b) => Math.abs(a.spx - spot) - Math.abs(b.spx - spot));
  if (ahead.length === 0) { out.blocked = `sin nivel ${up ? "arriba" : "abajo"} a ≥ ${t.minTarget * sc} pts`; return out; }
  const target = ahead[0];
  const behind = input.keyLevels
    .filter((k) => (up ? spot - k.spx : k.spx - spot) >= 3 * sc)
    .sort((a, b) => Math.abs(a.spx - spot) - Math.abs(b.spx - spot))[0];
  let risk = behind ? Math.abs(spot - behind.spx) + t.stopBuffer * sc : t.maxStop * sc;
  risk = Math.min(Math.max(risk, t.minStop * sc), t.maxStop * sc);
  const reward = Math.abs(target.spx - spot);
  const rb = reward / risk;
  if (rb < t.minRb) { out.blocked = `R:B ${rb.toFixed(2)} < ${t.minRb} (objetivo ${target.label} ${target.spx})`; return out; }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.signal = {
    side: up ? "largo" : "corto",
    direction: up ? "alcista" : "bajista",
    entry: r2(spot),
    stop: r2(up ? spot - risk : spot + risk),
    target: target.spx,
    targetLabel: target.label,
    stopLabel: behind && Math.abs(spot - behind.spx) + t.stopBuffer * sc === risk ? `detrás de ${behind.label} ${behind.spx}` : risk === t.maxStop * sc ? "stop máximo" : "stop mínimo",
    riskPts: r2(risk),
    rewardPts: r2(reward),
    rb: Math.round(rb * 100) / 100,
  };
  return out;
}

export interface MoneyTrade extends MoneySignal {
  id: string;
  openedAt: number;
  votes: MoneyVote[];
  exit: number | null;
  exitAt: number | null;
  outcome: "objetivo" | "stop" | "cierre" | null;
  points: number | null;
  /** Base futuro − índice cuando salió (para mostrar la entrada en el futuro real de ese momento). */
  futBasis?: number | null;
  /** Dinero nuevo de MarketSnack por minuto al abrir (comparación, no decide). */
  msNewMoney?: MoneyReading["msNewMoney"];
}

/**
 * Simula una señal sobre el precio posterior (puntos de 5 min o muestras): stop primero si coinciden.
 * `final` = la sesión ya cerró: si no tocó nada, sale al último precio ("cierre"); si no, queda abierta.
 */
export function simulateMoneyTrade(tr: MoneyTrade, prices: { t: number; v: number }[], final = true): MoneyTrade {
  const up = tr.side === "largo";
  let exit: number | null = null, exitAt: number | null = null, outcome: MoneyTrade["outcome"] = null;
  for (const p of prices) {
    if (p.t <= tr.openedAt) continue;
    if (up ? p.v <= tr.stop : p.v >= tr.stop) { exit = tr.stop; exitAt = p.t; outcome = "stop"; break; }
    if (up ? p.v >= tr.target : p.v <= tr.target) { exit = tr.target; exitAt = p.t; outcome = "objetivo"; break; }
  }
  const last = prices.at(-1);
  if (final && outcome == null && last && last.t > tr.openedAt) { exit = last.v; exitAt = last.t; outcome = "cierre"; }
  const points = exit == null ? null : Math.round((up ? exit - tr.entry : tr.entry - exit) * 100) / 100;
  return { ...tr, exit, exitAt, outcome, points };
}

const nyHmOf = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });

export interface MoneyStep { t: number; spot: number; keyLevels: KeyLevel[]; rows: MoneyRow[] }

/** Paso de hace ~15 min (entre 12 y 20 min antes), o null. */
export function stepAgo<T extends { t: number }>(steps: T[], t: number, mins = 15): T | null {
  let best: T | null = null;
  for (const s of steps) {
    const d = (t - s.t) / 60_000;
    if (d >= mins - 3 && d <= mins + 5 && (!best || Math.abs(d - mins) < Math.abs((t - best.t) / 60_000 - mins))) best = s;
  }
  return best;
}

/**
 * Un día completo, paso a paso: lectura en cada paso y señales de 9:45 a 15:30 NY, una operación
 * abierta a la vez y 30 min de espera por lado. `final` = la sesión ya cerró.
 */
export function runMoneySession(steps: MoneyStep[], prices: { t: number; v: number }[], scale = 1, final = true, t = MONEY_TUNING) {
  const readings: (MoneyReading | null)[] = [];
  const trades: MoneyTrade[] = [];
  let busyUntil = 0;
  const lastBy: Record<string, number> = {};
  for (const st of steps) {
    const ago = stepAgo(steps, st.t);
    const hm = nyHmOf(st.t);
    if (hm < "09:45") { readings.push(null); continue; }
    const rd = readMoney({ spot: st.spot, keyLevels: st.keyLevels, rows: st.rows, rows15: ago?.rows ?? null, scale }, t);
    readings.push(rd);
    if (!rd.signal || hm > "15:30" || st.t < busyUntil) continue;
    if (lastBy[rd.signal.side] && st.t - lastBy[rd.signal.side] < t.cooldownMs) continue;
    const tr = simulateMoneyTrade({ ...rd.signal, id: `${hm}:${rd.signal.side}`, openedAt: st.t, votes: rd.votes, exit: null, exitAt: null, outcome: null, points: null }, prices, final);
    trades.push(tr);
    lastBy[rd.signal.side] = st.t;
    busyUntil = tr.exitAt ?? Infinity;
  }
  return { readings, trades };
}
