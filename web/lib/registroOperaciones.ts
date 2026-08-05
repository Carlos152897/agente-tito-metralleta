// "Registro de Operaciones" — reemplaza a Paper Trading (2026-08-01, pedido
// explícito de Carlos). Ya NO es una cuenta simulada con sizing/stop dinámico:
// es un registro automático de las señales de SPX y TSLA (una por ticker por
// día de mercado, mismo criterio que ya usa `TickerLiveTab`/`dayTradePosition.ts`
// para "la sugerencia se fija una vez por día"), para poder contar cuántas
// sesiones dieron ganancia o pérdida real. PURO — el I/O (fs, quotes, flujo)
// vive en lib/registroOperacionesStore.ts y en la ruta/skill que lo orquesta.
//
// Se guardan AMBOS tipos de señal (`continuation` y `gex_only`, etiquetadas
// con `signalRole`) — confirmado con Carlos: las dos ya combinan flujo real +
// GEX en su origen (ver lib/dayTrade.ts), no hay razón para descartar la
// señal débil del historial, solo para distinguirla.
//
// Salida (confirmado con Carlos, "lo que llegue primero"): (1) el spot toca
// el target sugerido, o (2) la señal se revierte — y la reversión combina
// SIEMPRE dos cosas: el net premium real de contratos vecinos (igual que
// Paper Trading, `neighborContractsConfirmPosition`) Y, SOLO para SPX, un
// cruce del gamma flip de MarketSnack (spot pasa del lado positivo al
// negativo del gamma flip o viceversa — "los market makers están
// rebalanceando el mercado", señal de cambio de régimen de volatilidad, no
// de dirección por sí sola). TSLA nunca usa GEX (regla explícita previa de
// Carlos) — el cruce de gamma flip queda sin efecto ahí (entryGammaFlip
// siempre null). Además, red de seguridad de fin de día (`eod`) para que
// ninguna entrada quede colgada de un día para otro.
//
// Win/loss (confirmado con Carlos: "si pudiste hacer dinero o perder
// dinero"): el signo de la ganancia/pérdida real en $ entre el precio de
// entrada y el de salida de la OPCIÓN — sin importar el motivo de salida.

import { profitSideOf } from "./neighborContracts";
import { buildOccSymbol, marketDateStr } from "./occ";
import type { ContractSuggestion } from "./dayTrade";

export type RegistroExitReason = "target" | "reversal" | "eod";
export type SignalRole = "continuation" | "gex_only";
export type RegistroOutcome = "win" | "loss";

/**
 * Minutos de gracia tras la entrada antes de que una posible reversión pueda
 * cerrar la entrada. Mismo valor y mismo motivo que `FLOW_CHECK_GRACE_MINUTES`
 * de Paper Trading: sin esto, el primer chequeo justo después de entrar lee
 * "todavía no confirma" (no hubo tiempo de acumular volumen) como reversión
 * real — bug ya encontrado y arreglado una vez, no repetirlo acá.
 */
export const REVERSAL_CHECK_GRACE_MINUTES = 15;

export interface RegistroOpenEntry {
  /** Identificador único de ESTA entrada — distinto de `symbol` porque un
   *  ticker en modo "bitácora" (ver `isContinuousLogTicker`) puede tener
   *  varias entradas abiertas a la vez con el MISMO contrato sugerido de
   *  nuevo 5 min después; `symbol` ya no alcanza como clave. */
  id: string;
  ticker: "TSLA" | "SPX";
  occRoot: string;
  symbol: string; // OCC
  type: "call" | "put";
  strike: number;
  expiration: string;
  target: number; // ContractSuggestion.target — nivel del subyacente
  side: "above" | "below"; // dirección para el chequeo de target tocado
  signalRole: SignalRole;
  reason: string;
  entryPrice: number; // premium de la opción al abrir
  entrySpot: number;
  /** Gamma flip de MarketSnack al abrir — SOLO SPX, null para TSLA (sin GEX). */
  entryGammaFlip: number | null;
  enteredAt: string; // ISO
  dayKey: string; // marketDateStr(now) al abrir
}

export interface RegistroClosedEntry extends RegistroOpenEntry {
  exitPrice: number;
  exitSpot: number;
  exitedAt: string;
  exitReason: RegistroExitReason;
  pnlUsd: number;
  pnlPct: number;
  outcome: RegistroOutcome;
}

export interface RegistroStore {
  open: RegistroOpenEntry[];
  closed: RegistroClosedEntry[]; // más reciente primero
}

export function emptyStore(): RegistroStore {
  return { open: [], closed: [] };
}

/** Una entrada por ticker por día de mercado — ya sea abierta o ya cerrada hoy.
 *  Solo aplica a tickers en modo "diario" — ver `isContinuousLogTicker`. */
export function hasLoggedToday(store: RegistroStore, ticker: string, dayKey: string): boolean {
  return (
    store.open.some((e) => e.ticker === ticker && e.dayKey === dayKey) ||
    store.closed.some((e) => e.ticker === ticker && e.dayKey === dayKey)
  );
}

/**
 * Pedido explícito de Carlos (2026-08-04): el botón SPX de Prueba de Fuego
 * pasa a leer/actualizar cada 5 min ("bitácora completa", no una posición fija
 * por día) — cada corrida del agente programado intenta una entrada NUEVA acá
 * sin importar si ya hay otra(s) abierta(s) o si ya se cerró algo hoy. TSLA
 * queda igual que siempre (una por día, `hasLoggedToday` sigue aplicando).
 */
