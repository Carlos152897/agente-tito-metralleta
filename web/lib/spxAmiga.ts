// "SPX amiga" — Agente 0DTE (Carlos, 2026-08-04). Motor PURO, NUEVO Y SEPARADO
// a propósito: no importa nada de lib/gex.ts, lib/expectedMove.ts ni
// lib/spxLevels.ts salvo el tipo `ExtendedChainContract` (una forma de dato,
// no lógica) y primitivas de matemática genuinamente compartidas (`bsCharm`/
// `bsVanna` de lib/blackScholes.ts, `normCdf` de lib/expectedMove.ts — igual
// que ya hace blackScholes.ts con normCdf). Todo lo demás (imán/flip/régimen,
// rango a 5 min, mejor trade, escenarios, veredicto) está recalculado desde
// cero acá, por pedido explícito de Carlos.
//
// Fuente de datos: `fetchOptionChainExtended("SPX", marketDateStr(now))`
// (lib/marketsnack.ts) — SPXW expira TODOS los días de mercado, así que la
// fecha de hoy YA es el 0DTE. Un solo fetch trae, por contrato: gamma/delta
// REALES (no estimados con Black-Scholes), OI, volumen, IV real, y
// `premium_breakdown` (bid/mid/ask) — cubre escalera de strikes, GEX-lite,
// money flow y precios de vertical spread sin fetch adicional.

import { bsCharm, bsVanna } from "./blackScholes";
import { normCdf } from "./expectedMove";
import { isMarketOpen, minutesUntilClose } from "./marketHours";
import type { ExtendedChainContract } from "./spxLevels";

// ── Escalera de strikes (top N por volumen, calls y puts por separado) ─────

export type Aggressor = "compra" | "venta" | "mixto";

export interface StrikeLadderRow {
  strike: number;
  volume: number;
  openInterest: number;
  delta: number;
  netPremium: number;
  aggressor: Aggressor;
}

export interface StrikeLadder {
  calls: StrikeLadderRow[];
  puts: StrikeLadderRow[];
}

/** >60% de la plata ejecutada en un lado = agresor claro; si no, "mixto". */
const AGGRESSOR_CLEAR_PCT = 0.6;

function aggressorOf(ask: number, bid: number): Aggressor {
  const total = ask + bid;
  if (total <= 0) return "mixto";
  const askPct = ask / total;
  if (askPct >= AGGRESSOR_CLEAR_PCT) return "compra";
  if (askPct <= 1 - AGGRESSOR_CLEAR_PCT) return "venta";
  return "mixto";
}

/** Top `count` calls + top `count` puts por volumen del día 0DTE. */
export function buildStrikeLadder(contracts: ExtendedChainContract[], count = 10): StrikeLadder {
  const toRow = (c: ExtendedChainContract): StrikeLadderRow => ({
    strike: c.strike,
    volume: c.volume,
    openInterest: c.open_interest,
    delta: c.greeks?.delta ?? 0,
    netPremium: c.premium_breakdown.ask - c.premium_breakdown.bid,
    aggressor: aggressorOf(c.premium_breakdown.ask, c.premium_breakdown.bid),
  });

  const bySide = (type: "call" | "put"): StrikeLadderRow[] =>
    contracts
      .filter((c) => c.type === type)
      .map(toRow)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, count);

  return { calls: bySide("call"), puts: bySide("put") };
}

// ── GEX-lite: gamma REAL de MarketSnack, sin estimación Black-Scholes ──────

export interface GexLiteLevel {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
}

export type GexRegime = "positivo" | "negativo";

export interface GexLiteResult {
  levels: GexLiteLevel[];
  /** Strike de mayor concentración de |GEX| — hacia dónde "ancla" el precio. */
  magnet: number | null;
  /** Cruce de signo de GEX neto más cercano al spot (interpolado). */
  flip: number | null;
  regime: GexRegime | null;
  totalNetGex: number;
}

/** ±$25 del spot, mismo radio que ya usa lib/spxLevels.ts para no traer ruido
 *  de strikes tan lejos que no pesan en el posicionamiento de hoy. */
export const GEX_RADIUS = 25;

