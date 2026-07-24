// Sub-agente 6 — Validación de Flows / Confirmación de Precio (15% del scorecard).
// Fuente: SCOREDCARD/Validacion-Flows.md.
//
// La pregunta: después de que un flow aparece, ¿el precio lo VALIDA o lo ABSORBE?
// Para cada flow guardado se mide cuánto tiempo pasó y cuánto se movió el precio
// a favor y en contra del contrato (excursión máxima favorable / adversa), que es
// exactamente lo que pide el documento: "cuánto tiempo ha tardado en desarrollarse
// ese movimiento, tanto al alza del contrato como a la baja".
//
// AVISO: este PDF, a diferencia de los otros cinco, NO trae tabla de puntos. Las
// bandas de abajo son una PROPUESTA construida con el mismo estilo que las demás
// categorías; están aisladas en validationPoints/speedPoints para cambiarlas de un
// solo sitio cuando el documento las defina.

export type Direction = "alcista" | "bajista" | "neutral";

export interface FlowLite {
  id: number;
  timestamp: string;
  type: "call" | "put" | "unknown";
  strike: number | null;
  expiration: string | null;
  assetPrice: number;
  premium: number;
  aggression: string; // "ask" | "bid" | "mid"
}

export interface ValBar {
  time: string; // YYYY-MM-DD
  high: number;
  low: number;
  close: number;
}

/** Piso del umbral de movimiento (%) cuando la acción es muy tranquila. */
export const MOVE_THRESHOLD_PCT = 2;
/** Cuántos rangos diarios típicos tiene que moverse el precio para contar. */
export const THRESHOLD_ATR_MULTIPLE = 1.5;
/** Sesiones que se siguen hacia adelante tras cada flow. */
export const HORIZON_SESSIONS = 20;
/** El documento pide al menos 60 días de datos para que el backtest sea fiable. */
export const BACKTEST_TARGET_DAYS = 60;

/**
 * Umbral de movimiento adaptado a la volatilidad de la acción.
 * Un 2% fijo no sirve igual para todos: TSLA recorre 4-5% en un día normal, así que
 * casi cualquier flow "se validaría" en la primera sesión y la medición no diría nada.
 * Se usa el rango diario típico (mediana de high-low en %) × THRESHOLD_ATR_MULTIPLE.
 */
export function adaptiveThreshold(bars: ValBar[], sessions = 60): number {
  const recent = bars.slice(-sessions).filter((b) => b.low > 0);
  if (recent.length < 5) return MOVE_THRESHOLD_PCT;
  const ranges = recent.map((b) => ((b.high - b.low) / b.low) * 100);
  const typical = median(ranges) ?? MOVE_THRESHOLD_PCT;
  return Math.max(MOVE_THRESHOLD_PCT, typical * THRESHOLD_ATR_MULTIPLE);
}

/**
 * Hacia dónde apuesta un flow, según la tabla de interpretación del Proceso Principal:
 * comprar call o vender put = alcista; comprar put o vender call = bajista.
 */
export function flowDirection(type: FlowLite["type"], aggression: string): Direction {
  const bought = aggression === "ask";
  const sold = aggression === "bid";
  if (type === "call") {
    if (bought) return "alcista";
    if (sold) return "bajista"; // vender calls = resistencia / muro
  } else if (type === "put") {
    if (bought) return "bajista";
    if (sold) return "alcista"; // vender puts = soporte
  }
  return "neutral";
}