const CONTINUOUS_LOG_TICKERS = new Set(["SPX"]);
export function isContinuousLogTicker(ticker: string): boolean {
  return CONTINUOUS_LOG_TICKERS.has(ticker);
}

export function buildEntry(
  suggestion: ContractSuggestion,
  entryPrice: number,
  entryGammaFlip: number | null,
  now: Date,
): RegistroOpenEntry {
  const symbol = buildOccSymbol({
    underlying: suggestion.occRoot, expiration: suggestion.expiration, type: suggestion.type, strike: suggestion.strike,
  });
  return {
    id: `${symbol}__${now.toISOString()}`,
    ticker: suggestion.ticker as "TSLA" | "SPX",
    occRoot: suggestion.occRoot,
    symbol,
    type: suggestion.type,
    strike: suggestion.strike,
    expiration: suggestion.expiration,
    target: suggestion.target,
    side: profitSideOf(suggestion.type),
    signalRole: suggestion.role,
    reason: suggestion.reason,
    entryPrice,
    entrySpot: suggestion.spot,
    entryGammaFlip,
    enteredAt: now.toISOString(),
    dayKey: marketDateStr(now),
  };
}

export function pnlOf(entryPrice: number, currentPrice: number): { usd: number; pct: number } {
  return {
    usd: (currentPrice - entryPrice) * 100,
    pct: ((currentPrice - entryPrice) / entryPrice) * 100,
  };
}

/** ¿El spot ya tocó/cruzó el target sugerido, en la dirección de la entrada? */
export function targetTouched(entry: Pick<RegistroOpenEntry, "side" | "target">, currentSpot: number): boolean {
  return entry.side === "above" ? currentSpot >= entry.target : currentSpot <= entry.target;
}

/**
 * Cruce del gamma flip desde la entrada — "los market makers están
 * rebalanceando el mercado" (Carlos, 2026-08-01): compara de qué lado del
 * gamma flip está el spot AHORA contra de qué lado estaba al entrar. Solo
 * tiene efecto si ambos gamma flip son reales (SPX) — con `entryGammaFlip`
 * null (TSLA) siempre da `false`.
 */
export function gammaFlipCrossed(
  entrySpot: number,
  entryGammaFlip: number | null,
  currentSpot: number,
  currentGammaFlip: number | null,
): boolean {
  if (entryGammaFlip == null || currentGammaFlip == null) return false;
  const wasAbove = entrySpot >= entryGammaFlip;
  const isAbove = currentSpot >= currentGammaFlip;
  return wasAbove !== isAbove;
}

/**
 * ¿Toca cerrar la entrada AHORA? Prioridad: (1) target tocado — ganancia
 * asegurada gana sobre cualquier otra señal; (2) pasado el margen de gracia,
 * reversión — dispara con CUALQUIERA de las dos señales (net premium de
 * contratos vecinos ya no confirma, O cruzó el gamma flip desde la entrada),
 * confirmado con Carlos: "cualquiera de las dos dispara el cierre"; (3) red
 * de seguridad de fin de día, solo si ni target ni reversión ocurrieron
 * todavía — nunca preempta a las dos señales reales, solo evita que una
 * entrada quede colgada de un día para otro.
 */
export function evaluateRegistroExit(input: {
  entry: RegistroOpenEntry;
  currentSpot: number;
  neighborConfirming: boolean;
  currentGammaFlip: number | null;
  isMarketCloseNear: boolean;
  now: Date;
}): { shouldExit: boolean; reason: RegistroExitReason | null } {
  const { entry, currentSpot, neighborConfirming, currentGammaFlip, isMarketCloseNear, now } = input;

  if (targetTouched(entry, currentSpot)) return { shouldExit: true, reason: "target" };

  const minutesSinceEntry = (now.getTime() - Date.parse(entry.enteredAt)) / 60_000;
  if (minutesSinceEntry >= REVERSAL_CHECK_GRACE_MINUTES) {
    const flipped = gammaFlipCrossed(entry.entrySpot, entry.entryGammaFlip, currentSpot, currentGammaFlip);
    if (!neighborConfirming || flipped) return { shouldExit: true, reason: "reversal" };
  }

  if (isMarketCloseNear) return { shouldExit: true, reason: "eod" };
  return { shouldExit: false, reason: null };
}

/** Mueve una entrada abierta a cerrada — win/loss = signo de la ganancia/pérdida real en $.
 *  Clave por `id`, no por `symbol` — un ticker en modo bitácora puede tener
 *  varias entradas abiertas con el mismo contrato (ver `isContinuousLogTicker`). */
export function closeEntry(
  store: RegistroStore,
  id: string,
  exitPrice: number,
  exitSpot: number,
  exitReason: RegistroExitReason,
  now: Date,
): RegistroStore {
  const entry = store.open.find((e) => e.id === id);
  if (!entry) return store;
  const { usd, pct } = pnlOf(entry.entryPrice, exitPrice);
  const closed: RegistroClosedEntry = {
    ...entry,
    exitPrice,
    exitSpot,
    exitedAt: now.toISOString(),
    exitReason,
    pnlUsd: usd,
    pnlPct: pct,
    outcome: usd >= 0 ? "win" : "loss",
  };
  return {
    open: store.open.filter((e) => e.id !== id),
    closed: [closed, ...store.closed],
  };
}

export function openEntry(store: RegistroStore, entry: RegistroOpenEntry): RegistroStore {
  return { ...store, open: [...store.open, entry] };
}
