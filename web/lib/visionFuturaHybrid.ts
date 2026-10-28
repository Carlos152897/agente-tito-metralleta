// "Motor híbrido" de VisionFutura (Carlos, 27-oct-2026: "hagamos estos cambios, pero créame otro
// motor que se llame Motor híbrido"). PURO. Toma las MISMAS alertas y señales del dinero de los
// motores actuales (que no cambian) y les aplica las mejoras medidas con velas de 1 min en 4 días:
//
//   Alertas y órdenes híbridas (de lib/visionFuturaAlerts.ts):
//     - nada antes de las 9:45 NY (la apertura es ruido: 4 de 4 perdieron);
//     - nada si el piso/techo de la alerta está a ≤ 5 pts del Magneto (ahí el precio se pega, no
//       rebota — 27-oct: el precio iba y venía alrededor de 7,700);
//     - stop 2× y objetivo 1.5× del scalp original (SPX: 6 y 4.5 pts; el de 3 pts se tocaba en 1–2 min).
//     SPX 4 días, 1 min: −$1,500 → +$1,875 por contrato grande (27 ops, 70%).
//   Señal del dinero híbrida (de lib/visionFuturaMoneyFlow.ts):
//     - no entra si hay un nivel en contra entre la entrada y el objetivo (cortos: piso, imán − o
//       Magneto; largos: resistencia, imán + o Magneto). SPX 4 días, 1 min: −$1,405 → +$1,652.
//       En NQ no ayudó (−$3,087 → −$4,382): se marca en pantalla.
//
// En pantalla se muestra solo la ÚLTIMA de cada tipo; todas quedan guardadas (estado del día,
// repetición, backtest y Excel). Muestra chica (4 días): se mide hasta el 2026-11-04.

import type { KeyLevel } from "./visionFutura";
import type { MoneyTrade } from "./visionFuturaMoneyFlow";

export const HYBRID_TUNING = {
  /** Minuto NY desde el que se aceptan alertas (9:45). */
  startMin: 9 * 60 + 45,
  /** Distancia máxima nivel–Magneto que bloquea (pts SPX, se escala por instrumento). */
  magnetPts: 5,
  /** Stop y objetivo en veces el riesgo del scalp original. */
  stopMult: 2,
  targetMult: 1.5,
  /** Margen para no contar como "en el camino" un nivel pegado a la entrada o al objetivo. */
  pathMarginPts: 0.5,
};

export type HybridSource = "alerta" | "senal";
export type HybridOutcome = "objetivo" | "stop" | "cierre" | null;

export interface HybridTrade {
  id: string;
  source: HybridSource;
  /** ms en que salió. */
  at: number;
  side: "largo" | "corto";
  title: string;
  /** Nivel de la alerta (piso/techo) o etiqueta del objetivo de la señal. */
  level: number | null;
  levelLabel: string;
  entry: number;
  stop: number;
  target: number;
  riskPts: number;
  rewardPts: number;
  /** Qué cambió el motor híbrido respecto del original. */
  note: string;
  outcome: HybridOutcome;
  exit: number | null;
  exitAt: number | null;
  points: number | null;
  /** Base futuro − índice cuando salió (NQ: mostrar en /NQ). */
  futBasis?: number | null;
}

export interface HybridBlocked {
  source: HybridSource;
  at: number;
  side: "largo" | "corto";
  title: string;
  reason: string;
}

