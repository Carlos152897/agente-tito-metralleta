// Criterio de la Wheel: presets, prima, liquidez, métricas y score.
//
// PURO — no toca red ni disco. La ruta orquesta I/O; aquí solo se decide.
// Un contrato son 100 acciones y el colateral de un cash-secured put es
// strike × 100: ese efectivo queda inmovilizado hasta el vencimiento.

import { probAbove } from "./expectedMove";
import type { Level } from "./levels";

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

// ── Score compuesto Wheel (0-100) ──────────────────────────────────────

/** Estado del riesgo de reporte dentro del vencimiento. */
export type EarningsFlag = "fuera" | "dentro" | "dentro_confirmado" | "no_aplica";

export interface ScorePart {
  points: number;
  max: number;
  band: string;
  /** Por qué, en llano. Se muestra tal cual en la UI. */
  why: string;
}

export interface WheelScore {
  total: number;
  annualized: ScorePart;
  ivRank: ScorePart;
  cushion: ScorePart;
  liquidity: ScorePart;
  earnings: ScorePart;
}

export interface ScoreInput {
  annualizedPct: number;
  /** 0-100. null si no hay historia suficiente. */
  ivRank: number | null;
  strike: number;
  spot: number;
  cushionPct: number;
  /** Soportes del ticker, de findLevels. */
  supports: Level[];
  openInterest: number;
  /** Spread relativo en %, de spreadPctOf. */
  spreadPct: number | null;
  earnings: EarningsFlag;
}

/** Fuerza mínima para considerar que un soporte de verdad sostiene. */
const STRONG_SUPPORT = 35;

function annualizedPart(pct: number): ScorePart {
  // El castigo por encima del 60% es DELIBERADO: un screener que ordena por
  // prima pone arriba justo las acciones que están a punto de desplomarse.
  if (pct > 60)
    return { points: 10, max: 30, band: ">60%",
      why: "Prima sospechosamente alta: el mercado descuenta una caída fuerte." };
  if (pct >= 35)
    return { points: 22, max: 30, band: "35-60%",
      why: "Rendimiento muy alto — bien pagado, pero comprueba por qué paga tanto." };
  if (pct >= 15)
    return { points: 30, max: 30, band: "15-35%",
      why: "Rendimiento en el rango sano para vender puts." };
  if (pct >= 8)
    return { points: 18, max: 30, band: "8-15%",
      why: "Rendimiento modesto pero razonable." };
  return { points: 5, max: 30, band: "<8%",
    why: "Lo que cobras no paga el riesgo de quedarte con las acciones." };
}

function ivRankPart(rank: number | null): ScorePart {
  // OJO: banda INVERTIDA respecto a ivcontext.ts. Allí el pico está en 16-30
  // porque el resto del agente COMPRA opciones y quiere vega barata. La Wheel
  // VENDE: quiere que la volatilidad esté cara.
  if (rank == null)
    return { points: 4, max: 20, band: "sin datos",
      why: "Sin historia suficiente para saber si la volatilidad está cara o barata." };
  if (rank > 70)
    return { points: 20, max: 20, band: ">70",
      why: "La volatilidad está cara frente a su propio año: buen momento para vender prima." };
  if (rank >= 50)
    return { points: 16, max: 20, band: "50-70",
      why: "Volatilidad por encima de su media anual." };
  if (rank >= 30)
    return { points: 10, max: 20, band: "30-50",
      why: "Volatilidad en su zona media." };
  return { points: 4, max: 20, band: "<30",
    why: "La volatilidad está barata: te pagan poco por asumir el riesgo." };
}

function cushionPart(input: ScoreInput): ScorePart {
  const below = input.supports.filter((s) => s.price >= input.strike);
  const strongest = below.reduce<Level | null>(
    (best, s) => (best == null || s.strength > best.strength ? s : best), null);

  if (strongest && strongest.strength >= STRONG_SUPPORT)
    return { points: 25, max: 25, band: "bajo soporte fuerte",
      why: `El strike queda bajo un soporte de fuerza ${Math.round(strongest.strength)}: el precio ya rebotó ahí antes.` };
  if (strongest)
    return { points: 15, max: 25, band: "bajo soporte débil",
      why: "El strike queda bajo un soporte, pero flojo." };
  if (input.cushionPct > 10)
    return { points: 12, max: 25, band: "colchón >10%",
      why: "Sin soporte identificado, pero la acción tendría que caer más de un 10% para hacerte daño." };
  return { points: 5, max: 25, band: "sin colchón",
    why: "El strike está por encima del soporte más cercano: te pueden asignar con facilidad." };
}

function liquidityPart(oi: number, spreadPct: number | null): ScorePart {
  // Las bandas se evalúan EN ORDEN y gana la primera que se cumple: un OI de
  // 800 con spread del 20% cae a la tercera, no cobra la primera.
  const s = spreadPct ?? Infinity;
  if (oi >= 500 && s <= 10)
    return { points: 15, max: 15, band: "excelente",
      why: "Contrato muy negociado y con horquilla estrecha: entras y sales sin regalar dinero." };
  if (oi >= 250 && s <= 15)
    return { points: 10, max: 15, band: "buena",
      why: "Liquidez suficiente para entrar y salir." };
  if (oi >= MIN_OI && s <= MAX_SPREAD_PCT)
    return { points: 5, max: 15, band: "justa",
      why: "Liquidez ajustada: la horquilla te va a costar al cerrar." };
  return { points: 0, max: 15, band: "insuficiente",
    why: "Liquidez insuficiente." };
}

function earningsPart(flag: EarningsFlag): ScorePart {
  switch (flag) {
    case "no_aplica":
      return { points: 10, max: 10, band: "no aplica",
        why: "No reporta resultados: no hay riesgo de reporte." };
    case "fuera":
      return { points: 10, max: 10, band: "fuera",
        why: "El reporte estimado cae después del vencimiento." };
    case "dentro":
      return { points: 3, max: 10, band: "dentro",
        why: "El reporte estimado cae ANTES del vencimiento — es una estimación, verifícala." };
    case "dentro_confirmado":
      return { points: 0, max: 10, band: "dentro, confirmado",
        why: "El reporte cae antes del vencimiento y la volatilidad del frente lo confirma." };
  }
}

export function scoreCandidate(input: ScoreInput): WheelScore {
  const annualized = annualizedPart(input.annualizedPct);
  const ivRank = ivRankPart(input.ivRank);
  const cushion = cushionPart(input);
  const liquidity = liquidityPart(input.openInterest, input.spreadPct);
  const earnings = earningsPart(input.earnings);
  const total = annualized.points + ivRank.points + cushion.points + liquidity.points + earnings.points;
  return { total, annualized, ivRank, cushion, liquidity, earnings };
}
