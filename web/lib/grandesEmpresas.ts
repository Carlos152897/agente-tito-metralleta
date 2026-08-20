// "Grandes empresas" (Prueba de Fuego, ago 2026, pedido explícito de Carlos):
// universo curado — las Magnificent Seven (AAPL, MSFT, GOOGL, AMZN, NVDA,
// META, TSLA) + PLTR, IREN, NFLX, SPCX, INTC, ORCL. Reusa el motor de
// "Contratos vecinos 3.0" (lib/contratosVecinos3.ts) tal cual — solo cambia
// de dónde sale la cadena de opciones (Massive, vencimiento más cercano
// disponible, no 0DTE fijo de índice — ver lib/massive.ts `fetchNearTermChain`).

import { daysToExpiration, marketDateStr } from "./occ";

export interface GrandesEmpresaTicker {
  id: string;
  label: string;
}

export const GRANDES_EMPRESAS: GrandesEmpresaTicker[] = [
  { id: "AAPL", label: "AAPL" },
  { id: "MSFT", label: "MSFT" },
  { id: "GOOGL", label: "GOOGL" },
  { id: "AMZN", label: "AMZN" },
  { id: "NVDA", label: "NVDA" },
  { id: "META", label: "META" },
  { id: "TSLA", label: "TSLA" },
  { id: "PLTR", label: "PLTR" },
  { id: "IREN", label: "IREN" },
  { id: "NFLX", label: "NFLX" },
  { id: "SPCX", label: "SPCX" },
  { id: "INTC", label: "INTC" },
  { id: "ORCL", label: "ORCL" },
];

export const GRANDES_EMPRESAS_TICKERS = new Set(GRANDES_EMPRESAS.map((t) => t.id));
export const DEFAULT_GRANDES_EMPRESA = "AAPL";

/**
 * Ventana de vencimiento que se pide a Massive (`fetchNearTermChain`). 21
 * días de margen: la mayoría de esta lista tiene opciones semanales (el
 * próximo vencimiento cae dentro de 7 días), pero no todas tienen diarias —
 * de menos margen se corre el riesgo de no encontrar NINGÚN vencimiento para
 * un ticker de solo mensuales.
 */
export const NEAR_TERM_DTE_MAX = 21;

/**
 * Vencimientos para el motor de Contratos 3.0 en Grandes empresas — pedido
 * explícito de Carlos (2026-08-20, refinado dos veces el mismo día): TODOS
 * los vencimientos reales desde HOY (inclusive — 0DTE si hoy es día de
 * vencimiento) hasta el viernes de la semana que se está operando, sin
 * cruzar nunca a la semana siguiente ("recuerda: de la semana que estás
 * operando"). Varias de esta lista cotizan lunes/miércoles/viernes (3 veces
 * por semana), así que según el día da distinta combinación — las 5 dio
 * Carlos explícitamente:
 *   lunes    → 0DTE de hoy + miércoles + viernes (los 3)
 *   martes   → miércoles + viernes (sin 0DTE propio ese día)
 *   miércoles→ 0DTE de hoy + viernes
 *   jueves   → viernes (sin 0DTE propio ese día)
 *   viernes  → 0DTE de hoy, nada más (ya es el último día de la semana)
 * Si el ticker no tiene NINGÚN vencimiento dentro de esta semana (solo
 * mensuales lejanos), cae al único vencimiento real más cercano que exista,
 * aunque caiga fuera de esta semana — mejor eso que no operar nada.
 */
export function selectWeeklyExpirations(allExpirations: string[], now: Date): string[] {
  const all = [...new Set(allExpirations)]
    .filter((e) => daysToExpiration(e, now) >= 0)
    .sort((a, b) => daysToExpiration(a, now) - daysToExpiration(b, now));
  if (all.length === 0) return [];

  const todayStr = marketDateStr(now);
  const weekday = new Date(`${todayStr}T00:00:00Z`).getUTCDay(); // 0=dom..6=sáb
  const daysToFriday = (5 - weekday + 7) % 7; // 0 si hoy ya es viernes

  const thisWeek = all.filter((e) => daysToExpiration(e, now) <= daysToFriday);
  return thisWeek.length > 0 ? thisWeek : [all[0]];
}