export interface HybridDay {
  alerts: HybridTrade[];
  money: HybridTrade[];
  blocked: HybridBlocked[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Minuto del día en Nueva York. */
export function nyMinute(ms: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
  return (Number(p.find((x) => x.type === "hour")?.value) % 24) * 60 + Number(p.find((x) => x.type === "minute")?.value);
}

const hhmm = (ms: number) => {
  const m = nyMinute(ms);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Sin operaciones encontradas (Carlos, 28-oct: LARGO de la señal 9:45 + CORTO de la alerta 9:46,
 * las dos abiertas → "no tiene sentido"): si alguna de las dos tarjetas tiene una abierta del lado
 * contrario, la nueva se bloquea. `open` = híbridas sin resultado todavía.
 */
function opposingBlock(side: "largo" | "corto", open: HybridTrade[] | undefined): string | null {
  const o = (open ?? []).filter((x) => x.outcome == null && x.side !== side).sort((a, b) => b.at - a.at)[0];
  if (!o) return null;
  return `ya hay un ${o.side === "largo" ? "LARGO" : "CORTO"} abierto (${o.source === "alerta" ? "alerta" : "señal"} de las ${hhmm(o.at)}): no se abre la contraria encima`;
}

/** Lo mínimo de una alerta disparada (lib/visionFuturaAlerts.ts) que usa el motor. */
export interface HybridAlertInput {
  id: string;
  title: string;
  level: { spx: number };
  order: { side: "largo" | "corto"; entry: { spx: number }; stop: { spx: number } };
}

/** Alerta híbrida a partir de una alerta original que se disparó en `at`. */
export function hybridFromAlert(a: HybridAlertInput, ctx: { at: number; keyLevels: Pick<KeyLevel, "kind" | "spx">[]; scale: number; open?: HybridTrade[] }, t = HYBRID_TUNING): { trade: HybridTrade | null; blocked: HybridBlocked | null } {
  const side = a.order.side;
  const base = { source: "alerta" as const, at: ctx.at, side, title: a.title };
  if (nyMinute(ctx.at) < t.startMin) return { trade: null, blocked: { ...base, reason: "antes de las 9:45 (la apertura es ruido)" } };
  const opp = opposingBlock(side, ctx.open);
  if (opp) return { trade: null, blocked: { ...base, reason: opp } };
  const mag = ctx.keyLevels.find((k) => k.kind === "magneto")?.spx;
  const magDist = mag != null ? Math.abs(a.level.spx - mag) : Infinity;
  if (magDist <= t.magnetPts * ctx.scale) {
    return { trade: null, blocked: { ...base, reason: `el nivel ${a.level.spx} está a ${magDist.toFixed(1)} pts del Magneto ${mag}: ahí el precio se pega, no rebota` } };
  }
  const dir = side === "largo" ? 1 : -1;
  const entry = a.order.entry.spx;
  const risk = Math.abs(entry - a.order.stop.spx);
  const stop = r2(entry - dir * t.stopMult * risk);
  const target = r2(entry + dir * t.targetMult * risk);
  return {
    trade: {
      id: `H:${a.id}:${ctx.at}`, ...base, level: a.level.spx, levelLabel: String(a.level.spx), entry, stop, target,
      riskPts: r2(t.stopMult * risk), rewardPts: r2(t.targetMult * risk),
      note: `stop ${t.stopMult}× y objetivo ${t.targetMult}× del scalp (${r2(risk)} → ${r2(t.stopMult * risk)} / ${r2(t.targetMult * risk)} pts)`,
      outcome: null, exit: null, exitAt: null, points: null,
    },
    blocked: null,
  };
}

/** Señal híbrida a partir de una señal del dinero original. */
export function hybridFromMoney(m: Pick<MoneyTrade, "id" | "side" | "entry" | "stop" | "target" | "targetLabel" | "openedAt">, ctx: { keyLevels: Pick<KeyLevel, "kind" | "spx" | "label">[]; open?: HybridTrade[] }, t = HYBRID_TUNING): { trade: HybridTrade | null; blocked: HybridBlocked | null } {
  const dir = m.side === "largo" ? 1 : -1;
  const title = `${m.side === "largo" ? "LONG" : "SHORT"} hacia ${m.targetLabel} ${m.target}`;
  const opp = opposingBlock(m.side, ctx.open);
  if (opp) return { trade: null, blocked: { source: "senal", at: m.openedAt, side: m.side, title, reason: opp } };
  const kinds = dir > 0 ? ["resistencia", "iman_positivo", "magneto"] : ["piso", "iman_negativo", "magneto"];
  const span = Math.abs(m.target - m.entry);
  const blocker = ctx.keyLevels
    .filter((k) => kinds.includes(k.kind) && (k.spx - m.entry) * dir > t.pathMarginPts && (k.spx - m.entry) * dir < span - t.pathMarginPts)
    .sort((a, b) => Math.abs(a.spx - m.entry) - Math.abs(b.spx - m.entry))[0];
  if (blocker) {
    return { trade: null, blocked: { source: "senal", at: m.openedAt, side: m.side, title, reason: `${blocker.label} ${blocker.spx} está en el camino del objetivo (a ${Math.abs(blocker.spx - m.entry).toFixed(1)} pts)` } };
  }
  return {
    trade: {
      id: `H:${m.id}`, source: "senal", at: m.openedAt, side: m.side, title, level: m.target, levelLabel: m.targetLabel,
      entry: m.entry, stop: m.stop, target: m.target, riskPts: r2(Math.abs(m.entry - m.stop)), rewardPts: r2(span),
      note: "sin niveles en contra entre la entrada y el objetivo", outcome: null, exit: null, exitAt: null, points: null,
    },
    blocked: null,
  };
}

/**
 * Resuelve un trade con una serie de precios posterior (t en ms; con máximo/mínimo si los hay).
 * Misma vela con stop y objetivo = stop. `final` = la sesión terminó: si no tocó nada, sale al último precio.
 */
export function resolveHybrid(tr: HybridTrade, prices: { t: number; v?: number; high?: number; low?: number; close?: number }[], final: boolean): HybridTrade {
  const up = tr.side === "largo";
  for (const p of prices) {
    if (p.t <= tr.at) continue;
    const hi = p.high ?? p.v!, lo = p.low ?? p.v!;
    if (up ? lo <= tr.stop : hi >= tr.stop) return { ...tr, outcome: "stop", exit: tr.stop, exitAt: p.t, points: r2(up ? tr.stop - tr.entry : tr.entry - tr.stop) };
    if (up ? hi >= tr.target : lo <= tr.target) return { ...tr, outcome: "objetivo", exit: tr.target, exitAt: p.t, points: r2(up ? tr.target - tr.entry : tr.entry - tr.target) };
  }
  const last = prices.filter((p) => p.t > tr.at).at(-1);
  if (!final || !last) return { ...tr, outcome: null, exit: null, exitAt: null, points: null };
  const px = last.close ?? last.v!;
  return { ...tr, outcome: "cierre", exit: r2(px), exitAt: last.t, points: r2(up ? px - tr.entry : tr.entry - px) };
}

/** Lo mínimo de una repetición que usa el motor (lib/visionFuturaReplay.ts → ReplayPayload). */
export interface HybridReplayInput {
  scale: number;
  ticks: { time: number; keyLevels: Pick<KeyLevel, "kind" | "spx" | "label">[] }[];
  alerts: (HybridAlertInput & { firedAt: number })[];
  moneyTrades?: Pick<MoneyTrade, "id" | "side" | "entry" | "stop" | "target" | "targetLabel" | "openedAt">[];
  /** Precio de la repetición (5 min): para saber qué seguía abierto si no se pasan velas. */
  priceSeries?: { time: number; value: number }[];
}

type HybridPrice = { t: number; v?: number; high?: number; low?: number; close?: number };

/** Niveles del paso de la repetición vigente en `ms`. */
function levelsAt(rp: HybridReplayInput, ms: number) {
  let tk = rp.ticks[0];
  for (const k of rp.ticks) {
    if (k.time * 1000 <= ms) tk = k;
    else break;
  }
  return tk?.keyLevels ?? [];
}

/**
 * Motor híbrido de toda una repetición (sin resolver: el resultado depende de qué precio se use).
 * Alertas y señales se recorren en orden de hora; para bloquear la contraria se ve qué seguía
 * abierto con `prices` (velas 1 min) o, si no, con el precio de la repetición.
 */
export function hybridFromReplay(rp: HybridReplayInput, prices?: HybridPrice[]): HybridDay {
  const day: HybridDay = { alerts: [], money: [], blocked: [] };
  const px: HybridPrice[] = prices ?? (rp.priceSeries ?? []).map((p) => ({ t: p.time * 1000, v: p.value }));
  // Solo cuenta lo que ya pasó: una vela (con máx/mín) cuenta cuando terminó.
  const openAt = (ms: number) => {
    const seen = px.filter((p) => p.t + (p.high != null ? 60_000 : 0) <= ms);
    return [...day.alerts, ...day.money].map((tr) => resolveHybrid(tr, seen, false)).filter((tr) => tr.outcome == null);
  };
  const events = [
    ...rp.alerts.map((a) => ({ at: a.firedAt, a, m: null as null | NonNullable<HybridReplayInput["moneyTrades"]>[number] })),
    ...(rp.moneyTrades ?? []).map((m) => ({ at: m.openedAt, a: null as null | HybridReplayInput["alerts"][number], m })),
  ].sort((x, y) => x.at - y.at);
  for (const ev of events) {
    const open = openAt(ev.at);
    if (ev.a) {
      const r = hybridFromAlert(ev.a, { at: ev.at, keyLevels: levelsAt(rp, ev.at), scale: rp.scale || 1, open });
      if (r.trade) day.alerts.push(r.trade);
      if (r.blocked) day.blocked.push(r.blocked);
    } else if (ev.m) {
      const r = hybridFromMoney(ev.m, { keyLevels: levelsAt(rp, ev.at), open });
      if (r.trade) day.money.push(r.trade);
      if (r.blocked) day.blocked.push(r.blocked);
    }
  }
  return day;
}

/** Resumen de una lista de trades resueltos. */
export function hybridSummary(list: HybridTrade[]) {
  const done = list.filter((x) => x.points != null);
  return {
    n: list.length,
    closed: done.length,
    wins: done.filter((x) => (x.points ?? 0) > 0).length,
    losses: done.filter((x) => (x.points ?? 0) < 0).length,
    points: r2(done.reduce((a, x) => a + (x.points ?? 0), 0)),
  };
}