export interface FlowOutcome {
  id: number;
  timestamp: string;
  type: FlowLite["type"];
  strike: number | null;
  expiration: string | null;
  premium: number;
  direction: Direction;
  entryPrice: number;
  /** Excursión máxima a favor del contrato (%) y sesiones que tardó. */
  mfePct: number;
  daysToMfe: number | null;
  /** Excursión máxima en contra (%) y sesiones que tardó. */
  maePct: number;
  daysToMae: number | null;
  /** Sesiones hasta cruzar el umbral a favor / en contra. */
  daysToValidate: number | null;
  daysToInvalidate: number | null;
  /** Sesiones observadas desde el flow. */
  sessionsObserved: number;
  /** Días naturales transcurridos desde el flow. */
  daysElapsed: number;
  /** true = el precio confirmó antes de ir en contra. */
  validated: boolean;
  /** false = demasiado reciente para juzgarlo. */
  resolved: boolean;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Sigue un flow hacia adelante en las barras diarias y mide qué hizo el precio.
 * Solo cuentan las sesiones POSTERIORES al día del flow (el mismo día ya está
 * contaminado por el propio trade).
 */
export function evaluateFlow(
  flow: FlowLite,
  bars: ValBar[],
  now: Date,
  thresholdPct = MOVE_THRESHOLD_PCT,
  horizon = HORIZON_SESSIONS,
): FlowOutcome {
  const day = flow.timestamp.slice(0, 10);
  const entry = flow.assetPrice;
  const direction = flowDirection(flow.type, flow.aggression);
  const daysElapsed = Math.max(0, daysBetween(flow.timestamp, now.toISOString()));

  const base: FlowOutcome = {
    id: flow.id, timestamp: flow.timestamp, type: flow.type, strike: flow.strike,
    expiration: flow.expiration, premium: flow.premium, direction, entryPrice: entry,
    mfePct: 0, daysToMfe: null, maePct: 0, daysToMae: null,
    daysToValidate: null, daysToInvalidate: null,
    sessionsObserved: 0, daysElapsed, validated: false, resolved: false,
  };

  if (!(entry > 0) || direction === "neutral") return base;

  // Sesiones posteriores al día del flow, hasta el vencimiento o el horizonte.
  let forward = bars.filter((b) => b.time > day);
  if (flow.expiration) forward = forward.filter((b) => b.time <= flow.expiration!);
  forward = forward.slice(0, horizon);
  if (forward.length === 0) return base;

  const up = direction === "alcista";
  let mfe = 0, mae = 0;
  let daysToMfe: number | null = null, daysToMae: number | null = null;
  let daysToValidate: number | null = null, daysToInvalidate: number | null = null;

  forward.forEach((b, i) => {
    const session = i + 1;
    // A favor del contrato: para un alcista, el máximo; para un bajista, el mínimo.
    const fav = up ? ((b.high - entry) / entry) * 100 : ((entry - b.low) / entry) * 100;
    const adv = up ? ((entry - b.low) / entry) * 100 : ((b.high - entry) / entry) * 100;

    if (fav > mfe) { mfe = fav; daysToMfe = session; }
    if (adv > mae) { mae = adv; daysToMae = session; }
    if (daysToValidate == null && fav >= thresholdPct) daysToValidate = session;
    if (daysToInvalidate == null && adv >= thresholdPct) daysToInvalidate = session;
  });

  // Se juzga cuando cruzó algún umbral, o cuando ya se agotó la observación.
  const hitSomething = daysToValidate != null || daysToInvalidate != null;
  const exhausted = forward.length >= horizon;
  const resolved = hitSomething || exhausted;

  // Validado = confirmó a favor ANTES de irse en contra.
  const validated =
    daysToValidate != null &&
    (daysToInvalidate == null || daysToValidate <= daysToInvalidate);

  return {
    ...base,
    mfePct: mfe, daysToMfe, maePct: mae, daysToMae,
    daysToValidate, daysToInvalidate,
    sessionsObserved: forward.length,
    validated, resolved,
  };
}

// ---------- puntuación (PROPUESTA — el PDF no trae tabla) ----------

export interface ValBand { points: number; band: string }

/** Parámetro 1 — Tasa de validación: de los flows ya juzgados, cuántos confirmó el precio. */
export function validationPoints(hitRatePct: number | null): ValBand {
  if (hitRatePct == null || !Number.isFinite(hitRatePct)) return { points: 0, band: "sin datos" };
  if (hitRatePct >= 70) return { points: 10, band: "≥70% — el precio valida casi siempre" };
  if (hitRatePct >= 60) return { points: 8, band: "60-69% — valida con frecuencia" };
  if (hitRatePct >= 50) return { points: 6, band: "50-59% — valida más de lo que absorbe" };
  if (hitRatePct >= 40) return { points: 4, band: "40-49% — mezclado" };
  if (hitRatePct >= 30) return { points: 2, band: "30-39% — el precio suele absorber" };
  return { points: 0, band: "<30% — el precio absorbe el flujo" };
}

/** Parámetro 2 — Velocidad: mediana de sesiones que tarda en desarrollarse el movimiento. */
export function speedPoints(medianSessions: number | null): ValBand {
  if (medianSessions == null || !Number.isFinite(medianSessions)) return { points: 0, band: "sin datos" };
  if (medianSessions <= 2) return { points: 10, band: "≤2 sesiones — reacción inmediata" };
  if (medianSessions <= 5) return { points: 8, band: "3-5 sesiones — reacción rápida" };
  if (medianSessions <= 10) return { points: 6, band: "6-10 sesiones — desarrollo medio" };
  if (medianSessions <= 15) return { points: 4, band: "11-15 sesiones — lento" };
  return { points: 2, band: ">15 sesiones — muy lento" };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- reporte ----------

export interface ValidationScore {
  score: number;
  hitRate: { value: number | null; validated: number; resolved: number; points: number; band: string };
  speed: { medianSessions: number | null; points: number; band: string };
  /** Tasa ponderada por premium: ¿el dinero grande acertó más que el chico? */
  weightedHitRate: number | null;
  avgMfe: number | null;
  avgMae: number | null;
  byDirection: { direction: Direction; total: number; validated: number; hitRate: number | null }[];
  outcomes: FlowOutcome[];
  /** Umbral de movimiento usado (%), adaptado a la volatilidad del ticker. */
  thresholdPct: number;
  coverage: {
    /** Días naturales que cubre el historial guardado. */
    days: number;
    sessions: number;
    flows: number;
    pending: number;
    /** true si aún no llegamos a los 60 días que pide el documento. */
    belowTarget: boolean;
    firstFlow: string | null;
    lastFlow: string | null;
  };
  verdict: string;
}

const EMPTY: ValidationScore = {
  score: 0,
  hitRate: { value: null, validated: 0, resolved: 0, points: 0, band: "sin datos" },
  speed: { medianSessions: null, points: 0, band: "sin datos" },
  weightedHitRate: null, avgMfe: null, avgMae: null,
  byDirection: [], outcomes: [], thresholdPct: MOVE_THRESHOLD_PCT,
  coverage: { days: 0, sessions: 0, flows: 0, pending: 0, belowTarget: true, firstFlow: null, lastFlow: null },
  verdict: "Sin flows guardados todavía para validar.",
};

export interface ValidationInput {
  flows: FlowLite[];
  bars: ValBar[];
  now: Date;
  thresholdPct?: number;
  horizon?: number;
}

export function validationScore(input: ValidationInput): ValidationScore {
  const { flows, bars, now, horizon = HORIZON_SESSIONS } = input;
  if (flows.length === 0 || bars.length === 0) return EMPTY;

  const sorted = [...bars].sort((a, b) => a.time.localeCompare(b.time));
  const thresholdPct = input.thresholdPct ?? adaptiveThreshold(sorted);
  const outcomes = flows
    .map((f) => evaluateFlow(f, sorted, now, thresholdPct, horizon))
    .filter((o) => o.direction !== "neutral")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const resolved = outcomes.filter((o) => o.resolved);
  const validated = resolved.filter((o) => o.validated);
  const hitRateValue = resolved.length > 0 ? (validated.length / resolved.length) * 100 : null;

  // Ponderada por premium: pesa más el acierto del dinero grande.
  let wTotal = 0, wHit = 0;
  for (const o of resolved) {
    wTotal += o.premium;
    if (o.validated) wHit += o.premium;
  }
  const weightedHitRate = wTotal > 0 ? (wHit / wTotal) * 100 : null;

  const medianSessions = median(
    validated.map((o) => o.daysToValidate!).filter((d) => d != null),
  );

  const hr = validationPoints(hitRateValue);
  const sp = speedPoints(medianSessions);

  const byDirection = (["alcista", "bajista"] as Direction[]).map((direction) => {
    const set = resolved.filter((o) => o.direction === direction);
    const ok = set.filter((o) => o.validated).length;
    return {
      direction, total: set.length, validated: ok,
      hitRate: set.length > 0 ? (ok / set.length) * 100 : null,
    };
  });

  const stamps = outcomes.map((o) => o.timestamp).sort();
  const firstFlow = stamps[0] ?? null;
  const lastFlow = stamps[stamps.length - 1] ?? null;
  const days = firstFlow && lastFlow ? daysBetween(firstFlow, lastFlow) : 0;
  const sessions = new Set(outcomes.map((o) => o.timestamp.slice(0, 10))).size;

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  const verdict =
    hitRateValue == null ? "Aún no hay flows con suficiente recorrido para juzgarlos."
      : hitRateValue >= 60 ? "El precio confirma el flujo: cuando entra dinero grande, el movimiento aparece."
        : hitRateValue >= 45 ? "Confirmación mezclada: el flujo acierta y falla en proporciones parecidas."
          : "El precio absorbe el flujo: entra dinero grande pero el movimiento no se desarrolla.";

  return {
    score: Math.round((hr.points + sp.points) / 2),
    hitRate: {
      value: hitRateValue, validated: validated.length, resolved: resolved.length,
      points: hr.points, band: hr.band,
    },
    speed: { medianSessions, points: sp.points, band: sp.band },
    weightedHitRate,
    thresholdPct,
    avgMfe: avg(resolved.map((o) => o.mfePct)),
    avgMae: avg(resolved.map((o) => o.maePct)),
    byDirection,
    outcomes,
    coverage: {
      days, sessions, flows: outcomes.length,
      pending: outcomes.length - resolved.length,
      belowTarget: days < BACKTEST_TARGET_DAYS,
      firstFlow, lastFlow,
    },
    verdict,
  };
}