export function computeGexLite(
  contracts: ExtendedChainContract[],
  spot: number,
  radius = GEX_RADIUS,
): GexLiteResult {
  const byStrike = new Map<number, GexLiteLevel>();
  for (const c of contracts) {
    if (!(c.open_interest > 0) || !((c.greeks?.gamma ?? 0) > 0)) continue;
    if (Math.abs(c.strike - spot) > radius) continue;
    const gex = c.greeks.gamma * c.open_interest * 100 * spot * spot * 0.01;
    const entry = byStrike.get(c.strike) ?? { strike: c.strike, callGex: 0, putGex: 0, netGex: 0 };
    if (c.type === "call") {
      entry.callGex += gex;
      entry.netGex += gex;
    } else {
      entry.putGex += gex;
      entry.netGex -= gex;
    }
    byStrike.set(c.strike, entry);
  }

  const levels = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  if (levels.length === 0) return { levels: [], magnet: null, flip: null, regime: null, totalNetGex: 0 };

  let magnetLevel = levels[0];
  for (const l of levels) if (Math.abs(l.netGex) > Math.abs(magnetLevel.netGex)) magnetLevel = l;

  let flip: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (a.netGex === 0 || b.netGex === 0 || a.netGex >= 0 === b.netGex >= 0) continue;
    const w = Math.abs(a.netGex) / (Math.abs(a.netGex) + Math.abs(b.netGex));
    const crossing = a.strike + w * (b.strike - a.strike);
    const dist = Math.abs(crossing - spot);
    if (dist < bestDist) {
      bestDist = dist;
      flip = Math.round(crossing * 100) / 100;
    }
  }

  const totalNetGex = levels.reduce((sum, l) => sum + l.netGex, 0);
  const regime: GexRegime = totalNetGex >= 0 ? "positivo" : "negativo";

  return { levels, magnet: magnetLevel.strike, flip, regime, totalNetGex };
}

// ── Tiempo: T para greeks/escenarios 0DTE, en años ──────────────────────────

const MINUTES_PER_YEAR = 60 * 24 * 365;

export function yearsFromMinutes(minutes: number): number {
  return Math.max(0, minutes) / MINUTES_PER_YEAR;
}

// ── IV real ATM (strike más cercano al spot con IV real de MarketSnack) ────

export interface AtmIv {
  strike: number;
  iv: number;
}

export function resolveAtmIv(contracts: ExtendedChainContract[], spot: number): AtmIv | null {
  const byStrike = new Map<number, { call?: number; put?: number }>();
  for (const c of contracts) {
    if (c.implied_volatility == null || !(c.implied_volatility > 0)) continue;
    const entry = byStrike.get(c.strike) ?? {};
    if (c.type === "call") entry.call = c.implied_volatility;
    else entry.put = c.implied_volatility;
    byStrike.set(c.strike, entry);
  }
  const strikes = [...byStrike.keys()];
  if (strikes.length === 0) return null;
  const closest = strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best));
  const entry = byStrike.get(closest)!;
  const ivs = [entry.call, entry.put].filter((x): x is number => x != null);
  return { strike: closest, iv: ivs.reduce((a, b) => a + b, 0) / ivs.length };
}

// ── Próximos ~5 minutos: rango ±1σ + CHARM/VANNA ────────────────────────────

export interface FiveMinuteRead {
  rangeLow: number;
  rangeHigh: number;
  magnet: number | null;
  charm: number;
  vanna: number;
  narrative: string;
}

const FIVE_MIN_MINUTES = 5;

export function computeFiveMinuteRead(input: {
  spot: number;
  atmIv: number;
  atmStrike: number;
  magnet: number | null;
  minutesToClose: number;
}): FiveMinuteRead {
  const { spot, atmIv, atmStrike, magnet, minutesToClose } = input;

  // Rango a 5 min: lognormal fresco (no el de lib/expectedMove.ts), mismas
  // bandas exp(±σ) pero con T de 5 minutos en vez de días.
  const t5 = yearsFromMinutes(FIVE_MIN_MINUTES);
  const sd = atmIv * Math.sqrt(t5);
  const rangeLow = spot * Math.exp(-sd);
  const rangeHigh = spot * Math.exp(sd);

  // Charm/vanna del contrato 0DTE mismo (respecto a SU propio vencimiento de
  // hoy, no al horizonte de 5 min) — T = tiempo real hasta el cierre.
  const tClose = yearsFromMinutes(minutesToClose);
  const charm = bsCharm(spot, atmStrike, tClose, atmIv);
  const vanna = bsVanna(spot, atmStrike, tClose, atmIv);

  const towardMagnet =
    magnet == null
      ? "sin imán claro en el vecindario"
      : magnet > spot
        ? `gravita hacia arriba, hacia $${magnet}`
        : magnet < spot
          ? `gravita hacia abajo, hacia $${magnet}`
          : `ya está parado sobre el imán ($${magnet})`;

  const charmNote =
    charm > 0
      ? "el delta sube con el paso del tiempo"
      : charm < 0
        ? "el delta baja con el paso del tiempo (empuja hacia el pin)"
        : "sin sesgo de charm";
  const vannaNote =
    vanna > 0
      ? "una suba de IV empujaría el delta hacia arriba"
      : vanna < 0
        ? "una suba de IV empujaría el delta hacia abajo"
        : "sin sesgo de vanna";

  return {
    rangeLow,
    rangeHigh,
    magnet,
    charm,
    vanna,
    narrative: `El precio ${towardMagnet}. CHARM: ${charmNote}. VANNA: ${vannaNote}.`,
  };
}

