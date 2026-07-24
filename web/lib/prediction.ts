// Prediction Pro — el cierre del sistema.
//
// Junta lo que producen los 6 sub-agentes, el mapa de GEX y la matemática de
// desviación estándar en tres escenarios legibles (bajista / base / alcista) y un
// resumen en lenguaje llano.
//
// Regla de oro heredada de la Guía GEX: el GEX **confirma, no adivina**. Por eso
// ningún escenario puede salirse del cono de 2σ — la volatilidad manda sobre el
// posicionamiento.

import { expectedMove, levelProbabilities, probTouch, type LevelProb } from "./expectedMove";

export type ScenarioKind = "bear" | "base" | "bull";

export interface Scenario {
  kind: ScenarioKind;
  target: number;
  changePct: number;
  /** Probabilidad de que el precio toque ese nivel dentro del horizonte (0-1). */
  probability: number;
  /** Qué sostiene el escenario, en una línea. */
  driver: string;
}

export interface HorizonOption {
  days: number;
  label: string;
}

export const HORIZONS: HorizonOption[] = [
  { days: 10, label: "10 días" },
  { days: 20, label: "20 días" },
  { days: 30, label: "30 días" },
];

export interface SubScores {
  aggression: number | null;
  conviction: number | null;
  unusuality: number | null;
  structure: number | null;
  ivContext: number | null;
  validation: number | null;
}

/** Pesos del scorecard (suman 100). */
export const WEIGHTS: Record<keyof SubScores, number> = {
  aggression: 20, conviction: 20, unusuality: 20,
  structure: 15, ivContext: 10, validation: 15,
};

export interface PredictionInput {
  spot: number;
  iv: number;
  horizonDays: number;
  /** Nodos del GEX: strike, concentración de dinero y lado. */
  nodes: { strike: number; concentration: number; side: "call" | "put"; netGex: number }[];
  scores: SubScores;
  /** Régimen gamma: positivo revierte, negativo amplifica. */
  regime: "positive" | "negative";
  /** % del premium notable que está en calls (dirección del dinero). */
  callPct: number | null;
  /** Tasa de acierto histórica del sub-agente 6 (0-100). */
  hitRate: number | null;
  lowLiquidity: boolean;
}

export interface ProPrediction {
  horizonDays: number;
  spot: number;
  iv: number;
  bear: Scenario;
  base: Scenario;
  bull: Scenario;
  /** Sentiment 0-100 ponderado por los pesos del scorecard. */
  score: number;
  /** Categorías con dato / total. */
  active: number;
  confidence: number;
  levels: LevelProb[];
  direction: "up" | "down" | "flat";
  summary: string;
  caveat: string | null;
}

/** Sentiment 0-100: promedio ponderado de las categorías que ya tienen dato. */
export function weightedScore(scores: SubScores): { score: number; active: number; weight: number } {
  let pts = 0, weight = 0, active = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof SubScores)[]) {
    const s = scores[key];
    if (s == null) continue;
    active += 1;
    weight += WEIGHTS[key];
    pts += (s / 10) * WEIGHTS[key];
  }
  return { score: weight > 0 ? Math.round((pts / weight) * 100) : 0, active, weight };
}

function pctChange(spot: number, target: number): number {
  return spot > 0 ? ((target - spot) / spot) * 100 : 0;
}

/**
 * Confianza 0-100: mezcla cuánto domina el nivel imán, cuántas categorías
 * respondieron y qué tan bien viene acertando el backtest.
 */
export function confidenceOf(
  levels: LevelProb[],
  active: number,
  hitRate: number | null,
  lowLiquidity: boolean,
): number {
  if (lowLiquidity || levels.length === 0) return 0;
  // Un solo nivel con ≥50% del peso ya es "nitidez máxima": por eso ×2 y se acota.
  const sharpness = Math.min(1, levels[0].magnet * 2);
  const coverage = Math.min(1, active / 6);
  const track = hitRate == null ? 0.5 : Math.min(1, Math.max(0, hitRate / 100));
  const raw = 0.45 * sharpness + 0.30 * coverage + 0.25 * track;
  return Math.round(100 * Math.min(1, Math.max(0, raw)));
}

