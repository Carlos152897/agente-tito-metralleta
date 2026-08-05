// Estrategia "pin al imán" del Agente 0DTE — el único setup que evalúa el
// panel "Mejor trade ahora": en gamma positiva, el precio tiende a volver al
// imán del GEX. Pura, sin fs — apta para cliente y servidor. Ver Proceso 0DTE.

export type Direction = "long" | "short";

export interface SimParams {
  /** Distancia mínima al imán (en puntos) para que valga la pena entrar. */
  minDistance: number;
  /** Fracción de la distancia al imán que se usa como stop. */
  stopFraction: number;
}

export const DEFAULT_PARAMS: SimParams = { minDistance: 3, stopFraction: 0.4 };

export interface EntryDecision {
  direction: Direction;
  entry: number;
  target: number;
  stop: number;
  reason: string;
}

/** Riesgo/beneficio = recorrido al target ÷ recorrido al stop. */
export function riskReward(d: EntryDecision): number {
  const reward = Math.abs(d.target - d.entry);
  const risk = Math.abs(d.entry - d.stop);
  return risk > 0 ? reward / risk : 0;
}

/**
 * Evalúa si hay setup "pin al imán" ahora mismo. Solo en gamma positiva (los
 * dealers anclan el precio hacia el imán); en gamma negativa no hay pin
 * fiable, así que no hay setup. PURA.
 */
export function evaluateEntry(
  spot: number,
  regime: "positive" | "negative",
  magnet: number | null,
  flip: number | null,
  params: SimParams = DEFAULT_PARAMS,
): EntryDecision | null {
  if (!(spot > 0) || regime !== "positive" || magnet == null) return null;
  const dist = magnet - spot;
  if (Math.abs(dist) < params.minDistance) return null;

  const direction: Direction = dist > 0 ? "long" : "short";
  const stopDist = Math.abs(dist) * params.stopFraction;
  const stop = direction === "long" ? spot - stopDist : spot + stopDist;

  const flipNote =
    flip != null
      ? ` Zona de inversión gamma en ${flip.toFixed(0)} — si el precio la cruza, el régimen cambia y el setup se invalida.`
      : "";

  return {
    direction,
    entry: spot,
    target: magnet,
    stop,
    reason:
      `Gamma positiva: el precio tiende a revertir hacia el imán ${magnet.toFixed(0)}.` + flipNote,
  };
}

/** Por qué NO hay setup ahora, en una frase. */
export function noSetupReason(
  spot: number | null,
  regime: "positive" | "negative",
  magnet: number | null,
  params: SimParams = DEFAULT_PARAMS,
): string {
  if (spot == null || !(spot > 0)) return "sin precio en vivo.";
  if (regime !== "positive") return "gamma negativa: sin efecto de anclaje fiable, no hay pin.";
  if (magnet == null) return "sin imán de gamma identificable.";
  const dist = Math.abs(magnet - spot);
  if (dist < params.minDistance) {
    return `el precio ya está sobre el imán (${dist.toFixed(1)} pts) — sin recorrido suficiente.`;
  }
  return "sin condiciones claras.";
}