// ── ¿Dónde está el dinero? (premium al ask, calls vs. puts) ─────────────────

export type MoneyFlowBias = "calls" | "puts" | "neutral";

export interface MoneyFlowRead {
  callAskPremium: number;
  putAskPremium: number;
  bias: MoneyFlowBias;
  /** % de dominancia del lado que gana (50 = empate, 100 = todo de un lado). */
  biasPct: number;
}

/** Dentro de 45-55% de participación se considera "neutral" — sin mayoría real. */
const MONEY_FLOW_NEUTRAL_BAND = 55;

export function computeMoneyFlow(contracts: ExtendedChainContract[]): MoneyFlowRead {
  let callAskPremium = 0;
  let putAskPremium = 0;
  for (const c of contracts) {
    if (c.type === "call") callAskPremium += c.premium_breakdown.ask;
    else putAskPremium += c.premium_breakdown.ask;
  }
  const total = callAskPremium + putAskPremium;
  if (total <= 0) return { callAskPremium, putAskPremium, bias: "neutral", biasPct: 50 };

  const callPct = (callAskPremium / total) * 100;
  let bias: MoneyFlowBias = "neutral";
  if (callPct >= MONEY_FLOW_NEUTRAL_BAND) bias = "calls";
  else if (callPct <= 100 - MONEY_FLOW_NEUTRAL_BAND) bias = "puts";
  const biasPct = bias === "puts" ? 100 - callPct : callPct;

  return { callAskPremium, putAskPremium, bias, biasPct };
}

// ── Vertical spread con precios reales ──────────────────────────────────────

export interface VerticalSpread {
  type: "call" | "put";
  longStrike: number;
  shortStrike: number;
  /** Débito neto por contrato, ya ×100. */
  cost: number;
  maxProfit: number;
  maxLoss: number;
}

/** Debit spread: compra `longContract` (cerca del dinero), vende
 *  `shortContract` (más lejos, mismo tipo) — `null` si los datos no alcanzan
 *  para un spread con sentido (mismo strike, sin precio, o débito ≤ 0). */
export function buildVerticalSpread(
  type: "call" | "put",
  longContract: ExtendedChainContract,
  shortContract: ExtendedChainContract,
): VerticalSpread | null {
  if (longContract.type !== type || shortContract.type !== type) return null;
  if (longContract.strike === shortContract.strike) return null;

  const longAsk = longContract.premium_breakdown.ask;
  const shortBid = shortContract.premium_breakdown.bid;
  if (!(longAsk > 0) || !(shortBid >= 0)) return null;

  const cost = (longAsk - shortBid) * 100;
  if (cost <= 0) return null;

  const width = Math.abs(shortContract.strike - longContract.strike) * 100;
  const maxProfit = width - cost;

  return { type, longStrike: longContract.strike, shortStrike: shortContract.strike, cost, maxProfit, maxLoss: cost };
}

// ── Mejor trade ahora (direccional o LATERAL) ───────────────────────────────

export interface DirectionalTrade {
  lateral: false;
  type: "call" | "put";
  entry: number;
  entryStrike: number;
  stopUnderlying: number;
  tp1Underlying: number;
  tp2Underlying: number | null;
  riskReward: number;
  spread: VerticalSpread | null;
  reason: string;
}

export interface LateralTrade {
  lateral: true;
  reason: string;
}

export type BestTrade = DirectionalTrade | LateralTrade;

/** Si el imán queda dentro de este % del spot, se considera "pegado" — sin
 *  recorrido real para operar (misma regla "ante la duda, no operar"). */
const LATERAL_MAGNET_PCT = 0.0015;

/**
 * Regla determinista de primera pasada (ajustable después viéndola en vivo,
 * mismo criterio que se afinó `wallEntrySignal` en "SPX vecinos"):
 * 1. Sin imán o imán pegado al spot -> LATERAL.
 * 2. Dirección candidata = hacia dónde queda el imán respecto al spot.
 * 3. Si el dinero al ask (money flow) apunta CLARO para el otro lado -> LATERAL
 *    (señal contradictoria, no forzar).
 * 4. Si no, TP1/TP2 = los primeros niveles de GEX del lado de ganancia
 *    caminando desde el spot; Stop = el flip si frena del lado correcto, si no
 *    la pared opuesta más fuerte, si no un stop espejo (R:R 1:1 declarado).
 */
