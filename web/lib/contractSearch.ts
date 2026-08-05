// "Búsqueda de contratos" — escáner de mercado completo (no solo TSLA/SPX) para
// la pestaña de Prueba de Fuego. PURO — reusa FlowRow de lib/flow.ts, ya
// clasificado por classifyFlow/passesQualityFilter/isTradeableIdea en la ruta.

import type { FlowRow } from "./flow";
import { expectedMove, probTouch } from "./expectedMove";

export const FAVORITES_COUNT = 5;

/**
 * SPX (raíz OCC "SPXW") ya tiene su propio botón dedicado en Prueba de Fuego
 * — pedido explícito de Carlos (2026-07-30) de sacarlo de acá. Se usa tanto
 * para filtrar el escaneo del servidor (app/api/contract-search/route.ts)
 * como para purgar del navegador los favoritos SPX/SPXW que ya se hubieran
 * guardado de antes de este cambio (ContractSearchTab.tsx) — sin la purga,
 * quedarían visibles para siempre, porque la "foto" de un favorito nunca se
 * pisa sola.
 */
export const EXCLUDED_TICKERS = new Set(["SPX", "SPXW"]);

/**
 * Ordena por agresividad: solo compras al ask, primero las que ya superaron el
 * Open Interest (`flags.exceededOI` — dinero nuevo entrando, no solo rotación),
 * y dentro de eso por premium. Es el mismo criterio de "dinero real" que ya usa
 * el resto del agente, aplicado a rankear en vez de solo filtrar.
 */
export function rankByAggression(rows: FlowRow[]): FlowRow[] {
  return rows
    .filter((r) => r.aggression === "ask")
    .sort((a, b) => {
      if (a.flags.exceededOI !== b.flags.exceededOI) return a.flags.exceededOI ? -1 : 1;
      return b.premium - a.premium;
    });
}

export const MAX_STRIKE_DISTANCE_PCT = 3; // % vs el precio del subyacente al momento del trade

/**
 * ¿El strike está razonablemente cerca del precio del subyacente al momento del
 * trade (ATM o levemente ITM/OTM), en vez de deep ITM/OTM? Sin este filtro la
 * búsqueda podía devolver contratos como un call $45 con el subyacente en $91 —
 * ya muy lejos del precio actual para servir como target accionable. Carlos pidió
 * explícitamente contratos "at the money o in the money, no tan lejos". Bajado de
 * 15% a 3% el 2026-07-28 al ver en vivo que 15% dejaba pasar cosas como SOXX
 * put $530 con el subyacente en $485.85 (9.1% lejos) — muy OTM para servir de ATM.
 */
export function isNearMoney(row: FlowRow, maxPct: number = MAX_STRIKE_DISTANCE_PCT): boolean {
  if (row.strike == null || !(row.assetPrice > 0)) return false;
  return (Math.abs(row.strike - row.assetPrice) / row.assetPrice) * 100 <= maxPct;
}

export const MAX_DTE = 5; // day-trading: nunca más de 5 días hasta el vencimiento

/**
 * ¿Vence dentro de la ventana de day-trading (0-5 días)? `FlowRow.dte` ya viene
 * calculado desde el símbolo OCC del trade (lib/flow.ts). Sin este filtro la
 * búsqueda devolvía vencimientos de meses/años (LEAPS) — inútiles para operar
 * hoy o esta semana.
 */
export function isNearExpiration(row: FlowRow, maxDte: number = MAX_DTE): boolean {
  return row.dte != null && row.dte >= 0 && row.dte <= maxDte;
}

export const MIN_CONVICTION_PCT = 50;

export interface TargetProjection {
  target: number | null;
  convictionPct: number | null;
  changePctToTarget: number | null;
  estUsdGain: number | null;
}

/**
 * Target real de precio + convicción estadística de llegar ahí — NO el strike
 * del contrato. El strike solo dice CUÁL contrato comprar (por su delta); no es
 * una proyección de hacia dónde va el subyacente, y usarlo como "target" podía
 * mostrar un target al revés de la apuesta (ej. un put ya ITM con "target"
 * arriba del spot actual, como si hubiera que subir para "llegar" ahí).
 *
 * Reusa el mismo modelo de movimiento esperado que ya corre el resto del agente
 * (lib/expectedMove.ts) en vez de correr GEX completo por candidato (carísimo
 * escaneando todo el mercado). Dirección = call arriba / put abajo. El target
 * se fija en la MITAD del movimiento esperado completo (√(dte/4) en vez de
 * √dte, ya que σ ∝ √T) — tocar el 1σ completo ronda ~30% de probabilidad, muy
 * por debajo del piso de convicción que pidió Carlos; a medio camino ronda
 * >50%, y sigue variando de verdad por candidato según su propia IV/DTE (a
 * más IV o más días, más lejos queda ese medio-camino y más baja la convicción
 * de tocarlo — por eso el filtro de MIN_CONVICTION_PCT sí descarta candidatos).
 */
export function estimateTarget(row: FlowRow, liveSpot: number | null): TargetProjection {
  const spot = liveSpot ?? (row.assetPrice > 0 ? row.assetPrice : null);
  if (
    (row.type !== "call" && row.type !== "put") ||
    spot == null ||
    !(spot > 0) ||
    row.dte == null ||
    row.dte < 0 ||
    !(row.iv > 0)
  ) {
    return { target: null, convictionPct: null, changePctToTarget: null, estUsdGain: null };
  }
  const halfMove = expectedMove(spot, row.iv, row.dte / 4);
  const target = row.type === "call" ? halfMove.upper1 : halfMove.lower1;
  const convictionPct = probTouch(spot, target, row.iv, row.dte) * 100;
  const changePctToTarget = ((target - spot) / spot) * 100;
  const estUsdGain = Math.abs(row.delta) * Math.abs(target - spot) * 100;
  return { target, convictionPct, changePctToTarget, estUsdGain };
}
