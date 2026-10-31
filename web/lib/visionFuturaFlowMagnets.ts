// Imanes por FLUJO (Carlos, 30-oct-2026: "agrégame lo del imán así como tiene esa app, imán positivo
// y negativo con su respectiva fuerza"). Definición de la guía "Escalera de gamma":
//   Imán + = strike cercano con más compra de calls + venta de puts (se posicionan para que suba)
//   Imán − = strike cercano con más venta de calls + compra de puts (se posicionan para que baje)
// Se buscan a ±70 pts del precio (SPX; otros × escala) con lo operado en los últimos 15 min.
// Fuerza = contratos netos de la ventana: (calls al ask + puts al bid) − (calls al bid + puts al ask),
// o sea el mismo Δ del volumen delta. PURO. Aparte de los imanes por GEX (esos no cambian).

import type { StrikeMinute } from "./visionFuturaVolumeDelta";

export const FLOW_MAGNET_TUNING = {
  /** Ventana de flujo (segundos). La app de referencia usa 15 min por defecto. */
  windowSec: 900,
  /** Distancia máxima al precio (pts de SPX; se multiplica por la escala del instrumento). */
  radiusPts: 70,
  /** Contratos netos mínimos para marcar un imán. */
  minContracts: 25,
};

export interface FlowMagnet {
  strike: number;
  /** Contratos netos de la ventana (siempre positivo; el lado lo dice `kind`). */
  fuerza: number;
}

export interface FlowMagnets {
  pos: FlowMagnet | null;
  neg: FlowMagnet | null;
}

export interface FlowMagnetSegment {
  kind: "pos" | "neg";
  strike: number;
  /** segundos */
  start: number;
  end: number;
  /** Fuerza más grande mientras estuvo en ese strike. */
  fuerza: number;
}

const deltaOf = (m: StrikeMinute) => m.cA + m.pB - (m.cB + m.pA);

interface Opts { windowSec?: number; radius?: number; minContracts?: number }

/**
 * Contratos netos por strike en (toT − ventana, toT]. Cada minuto `t` cubre [t, t+60): entra si
 * t ≥ toT − ventana y t < toT (igual que volDeltaRows).
 */
function windowDeltas(by: Map<number, StrikeMinute[]>, toT: number, windowSec: number): Map<number, number> {
  const out = new Map<number, number>();
  const fromT = toT - windowSec;
  for (const [strike, mins] of by) {
    let d = 0;
    for (const m of mins) if (m.t >= fromT && m.t < toT) d += deltaOf(m);
    out.set(strike, d);
  }
  return out;
}

function pick(deltas: Map<number, number>, spot: number, radius: number, minContracts: number): FlowMagnets {
  let pos: FlowMagnet | null = null;
  let neg: FlowMagnet | null = null;
  for (const [strike, d] of deltas) {
    if (Math.abs(strike - spot) > radius) continue;
    if (d >= minContracts && (!pos || d > pos.fuerza || (d === pos.fuerza && Math.abs(strike - spot) < Math.abs(pos.strike - spot)))) pos = { strike, fuerza: d };
    if (-d >= minContracts && (!neg || -d > neg.fuerza || (-d === neg.fuerza && Math.abs(strike - spot) < Math.abs(neg.strike - spot)))) neg = { strike, fuerza: -d };
  }
  return { pos, neg };
}

/** Imanes de flujo en el momento `toT` (segundos) con el precio `spot`. */
export function flowMagnetsAt(by: Map<number, StrikeMinute[]>, toT: number, spot: number, o: Opts = {}): FlowMagnets {
  const t = FLOW_MAGNET_TUNING;
  return pick(windowDeltas(by, toT, o.windowSec ?? t.windowSec), spot, o.radius ?? t.radiusPts, o.minContracts ?? t.minContracts);
}

/**
 * Dónde estuvo cada imán minuto a minuto entre `fromT` y `toT` (segundos): tramos seguidos en el
 * mismo strike. `spotAt(t)` = precio en ese minuto (null = sin precio, se salta).
 */
export function flowMagnetHistory(
  by: Map<number, StrikeMinute[]>, fromT: number, toT: number, spotAt: (t: number) => number | null, o: Opts = {},
): FlowMagnetSegment[] {
  const tune = FLOW_MAGNET_TUNING;
  const windowSec = o.windowSec ?? tune.windowSec;
  const radius = o.radius ?? tune.radiusPts;
  const minC = o.minContracts ?? tune.minContracts;
  // Delta por strike y minuto, para sumar la ventana deslizándola (sin recorrer todo cada minuto).
  const perMin = new Map<number, Map<number, number>>();
  for (const [strike, mins] of by) perMin.set(strike, new Map(mins.map((m) => [m.t, deltaOf(m)])));
  const run = new Map<number, number>([...perMin.keys()].map((k) => [k, 0]));
  const start0 = Math.floor(fromT / 60) * 60;
  // Arranque: lo que ya está dentro de la ventana del primer minuto evaluado.
  for (const [k, m] of perMin) {
    let s = 0;
    for (const [t, d] of m) if (t >= start0 + 60 - windowSec && t < start0 + 60) s += d;
    run.set(k, s);
  }
  const segs: FlowMagnetSegment[] = [];
  const open: Record<"pos" | "neg", FlowMagnetSegment | null> = { pos: null, neg: null };
  for (let t = start0 + 60; t <= toT; t += 60) {
    if (t > start0 + 60) {
      for (const [k, m] of perMin) run.set(k, (run.get(k) ?? 0) + (m.get(t - 60) ?? 0) - (m.get(t - 60 - windowSec) ?? 0));
    }
    const spot = spotAt(t);
    const cur = spot == null ? { pos: null, neg: null } : pick(run, spot, radius, minC);
    for (const kind of ["pos", "neg"] as const) {
      const mg = cur[kind];
      const o2 = open[kind];
      if (o2 && mg && o2.strike === mg.strike) { o2.end = t; o2.fuerza = Math.max(o2.fuerza, mg.fuerza); continue; }
      if (o2) open[kind] = null;
      if (mg) { const s: FlowMagnetSegment = { kind, strike: mg.strike, start: t, end: t, fuerza: mg.fuerza }; segs.push(s); open[kind] = s; }
    }
  }
  return segs;
}

/** "2.6K", "591". */
export function fmtFuerza(n: number): string {
  const a = Math.abs(n);
  return a >= 1000 ? `${(a / 1000).toFixed(1)}K` : `${Math.round(a)}`;
}