export function suggestBestTrade(input: {
  spot: number;
  gex: GexLiteResult;
  moneyFlow: MoneyFlowRead;
  contracts: ExtendedChainContract[];
  atmStrike: number;
}): BestTrade {
  const { spot, gex, moneyFlow, contracts, atmStrike } = input;

  if (gex.magnet == null || gex.regime == null) {
    return { lateral: true, reason: "Sin imán de GEX claro en el vecindario — no hay pared que fije la dirección." };
  }
  if (Math.abs(gex.magnet - spot) <= spot * LATERAL_MAGNET_PCT) {
    return {
      lateral: true,
      reason: `El imán ($${gex.magnet}) está pegado al spot — sin recorrido claro, mejor esperar.`,
    };
  }

  const magnetDirection: "call" | "put" = gex.magnet > spot ? "call" : "put";
  const flowDirection: "call" | "put" | null =
    moneyFlow.bias === "calls" ? "call" : moneyFlow.bias === "puts" ? "put" : null;

  if (flowDirection != null && flowDirection !== magnetDirection) {
    return {
      lateral: true,
      reason:
        `El dinero al ask apunta a ${flowDirection === "call" ? "calls" : "puts"} pero el imán tira para el ` +
        `otro lado — señal contradictoria, mejor esperar.`,
    };
  }

  const direction = magnetDirection;
  const profitAbove = direction === "call";

  const sideLevels = gex.levels
    .filter((l) => (profitAbove ? l.strike > spot : l.strike < spot))
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
  const oppositeLevels = gex.levels.filter((l) => (profitAbove ? l.strike < spot : l.strike > spot));

  const tp1 = sideLevels[0]?.strike ?? gex.magnet;
  const tp2 = sideLevels[1]?.strike ?? null;

  let stop: number;
  if (gex.flip != null && (profitAbove ? gex.flip < spot : gex.flip > spot)) {
    stop = gex.flip;
  } else if (oppositeLevels.length > 0) {
    const strongest = oppositeLevels.reduce((best, l) => (Math.abs(l.netGex) > Math.abs(best.netGex) ? l : best));
    stop = strongest.strike;
  } else {
    const mirrorDistance = Math.abs(tp1 - spot);
    stop = profitAbove ? spot - mirrorDistance : spot + mirrorDistance;
  }

  const reward = Math.abs(tp1 - spot);
  const risk = Math.abs(spot - stop);
  const riskReward = risk > 0 ? reward / risk : 0;

  const entryContract = contracts.find((c) => c.type === direction && c.strike === atmStrike);
  if (!entryContract || !(entryContract.premium_breakdown.ask > 0)) {
    return { lateral: true, reason: "No hay contrato ATM con precio disponible para armar la entrada." };
  }

  const targetContract = contracts.find((c) => c.type === direction && c.strike === tp1);
  const spread = targetContract ? buildVerticalSpread(direction, entryContract, targetContract) : null;

  const sideWord = direction === "call" ? "calls" : "puts";
  const reason =
    `El imán de GEX ($${gex.magnet}) está ${profitAbove ? "arriba" : "abajo"} del spot y el dinero al ask ` +
    `${flowDirection === direction ? `confirma ${sideWord}` : "no contradice"} — se sugiere ${sideWord} ` +
    `$${atmStrike} apuntando a $${tp1}${tp2 != null ? ` (y $${tp2} si sigue)` : ""}.`;

  return {
    lateral: false,
    type: direction,
    entry: entryContract.premium_breakdown.ask,
    entryStrike: atmStrike,
    stopUnderlying: stop,
    tp1Underlying: tp1,
    tp2Underlying: tp2,
    riskReward,
    spread,
    reason,
  };
}

// ── Escenarios hasta el cierre ───────────────────────────────────────────────

export type CloseScenarioLabel = "bajista" | "base" | "alcista";

export interface CloseScenario {
  label: CloseScenarioLabel;
  strike: number;
  probTouch: number;
}

/** P(tocar `strike` antes del cierre) — lognormal fresco, principio de
 *  reflexión (≈2× la probabilidad de terminar más allá), igual espíritu que
 *  lib/expectedMove.ts pero reimplementado acá a propósito. */
function probTouchFresh(spot: number, strike: number, iv: number, T: number): number {
  if (Math.abs(strike - spot) < 1e-9) return 1;
  if (!(spot > 0) || !(iv > 0) || !(T > 0)) return 0;
  const sd = iv * Math.sqrt(T);
  const d2 = (Math.log(spot / strike) - 0.5 * sd * sd) / sd;
  const probEndingBeyond = strike > spot ? normCdf(d2) : 1 - normCdf(d2);
  return Math.min(1, 2 * probEndingBeyond);
}

