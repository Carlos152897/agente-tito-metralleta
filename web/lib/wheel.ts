// Criterio de la Wheel: presets, prima, liquidez, métricas y score.
//
// PURO — no toca red ni disco. La ruta orquesta I/O; aquí solo se decide.
// Un contrato son 100 acciones y el colateral de un cash-secured put es
// strike × 100: ese efectivo queda inmovilizado hasta el vencimiento.

import { probAbove } from "./expectedMove";

const MULTIPLIER = 100;

// ── Presets ────────────────────────────────────────────────────────────

export type PresetId = "conservador" | "balanceado" | "agresivo";

export interface WheelPreset {
  id: PresetId;
  label: string;
  /** |delta| objetivo del put a vender. */
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  /** % de la prima al que conviene recomprar y cerrar. */
  takeProfitPct: number;
  /** DTE al que conviene rolar en vez de esperar. */
  rollDte: number;
  explain: string;
}

export const WHEEL_PRESETS: Record<PresetId, WheelPreset> = {
  conservador: {
    id: "conservador", label: "Conservador",
    deltaMin: 0.10, deltaMax: 0.20, dteMin: 30, dteMax: 45,
    takeProfitPct: 50, rollDte: 21,
    explain: "Strikes lejos del precio: cobras menos, pero te asignan pocas veces.",
  },
  balanceado: {
    id: "balanceado", label: "Balanceado",
    deltaMin: 0.20, deltaMax: 0.30, dteMin: 30, dteMax: 45,
    takeProfitPct: 50, rollDte: 21,
    explain: "El punto medio clásico de la Wheel: prima decente y asignación ocasional.",
  },
  agresivo: {
    id: "agresivo", label: "Agresivo",
    deltaMin: 0.30, deltaMax: 0.40, dteMin: 7, dteMax: 21,
    takeProfitPct: 50, rollDte: 7,
    explain: "Cerca del precio y a poco plazo: cobras más y te asignan mucho más seguido.",
  },
};

// ── Cascada de prima ───────────────────────────────────────────────────

export type PremiumSource = "bid" | "ultimo" | "modelo";

/**
 * Recorte por fuente. Existe porque VENDES AL BID: un mid o un último precio
 * te haría creer que cobras más de lo que realmente cobrarías.
 */
export const HAIRCUT: Record<PremiumSource, number> = {
  bid: 0,
  ultimo: 0.10,
  modelo: 0.15,
};

export interface PremiumPick {
  /** Prima por acción ya recortada — la que se usa en todos los cálculos. */
  price: number;
  source: PremiumSource;
  /** El valor antes del recorte, para poder mostrarlo. */
  raw: number;
}

export function pickPremium(input: {
  bid?: number | null;
  ask?: number | null;
  lastTrade?: number | null;
  model?: number | null;
}): PremiumPick | null {
  const pick = (raw: number | null | undefined, source: PremiumSource): PremiumPick | null =>
    raw != null && raw > 0
      ? { price: raw * (1 - HAIRCUT[source]), source, raw }
      : null;

  return pick(input.bid, "bid") ?? pick(input.lastTrade, "ultimo") ?? pick(input.model, "modelo");
}

// ── Liquidez: la salvaguarda ───────────────────────────────────────────

export type WheelBlockReason = "sin_bid" | "spread_ancho" | "oi_bajo";

export const MAX_SPREAD_PCT = 25;
export const MIN_OI = 100;

/** Spread relativo al mid, en %. null si falta un lado de la horquilla. */
export function spreadPctOf(bid: number | null | undefined, ask: number | null | undefined): number | null {
  if (!(bid != null && bid > 0) || !(ask != null && ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return null;
  return ((ask - bid) / mid) * 100;
}

/**
 * Regla crítica del proyecto: ante la duda, no operar y avisar. Un candidato
 * bloqueado se muestra SIN número de prima y fuera de la lista de operables.
 */
export function liquidityBlock(input: {
  bid?: number | null;
  ask?: number | null;
  openInterest: number;
}): WheelBlockReason | null {
  if (!(input.bid != null && input.bid > 0)) return "sin_bid";
  const spread = spreadPctOf(input.bid, input.ask);
  if (spread == null || spread > MAX_SPREAD_PCT) return "spread_ancho";
  if (input.openInterest < MIN_OI) return "oi_bajo";
  return null;
}

// ── Métricas del candidato ─────────────────────────────────────────────

export interface WheelMetrics {
  /** Prima que cobras por un contrato, en $. */
  credit: number;
  /** Efectivo que queda inmovilizado, en $. */
  collateral: number;
  /** Retorno sobre el colateral en el periodo, en %. */
  returnPct: number;
  /** El mismo retorno llevado a un año, en %. */
  annualizedPct: number;
  /** Por debajo de este precio empiezas a perder. */
  breakeven: number;
  /** Distancia del spot al breakeven, en % del spot. */
  cushionPct: number;
  /** P(expire sin valor) en 0-100. */
  probExpireWorthless: number;
}

export function wheelMetrics(input: {
  strike: number;
  /** Prima por acción, ya recortada. */
  price: number;
  spot: number;
  dte: number;
  /** IV decimal del strike. */
  iv: number;
}): WheelMetrics {
  const { strike, price, spot, dte, iv } = input;
  const credit = price * MULTIPLIER;
  const collateral = strike * MULTIPLIER;
  const returnPct = collateral > 0 ? (credit / collateral) * 100 : 0;
  // Un DTE de 0 haría infinito el anualizado: se trata como 1 día.
  const annualizedPct = returnPct * (365 / Math.max(dte, 1));
  const breakeven = strike - price;
  const cushionPct = spot > 0 ? ((spot - breakeven) / spot) * 100 : 0;
  const probExpireWorthless = probAbove(spot, strike, iv, dte) * 100;

  return { credit, collateral, returnPct, annualizedPct, breakeven, cushionPct, probExpireWorthless };
}
