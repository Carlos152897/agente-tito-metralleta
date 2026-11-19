// Imán Referencia con FILTRO DE POSICIONES ABIERTAS (Carlos, 19-nov-2026, tras la descripción oficial
// de Sofía: "quita el ruido y muestra las posiciones que tentativamente quedan abiertas").
//
// Por strike y por tipo (call / put), acumulado desde la apertura:
//   neto  = contratos al ask − contratos al bid          (compran − venden)
//   abre  = fracción de lo operado que es posición NUEVA = max(0, volumen − OI de apertura) / volumen
//           (lo que cabe dentro del OI de ayer pudo ser cierre → no cuenta; lo que pasa del OI es nuevo).
//           Strike sin OI de ayer → todo es nuevo (abre = 1).
//   neto abierto = neto × abre
// Dirección como Sofía: calls compradas + puts vendidas = arriba (Imán +);
//                       calls vendidas + puts compradas = abajo (Imán −).
//   fuerza del strike = neto abierto calls − neto abierto puts (contratos)
// Imán + = el de mayor fuerza positiva, Imán − = el de mayor negativa, a ±radio del precio.
// El neto ya cancela las idas y vueltas del día (compra al ask y vende al bid = 0). PURO.

import type { StrikeMinute } from "./visionFuturaVolumeDelta";
import type { FlowMagnet, FlowMagnets, FlowMagnetSegment } from "./visionFuturaFlowMagnets";

export const OPEN_MAGNET_TUNING = {
  /** Distancia máxima al precio (pts de SPX; se multiplica por la escala del instrumento). */
  radiusPts: 75,
  /** Contratos netos abiertos mínimos para marcar un imán. */
  minContracts: 10,
};

export interface OpeningOI {
  call: number;
  put: number;
}

interface Acc { cA: number; cB: number; cV: number; pA: number; pB: number; pV: number }

const openFrac = (vol: number, oi: number) => (vol <= 0 ? 0 : Math.max(0, vol - Math.max(0, oi)) / vol);

/** Fuerza abierta (con signo: + arriba, − abajo) de un strike con lo acumulado `a` y su OI de apertura. */
export function openForce(a: Acc, oi: OpeningOI | undefined): number {
  const c = (a.cA - a.cB) * openFrac(a.cV, oi?.call ?? 0);
  const p = (a.pA - a.pB) * openFrac(a.pV, oi?.put ?? 0);
  return c - p;
}

function pick(force: Map<number, number>, spot: number, radius: number, minC: number): FlowMagnets {
  let pos: FlowMagnet | null = null;
  let neg: FlowMagnet | null = null;
  const closer = (a: number, b: number) => Math.abs(a - spot) < Math.abs(b - spot);
  for (const [strike, f0] of force) {
    if (Math.abs(strike - spot) > radius) continue;
    const f = Math.round(f0);
    if (f >= minC && (!pos || f > pos.fuerza || (f === pos.fuerza && closer(strike, pos.strike)))) pos = { strike, fuerza: f };
    if (-f >= minC && (!neg || -f > neg.fuerza || (-f === neg.fuerza && closer(strike, neg.strike)))) neg = { strike, fuerza: -f };
  }
  return { pos, neg };
}

interface Opts { radius?: number; minContracts?: number }

/**
 * Imanes con filtro de posiciones abiertas en `toT` (segundos; minutos con t < toT) y su recorrido
 * minuto a minuto desde `fromT`. `spotAt(t)` = precio en ese minuto (null = se salta).
 */
export function openMagnets(
  by: Map<number, StrikeMinute[]>, oi: Map<number, OpeningOI>, fromT: number, toT: number,
  spotNow: number, spotAt: (t: number) => number | null, o: Opts = {},
): { now: FlowMagnets; history: FlowMagnetSegment[] } {
  const radius = o.radius ?? OPEN_MAGNET_TUNING.radiusPts;
  const minC = o.minContracts ?? OPEN_MAGNET_TUNING.minContracts;
  // Minutos por strike en orden, con un puntero para acumular conforme avanza el reloj.
  const strikes = [...by.entries()].map(([strike, mins]) => ({ strike, mins: [...mins].sort((a, b) => a.t - b.t), i: 0 }));
  const acc = new Map<number, Acc>(strikes.map((s) => [s.strike, { cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0 }]));
  const advance = (upTo: number) => {
    for (const s of strikes) {
      const a = acc.get(s.strike)!;
      while (s.i < s.mins.length && s.mins[s.i].t < upTo) {
        const m = s.mins[s.i++];
        a.cA += m.cA; a.cB += m.cB; a.cV += m.cV; a.pA += m.pA; a.pB += m.pB; a.pV += m.pV;
      }
    }
  };
  const forces = () => new Map([...acc].map(([k, a]) => [k, openForce(a, oi.get(k))] as [number, number]));

  const segs: FlowMagnetSegment[] = [];
  const open: Record<"pos" | "neg", FlowMagnetSegment | null> = { pos: null, neg: null };
  const start0 = Math.floor(fromT / 60) * 60;
  for (let t = start0 + 60; t <= toT; t += 60) {
    advance(t);
    const spot = spotAt(t);
    const cur = spot == null ? { pos: null, neg: null } : pick(forces(), spot, radius, minC);
    for (const kind of ["pos", "neg"] as const) {
      const mg = cur[kind];
      const o2 = open[kind];
      if (o2 && mg && o2.strike === mg.strike) { o2.end = t; o2.fuerza = Math.max(o2.fuerza, mg.fuerza); continue; }
      if (o2) open[kind] = null;
      if (mg) { const sg: FlowMagnetSegment = { kind, strike: mg.strike, start: t, end: t, fuerza: mg.fuerza }; segs.push(sg); open[kind] = sg; }
    }
  }
  advance(toT);
  return { now: pick(forces(), spotNow, radius, minC), history: segs };
}