export function computeCloseScenarios(input: {
  spot: number;
  atmIv: number;
  magnet: number | null;
  minutesToClose: number;
  levels: GexLiteLevel[];
}): CloseScenario[] {
  const { spot, atmIv, magnet, minutesToClose, levels } = input;
  const tClose = yearsFromMinutes(minutesToClose);
  const baseStrike = magnet ?? spot;

  const above = levels.filter((l) => l.strike > baseStrike).sort((a, b) => a.strike - b.strike);
  const below = levels.filter((l) => l.strike < baseStrike).sort((a, b) => b.strike - a.strike);
  const bullStrike = above[0]?.strike ?? Math.round(spot * 1.005 * 100) / 100;
  const bearStrike = below[0]?.strike ?? Math.round(spot * 0.995 * 100) / 100;

  return [
    { label: "bajista", strike: bearStrike, probTouch: probTouchFresh(spot, bearStrike, atmIv, tClose) },
    { label: "base", strike: baseStrike, probTouch: probTouchFresh(spot, baseStrike, atmIv, tClose) },
    { label: "alcista", strike: bullStrike, probTouch: probTouchFresh(spot, bullStrike, atmIv, tClose) },
  ];
}

// ── Veredicto: seguir o fadear el flujo, según régimen de GEX ───────────────

export type GexVerdict = "seguir" | "fadear";

export interface VerdictRead {
  verdict: GexVerdict;
  reason: string;
}

/** γ+ (positivo): dealers revierten sus hedges -> el precio tiende a pinearse
 *  cerca del imán -> conviene FADEAR los extremos. γ- (negativo): dealers
 *  amplifican -> conviene SEGUIR el flujo. Mismo vocabulario que ya usa
 *  lib/gex.ts para "régimen", fórmula nueva pero consistente a propósito. */
export function verdictFromRegime(regime: GexRegime | null): VerdictRead | null {
  if (regime == null) return null;
  if (regime === "positivo") {
    return {
      verdict: "fadear",
      reason:
        "Gamma positiva: los dealers revierten sus hedges — el precio tiende a pinearse cerca del imán, " +
        "conviene desvanecer los extremos en vez de perseguirlos.",
    };
  }
  return {
    verdict: "seguir",
    reason: "Gamma negativa: los dealers amplifican el movimiento con sus hedges — conviene seguir el flujo.",
  };
}

// ── Tablero completo ────────────────────────────────────────────────────────

export interface SpxAmigaBoard {
  spot: number;
  expiration: string;
  marketOpen: boolean;
  ladder: StrikeLadder;
  gex: GexLiteResult;
  /** `null` con mercado cerrado o sin IV real disponible. */
  fiveMinute: FiveMinuteRead | null;
  moneyFlow: MoneyFlowRead;
  /** `null` con mercado cerrado o sin IV real disponible. */
  bestTrade: BestTrade | null;
  scenarios: CloseScenario[];
  verdict: VerdictRead | null;
}

export function buildSpxAmigaBoard(input: {
  spot: number;
  expiration: string;
  contracts: ExtendedChainContract[];
  now: Date;
}): SpxAmigaBoard {
  const { spot, expiration, contracts, now } = input;
  const marketOpen = isMarketOpen(now);

  const ladder = buildStrikeLadder(contracts);
  const gex = computeGexLite(contracts, spot);
  const moneyFlow = computeMoneyFlow(contracts);
  const verdict = verdictFromRegime(gex.regime);

  const atm = resolveAtmIv(contracts, spot);
  const minutesToClose = marketOpen ? minutesUntilClose(now) : 0;

  let fiveMinute: FiveMinuteRead | null = null;
  let bestTrade: BestTrade | null = null;
  let scenarios: CloseScenario[] = [];

  if (marketOpen && atm != null && minutesToClose > 0) {
    fiveMinute = computeFiveMinuteRead({
      spot, atmIv: atm.iv, atmStrike: atm.strike, magnet: gex.magnet, minutesToClose,
    });
    bestTrade = suggestBestTrade({ spot, gex, moneyFlow, contracts, atmStrike: atm.strike });
    scenarios = computeCloseScenarios({
      spot, atmIv: atm.iv, magnet: gex.magnet, minutesToClose, levels: gex.levels,
    });
  }

  return { spot, expiration, marketOpen, ladder, gex, fiveMinute, moneyFlow, bestTrade, scenarios, verdict };
}