export function predictPro(input: PredictionInput): ProPrediction {
  const { spot, iv, horizonDays, nodes, scores, regime, callPct, hitRate, lowLiquidity } = input;
  const em = expectedMove(spot, iv, horizonDays);
  const levels = levelProbabilities(spot, iv, horizonDays, nodes).slice(0, 10);

  const { score, active } = weightedScore(scores);

  // BASE = el nivel de mayor peso (probabilidad × dinero). Es el imán.
  const magnet = levels[0] ?? null;
  const baseTarget = magnet ? magnet.strike : spot;

  // Bull y bear se buscan EXCLUYENDO el nivel base: si no, cuando el imán ya está
  // arriba (o abajo) los tres escenarios colapsan en el mismo precio.
  const others = levels.filter((l) => l.strike !== baseTarget);
  const above = others.filter((l) => l.strike > spot).sort((a, b) => b.magnet - a.magnet)[0];
  const below = others.filter((l) => l.strike < spot).sort((a, b) => b.magnet - a.magnet)[0];

  // BULL = el nivel relevante por encima; si no hay, el techo de 1σ.
  let bullTarget = above ? above.strike : em.upper1;
  // BEAR = el nivel relevante por debajo; si no hay, el suelo de 1σ.
  let bearTarget = below ? below.strike : em.lower1;

  // El bear tiene que ser MÁS bajista que el base y el bull más alcista: si el
  // muro más cercano se queda corto, el escenario lo marca la volatilidad (1σ).
  if (bearTarget >= baseTarget) bearTarget = Math.min(em.lower1, baseTarget);
  if (bullTarget <= baseTarget) bullTarget = Math.max(em.upper1, baseTarget);

  // Y nada puede salirse del cono de 2σ.
  bearTarget = Math.max(bearTarget, em.lower2);
  bullTarget = Math.min(bullTarget, em.upper2);

  const regimeWord = regime === "positive"
    ? "el dealer estabiliza (γ+): el precio tiende a frenarse ahí"
    : "el dealer amplifica (γ−): si el precio llega, acelera";

  /** Describe un nivel por lo que significa, no por la etiqueta cruda del GEX. */
  const wallText = (l: LevelProb) =>
    `Gamma concentrada en $${l.strike.toFixed(2)} (dominan ${l.side === "call" ? "calls" : "puts"}) — ${regimeWord}`;

  const bull: Scenario = {
    kind: "bull",
    target: bullTarget,
    changePct: pctChange(spot, bullTarget),
    probability: probTouch(spot, bullTarget, iv, horizonDays),
    driver: above
      ? wallText(above)
      : "Techo de 1σ: hasta aquí llega el movimiento esperado por volatilidad",
  };

  const bear: Scenario = {
    kind: "bear",
    target: bearTarget,
    changePct: pctChange(spot, bearTarget),
    probability: probTouch(spot, bearTarget, iv, horizonDays),
    driver: below
      ? wallText(below)
      : "Suelo de 1σ: hasta aquí llega la caída esperada por volatilidad",
  };

  const base: Scenario = {
    kind: "base",
    target: baseTarget,
    changePct: pctChange(spot, baseTarget),
    probability: magnet ? probTouch(spot, baseTarget, iv, horizonDays) : 0,
    driver: magnet
      ? `Nivel imán: ${(magnet.magnet * 100).toFixed(0)}% del peso del mapa está en $${magnet.strike.toFixed(2)}`
      : "Sin nodos de gamma suficientes para fijar un imán",
  };

  const direction =
    base.changePct > 1 ? "up" : base.changePct < -1 ? "down" : "flat";

  const confidence = confidenceOf(levels, active, hitRate, lowLiquidity);

  // ---- resumen en lenguaje llano ----
  const dirText =
    direction === "up" ? `hacia $${baseTarget.toFixed(2)} (+${base.changePct.toFixed(1)}%)`
      : direction === "down" ? `hacia $${baseTarget.toFixed(2)} (${base.changePct.toFixed(1)}%)`
        : `lateral, cerca de $${baseTarget.toFixed(2)}`;

  const moneyText =
    callPct == null ? "No hay lectura clara del flujo."
      : callPct >= 60 ? `El dinero está ${callPct}% en calls: apuesta al alza.`
        : callPct <= 40 ? `El dinero está ${100 - callPct}% en puts: apuesta a la baja.`
          : `El dinero está repartido (${callPct}% calls): sin apuesta dominante.`;

  const scoreText =
    score >= 70 ? "Las señales de los sub-agentes son fuertes."
      : score >= 50 ? "Las señales de los sub-agentes son mixtas tirando a favorables."
        : score >= 35 ? "Las señales de los sub-agentes son débiles."
          : "Las señales de los sub-agentes son muy débiles.";

  const trackText =
    hitRate == null ? ""
      : ` Históricamente, cuando aparece flujo así en este ticker el precio lo confirmó el ${hitRate.toFixed(0)}% de las veces.`;

  const summary =
    `A ${horizonDays} días el escenario base apunta ${dirText}, dentro de un rango esperado de ` +
    `±${em.sigmaPct.toFixed(1)}% (1σ). ${moneyText} ${scoreText}${trackText}`;

  const caveat = lowLiquidity
    ? "Cadena de baja liquidez: la predicción se marca como NO FIABLE y no debe usarse para operar."
    : active < 6
      ? `Solo ${active} de 6 sub-agentes tienen dato; la confianza está recortada.`
      : null;

  return {
    horizonDays, spot, iv,
    bear, base, bull,
    score, active, confidence, levels, direction,
    summary, caveat,
  };
}
