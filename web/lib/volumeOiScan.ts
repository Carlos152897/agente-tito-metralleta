// Escaneo de "volumen ≥ Nx el Open Interest" sobre la cadena de opciones
// COMPLETA de un ticker (todos los strikes y vencimientos) — pedido
// explícito de Carlos (2026-08-27, vía el puente de Telegram): "si te digo
// hood buscame un contrato en call o puts que el volumen sea 3x el OI en la
// cadena de opciones". Distinto de `lib/unusualSwing.ts` (que escanea TODO
// el mercado vía flow_feed con criterios de swing trade — OTM/DTE/premium/
// agresividad al ask): acá es más simple, un solo ticker, la cadena entera
// (snapshot de Massive, `fetchOptionChain`), sin filtro de DTE ni OTM.
//
// Fuente de datos: Massive (`RawContract.day.volume` + `open_interest`), NO
// Robinhood — aunque Carlos pidió específicamente "la cadena de Robinhood",
// el MCP de Robinhood solo es accesible dentro de una sesión de Claude activa
// (mismo límite ya documentado para Schwab/Robinhood en otras partes del
// proyecto), así que el puente de Telegram (un script standalone sin sesión
// de Claude detrás) no puede usarlo — Massive da el mismo dato real
// (volumen + Open Interest por contrato) sin esa limitación.

import type { RawContract } from "./types";

export const VOLUME_OI_RATIO_THRESHOLD = 3;

export interface VolumeOiCandidate {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  volume: number;
  openInterest: number;
  ratio: number;
}

/**
 * Contratos con volumen de HOY ≥ `minRatio` veces su Open Interest — requiere
 * OI > 0 (sin eso el ratio no tiene sentido: cualquier volumen sería
 * "infinito"). Ordenados por ratio descendente (el más inusual primero).
 */
export function findVolumeOiCandidates(
  contracts: RawContract[],
  minRatio: number = VOLUME_OI_RATIO_THRESHOLD,
): VolumeOiCandidate[] {
  const out: VolumeOiCandidate[] = [];
  for (const c of contracts) {
    const oi = c.open_interest ?? 0;
    if (!(oi > 0)) continue;
    const volume = c.day?.volume ?? 0;
    if (volume < minRatio * oi) continue;
    const rawType = c.details?.contract_type;
    const type: "call" | "put" | null = rawType === "call" ? "call" : rawType === "put" ? "put" : null;
    const strike = c.details?.strike_price;
    const expiration = c.details?.expiration_date;
    const symbol = c.details?.ticker;
    if (type == null || strike == null || expiration == null || symbol == null) continue;
    out.push({ symbol, type, strike, expiration, volume, openInterest: oi, ratio: volume / oi });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

export interface TopVolumeContract {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  volume: number;
  openInterest: number;
}

/**
 * El contrato (call o put, cualquier strike) de MAYOR volumen del día, DENTRO
 * de un set de vencimientos dado — pedido explícito de Carlos (2026-08-27,
 * con un ejemplo real: "hoy crm el 250 call de mañana tenia mucho volumen").
 * A diferencia de `findVolumeOiCandidates` (que mira TODA la cadena sin
 * importar vencimiento y exige un ratio contra el OI), esto se acota al
 * vencimiento OBJETIVO real de ese día (`selectWeeklyExpirations`,
 * lib/grandesEmpresas.ts) y no exige ningún ratio — solo "¿cuál tiene más
 * volumen ahí?". `null` si ningún contrato en esos vencimientos tiene
 * volumen > 0.
 */
export function findTopVolumeContract(
  contracts: RawContract[],
  expirations: Set<string>,
): TopVolumeContract | null {
  let best: TopVolumeContract | null = null;
  for (const c of contracts) {
    const expiration = c.details?.expiration_date;
    if (expiration == null || !expirations.has(expiration)) continue;
    const volume = c.day?.volume ?? 0;
    if (!(volume > 0)) continue;
    if (best != null && volume <= best.volume) continue;
    const rawType = c.details?.contract_type;
    const type: "call" | "put" | null = rawType === "call" ? "call" : rawType === "put" ? "put" : null;
    const strike = c.details?.strike_price;
    const symbol = c.details?.ticker;
    if (type == null || strike == null || symbol == null) continue;
    best = { symbol, type, strike, expiration, volume, openInterest: c.open_interest ?? 0 };
  }
  return best;
}
