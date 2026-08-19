// Venta de Primas — screener de spreads de crédito de riesgo definido (21-45 DTE).
//
// PURO: sin red ni disco. La ruta (app/api/venta-de-primas/route.ts) orquesta I/O;
// aquí solo se decide. Este módulo existe para NO caer en las trampas matemáticas
// que pidió Carlos explícitamente (ver CLAUDE.md § "Venta de Primas"):
//   1. El POP se mide en el BREAKEVEN, nunca en el strike corto.
//   2. Cada pata corta usa SU PROPIA IV implícita (el skew put/call es real).
//   3. El valor esperado usa volatilidad REALIZADA, nunca la implícita (con la
//      implícita el VE es ~0 por construcción: el mercado la cotiza para eso).
//   4. El crédito se calcula vendiendo al BID y comprando al ASK (el llenado malo).
//   5. El ancho entre strikes sale de la MEDIANA de la cadena, no de un valor fijo.
//
// NOTA sobre la dirección del POP (documentada también en `popAt` abajo): el
// prompt describe la diferencia entre breakeven y strike corto como "gano
// dinero" vs. "gano el máximo". Como "ganar el máximo" es un subconjunto de
// "ganar dinero" (todo trade que llega al máximo beneficio ya ganó dinero,
// nunca al revés), matemáticamente P(breakeven) ≥ P(strike corto) SIEMPRE —
// es la lectura correcta de esa misma frase, y es la que implementa y testea
// este módulo. Ver la nota extendida en `popAt`.

import { bsPrice, impliedVol, type OptionType } from "./blackScholes";
import { probAbove } from "./expectedMove";
import { rankWithin } from "./ivcontext";

const MULTIPLIER = 100;

export const DTE_MIN = 21;
export const DTE_MAX = 45;

/** Integración numérica del valor esperado: 400 puntos entre ±4σ (regla exacta del prompt). */
export const EV_STEPS = 400;
export const EV_SIGMA_RANGE = 4;

/** Ventana de volatilidad realizada para el valor esperado: últimos 22 cierres. */
export const REALIZED_VOL_WINDOW = 22;

/**
 * Percentiles de clasificación de PRIMA (CARA/NORMAL/BARATA). El prompt pide
 * "percentil de volatilidad implícita" sin fijar el corte exacto; se elige un
 * tercio/tercio/tercio simétrico (30/70) porque es la convención más legible
 * y no hay banda oficial de Carlos para esto (a diferencia del IV Rank de
 * ivcontext.ts, que sí trae bandas del scorecard).
 */
export const PREMIUM_CHEAP_PCTL = 30;
export const PREMIUM_EXPENSIVE_PCTL = 70;

/** Cuántas strikes OTM más cercanas al spot se evalúan por ticker/lado. Acotado
 * por rendimiento (35 tickers × 2 lados × N strikes, todo cálculo puro) y
 * porque más allá de ~12 strikes OTM la prima ya es residual. */
export const MAX_STRIKES_PER_SIDE = 12;

export type SpreadStructure = "put_credit" | "call_credit";
export type Bias = "alcista" | "bajista";

// ── Sesgo direccional (heurística burda — declarada como limitación) ─────

/**
 * Sesgo direccional MUY burdo: solo mira si el precio de hoy está por encima
 * o por debajo del cierre de hace `lookback` sesiones. A propósito más simple
 * que la ficha individual del ticker (niveles, GEX, flujo real) — el barrido
 * necesita UNA heurística barata para decidir qué lado de la cadena mirar en
 * 35 tickers; la ficha individual del ticker es la que decide de verdad.
 * Limitación declarada en la UI, no se oculta.
 */
export function biasFromCloses(closes: number[], lookback = 20): Bias {
  if (closes.length < lookback + 1) return "alcista"; // sin historia: no hay señal, se documenta como límite
  const past = closes[closes.length - 1 - lookback];
  const now = closes[closes.length - 1];
  return now >= past ? "alcista" : "bajista";
}

// ── Breakeven, crédito, ancho, colateral ──────────────────────────────────

/** Breakeven del spread — se separa del strike corto por el crédito cobrado. */
export function breakevenOf(
  shortStrike: number,
  creditPerShare: number,
  structure: SpreadStructure,
): number {
  return structure === "put_credit" ? shortStrike - creditPerShare : shortStrike + creditPerShare;
}

/**
 * Crédito neto por acción, vendiendo la pata corta al BID y comprando la
 * pata larga al ASK — el llenado malo a propósito, así que lo que se muestra
 * es el SUELO de lo que se cobra, nunca el techo. null si los datos no
 * alcanzan para un crédito positivo real (sin bid, sin ask, o crédito ≤ 0).
 */
export function conservativeCredit(
  shortBid: number | null | undefined,
  longAsk: number | null | undefined,
): number | null {
  if (!(shortBid != null && shortBid > 0)) return null;
  if (!(longAsk != null && longAsk >= 0)) return null;
  const credit = shortBid - longAsk;
  return credit > 0 ? credit : null;
}

/**
 * Mismo haircut que `HAIRCUT.ultimo` en lib/wheel.ts — mismo problema (no hay
 * bid/ask real), misma respuesta: un recorte conservador sobre el último
 * precio, nunca el precio crudo, para no fingir que se puede vender más caro
 * de lo que el mercado probablemente paga.
 */
export const LAST_PRICE_HAIRCUT = 0.10;

export type QuoteSource = "real" | "estimado";

export interface ResolvedLegQuote {
  bid: number | null;
  ask: number | null;
  source: QuoteSource | null;
}

/**
 * Resuelve un bid/ask utilizable para una pata: si hay cotización REAL
 * (bid y ask de mercado, `last_quote`), se usa tal cual. Si no la hay —el
 * caso de hoy en el plan de Massive para el screener de Venta de Primas, ver
 * la nota en `fetchCreditSpreadChain` (lib/massive.ts)— se ESTIMA un bid/ask
 * conservador a partir del último precio observado (`lastPrice`, cascada
 * `last_trade → day.close → day.vwap`, ya resuelta por la ruta), ensanchando
 * hacia los dos lados con `LAST_PRICE_HAIRCUT` para no fingir un mercado más
 * angosto del que probablemente hay. Sin ningún precio observado, null: no
 * se inventa una fila con datos que no existen.
 */
export function resolveLegQuote(leg: {
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
}): ResolvedLegQuote {
  if (leg.bid != null && leg.bid > 0 && leg.ask != null && leg.ask > 0) {
    return { bid: leg.bid, ask: leg.ask, source: "real" };
  }
  if (leg.lastPrice != null && leg.lastPrice > 0) {
    return {
      bid: leg.lastPrice * (1 - LAST_PRICE_HAIRCUT),
      ask: leg.lastPrice * (1 + LAST_PRICE_HAIRCUT),
      source: "estimado",
    };
  }
  return { bid: null, ask: null, source: null };
}

/**
 * Ancho entre strikes de la cadena: la MEDIANA de los huecos, no la media.
 * Un hueco suelto en la cadena (p.ej. strikes que dejaron de listarse)
 * desviaría la media y estropearía todos los anchos calculados a partir de
 * ella; la mediana no se entera de un solo hueco raro.
 */
export function medianStrikeWidth(strikes: number[]): number {
  const uniq = [...new Set(strikes)].filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  if (uniq.length < 2) return 0;
  const gaps = uniq
    .slice(1)
    .map((s, i) => s - uniq[i])
    .filter((g) => g > 1e-9)
    .sort((a, b) => a - b);
  if (gaps.length === 0) return 0;
  const mid = gaps.length >> 1;
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

/**
 * Riesgo definido: pérdida máxima = colateral = (ancho × 100) − crédito.
 * Es la ganancia de capital frente al cash-secured: la pata larga topa la
 * pérdida en vez de dejarla abierta hasta cero.
 */
export function collateralOf(width: number, creditPerShare: number): number {
  const raw = width * MULTIPLIER - creditPerShare * MULTIPLIER;
  return Math.max(0, raw);
}

// ── POP (probabilidad de acabar en beneficio) ─────────────────────────────

/**
 * POP genérico medido en un precio de referencia arbitrario, con la IV de
 * la pata corta correspondiente (put o call — nunca prestada de la otra,
 * ese es el punto del skew: en acciones el put OTM cotiza más volatilidad
 * que la call equivalente, y prestarle al put la IV del ATM/call infla su
 * POP).
 *
 * Con `referencePrice = breakeven` da la POP real: "termina en beneficio"
 * (put credit spread → precio por ENCIMA del breakeven; call credit spread →
 * precio por DEBAJO). Con `referencePrice = strike corto` da la probabilidad
 * de "ganar el MÁXIMO" — existe aquí solo para el test de regresión del
 * prompt (§7, test 2) y para dejar constancia de la relación matemática:
 * "ganar el máximo" ⊆ "ganar dinero" (todo trade que llega al máximo
 * beneficio ya había cruzado el breakeven antes), así que
 * POP(breakeven) ≥ POP(strike corto) SIEMPRE. Nunca se usa el strike corto
 * en producción — solo el breakeven.
 */
export function popAt(input: {
  structure: SpreadStructure;
  spot: number;
  referencePrice: number;
  iv: number;
  dte: number;
}): number {
  const { structure, spot, referencePrice, iv, dte } = input;
  return structure === "put_credit"
    ? probAbove(spot, referencePrice, iv, dte)
    : 1 - probAbove(spot, referencePrice, iv, dte);
}

/** POP real del candidato: SIEMPRE en el breakeven. */
export function popAtBreakeven(input: {
  structure: SpreadStructure;
  spot: number;
  shortStrike: number;
  creditPerShare: number;
  /** IV de LA PATA CORTA de esta estructura (put si es put_credit, call si es call_credit). */
  iv: number;
  dte: number;
}): number {
  const breakeven = breakevenOf(input.shortStrike, input.creditPerShare, input.structure);
  return popAt({
    structure: input.structure, spot: input.spot,
    referencePrice: breakeven, iv: input.iv, dte: input.dte,
  });
}

// ── Valor esperado (integración numérica, volatilidad REALIZADA) ─────────

/**
 * Valor esperado del spread, en $, por INTEGRACIÓN NUMÉRICA sobre una
 * lognormal SIN DERIVA (r=0 — el mismo convenio que expectedMove.ts usa en
 * todo el repo para probabilidades), con la volatilidad REALIZADA — nunca la
 * implícita. 400 puntos entre ±4σ: 4σ alcanza porque más allá el payoff ya
 * está topado por la pata larga (lineal a trozos, sin curvatura que capturar
 * con más rango), y 400 puntos alcanzan porque el payoff es lineal a trozos
 * (no hace falta más resolución para un integrando sin curvatura).
 *
 * Se eligió numérica y no forma cerrada por VERIFICABILIDAD: se contrasta
 * contra casos calculados a mano (ver creditSpreads.test.ts) y no depende de
 * que nadie derive bien una esperanza parcial de una lognormal truncada.
 */
export function expectedValueSpread(input: {
  structure: SpreadStructure;
  spot: number;
  shortStrike: number;
  /** Ancho REAL entre las dos patas (strike corto − strike largo, en valor absoluto). */
  width: number;
  creditPerShare: number;
  /** Volatilidad REALIZADA anualizada, decimal (0.30 = 30%). NUNCA la implícita. */
  realizedVol: number;
  dte: number;
  steps?: number;
}): number {
  const { structure, spot, shortStrike, width, creditPerShare, realizedVol, dte } = input;
  if (!(spot > 0) || !(width > 0) || !(dte > 0)) return 0;
  const steps = Math.max(1, Math.floor(input.steps ?? EV_STEPS));
  const T = dte / 365;
  const vol = Math.max(realizedVol, 1e-4);
  const sigma = vol * Math.sqrt(T);
  if (!(sigma > 0)) return 0;

  const mu = -0.5 * sigma * sigma; // driftless: E[S_T] = spot bajo esta parametrización
  const lo = mu - EV_SIGMA_RANGE * sigma;
  const hi = mu + EV_SIGMA_RANGE * sigma;
  const dx = (hi - lo) / steps;
  const creditDollars = creditPerShare * MULTIPLIER;
  const norm = 1 / (sigma * Math.sqrt(2 * Math.PI));

  let ev = 0;
  for (let i = 0; i < steps; i++) {
    const x = lo + dx * (i + 0.5); // regla del punto medio
    const density = norm * Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
    const priceAtX = spot * Math.exp(x);
    // Intrusión de la pata corta en el colateral, topada por el ancho (la
    // pata larga limita la pérdida más allá de ahí) — payoff lineal a trozos.
    const intrusion = structure === "put_credit"
      ? Math.min(Math.max(shortStrike - priceAtX, 0), width)
      : Math.min(Math.max(priceAtX - shortStrike, 0), width);
    const payoff = creditDollars - intrusion * MULTIPLIER;
    ev += payoff * density * dx;
  }
  return ev;
}

// ── Clasificación de prima (CARA / NORMAL / BARATA) ───────────────────────

export type PremiumLabel = "cara" | "normal" | "barata";

export interface PremiumClassification {
  label: PremiumLabel;
  /** Percentil 0-100 de la IV actual dentro de la serie de volatilidad
   * realizada histórica del propio ticker. null si no hay historia suficiente. */
  percentile: number | null;
}

/**
 * CARA/NORMAL/BARATA: compara la IV que se está pagando HOY contra la
 * distribución de lo que el ticker realmente realizó en volatilidad —
 * reusa `rankWithin` de ivcontext.ts (ya testeado), aplicado a una serie de
 * volatilidad realizada en vez de a una serie de IV histórica (la fuente no
 * la da).
 */
export function classifyPremium(ivPct: number, realizedSeriesPct: number[]): PremiumClassification {
  const percentile = rankWithin(realizedSeriesPct, ivPct);
  if (percentile == null) return { label: "normal", percentile: null };
  if (percentile >= PREMIUM_EXPENSIVE_PCTL) return { label: "cara", percentile };
  if (percentile <= PREMIUM_CHEAP_PCTL) return { label: "barata", percentile };
  return { label: "normal", percentile };
}

// ── Earnings: fecha de ANUNCIO + hora, no la de filing ────────────────────

export type EarningsTiming = "before_open" | "after_close" | "unknown";

/**
 * ¿El reporte de resultados cae DENTRO del vencimiento? Regla exacta del
 * prompt de Carlos:
 *   - Cualquier fecha ESTRICTAMENTE anterior al vencimiento → dentro (el
 *     evento ya pasó antes de que el spread expire).
 *   - Fecha ESTRICTAMENTE posterior → fuera.
 *   - MISMO día del vencimiento → decide la hora: después del cierre → fuera
 *     (el evento cae de hecho fuera de este vencimiento); antes de abrir →
 *     dentro; sin hora conocida → dentro (regla conservadora: equivocarse
 *     por prudente cuesta una oportunidad, equivocarse al revés cuesta el
 *     colateral entero).
 */
export function earningsWithinExpiration(input: {
  earningsDate: string | null;
  timing: EarningsTiming;
  expiration: string;
}): boolean {
  if (!input.earningsDate) return false;
  const e = Date.parse(`${input.earningsDate}T00:00:00Z`);
  const x = Date.parse(`${input.expiration}T00:00:00Z`);
  if (!Number.isFinite(e) || !Number.isFinite(x)) return false;
  if (e < x) return true;
  if (e > x) return false;
  return input.timing !== "after_close";
}

// ── Veredicto de mercado (realizada vs. implícita, agregado) ─────────────

export interface MarketVerdictPair {
  ticker: string;
  realizedVolPct: number;
  impliedVolPct: number;
}

export interface MarketVerdict {
  realizedAvg: number;
  impliedAvg: number;
  /** true = "hoy la prima está barata en el mercado": mal momento para vender. */
  cheap: boolean;
  n: number;
}

/**
 * Compara la volatilidad que el universo escaneado está REALIZANDO contra la
 * que se está PAGANDO (implícita de las patas cortas). Si la realizada va
 * por encima, el mercado está regalando prima barata frente al movimiento
 * real — mal momento para vender, por bueno que se vea un candidato suelto.
 */
export function marketVerdict(pairs: MarketVerdictPair[]): MarketVerdict | null {
  const valid = pairs.filter(
    (p) => Number.isFinite(p.realizedVolPct) && Number.isFinite(p.impliedVolPct),
  );
  if (valid.length === 0) return null;
  const realizedAvg = valid.reduce((s, p) => s + p.realizedVolPct, 0) / valid.length;
  const impliedAvg = valid.reduce((s, p) => s + p.impliedVolPct, 0) / valid.length;
  return { realizedAvg, impliedAvg, cheap: realizedAvg > impliedAvg, n: valid.length };
}

// ── Perfil de riesgo (localStorage, nunca al servidor) ────────────────────

export interface CreditSpreadRiskProfile {
  accountSize: number;
  /** % de la cuenta que acepta arriesgar por trade — el slider 1 (conservador) a 50 (agresivo). */
  riskPct: number;
}

/** Regla propia de Carlos: la quema máxima de theta es el 5% del capital máximo por trade. */
export const THETA_BURN_PCT_OF_CAPITAL = 5;

export interface CreditSpreadBudgets {
  /** Capital máximo por trade = cuenta × riesgo. */
  maxCapitalPerTrade: number;
  /** Máxima quema de theta = 5% de ese capital. */
  maxThetaBurn: number;
}

function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function budgetsOf(profile: CreditSpreadRiskProfile): CreditSpreadBudgets {
  const account = safe(profile?.accountSize);
  const riskPct = safe(profile?.riskPct);
  const maxCapitalPerTrade = (account * riskPct) / 100;
  return { maxCapitalPerTrade, maxThetaBurn: (maxCapitalPerTrade * THETA_BURN_PCT_OF_CAPITAL) / 100 };
}

/** CABEN: cuántos contratos entran bajo el techo de capital. Puro — el saldo lo trae el cliente. */
export function contractsThatFit(maxCapitalPerTrade: number, collateral: number): number {
  if (!(collateral > 0) || !(maxCapitalPerTrade > 0)) return 0;
  return Math.floor(maxCapitalPerTrade / collateral);
}

// ── Ensamblado de candidatos ────────────────────────────────────────────

export interface CreditSpreadLeg {
  strike: number;
  bid: number | null;
  ask: number | null;
  openInterest: number;
  /** Último precio observado del CONTRATO (cascada last_trade→day.close→day.vwap),
   * respaldo cuando no hay bid/ask real — ver `resolveLegQuote`. */
  lastPrice?: number | null;
  /** IV que la fuente ya trae calculada para este contrato, si la trae. */
  impliedVolatility?: number | null;
}

export interface CreditSpreadChainInput {
  ticker: string;
  spot: number;
  expiration: string;
  dte: number;
  /** TODAS las strikes de puts de ese vencimiento (no solo las OTM: hace falta la
   * cadena completa para encontrar la pata larga a un ancho de distancia). */
  putLegs: CreditSpreadLeg[];
  callLegs: CreditSpreadLeg[];
  bias: Bias;
  /** Volatilidad realizada anualizada de los últimos 22 cierres, en %. */
  realizedVolPct: number;
  /** Serie de volatilidad realizada histórica (ventana móvil de 22), en %, para el percentil de PRIMA. */
  premiumSeriesPct: number[];
  earningsWithin: boolean;
  maxStrikesPerSide?: number;
}

export interface CreditSpreadCandidate {
  ticker: string;
  structure: SpreadStructure;
  bias: Bias;
  expiration: string;
  dte: number;
  spot: number;
  shortStrike: number;
  longStrike: number;
  width: number;
  creditPerShare: number;
  /** Prima neta cobrada por contrato, en $. */
  credit: number;
  /** Pérdida máxima = colateral inmovilizado, en $. */
  collateral: number;
  breakeven: number;
  /** IV decimal de la pata corta usada en todos los cálculos de esta fila. */
  iv: number;
  ivSource: "fuente" | "implicita" | "estimada";
  /** "real" si el crédito salió de un bid/ask de mercado; "estimado" si se
   * derivó del último precio con haircut (ver `resolveLegQuote`). */
  creditSource: QuoteSource;
  /** Probabilidad de acabar en beneficio (0-1), medida en el breakeven. */
  pop: number;
  premium: PremiumClassification;
  /** Valor esperado en $ por contrato (integración numérica, volatilidad realizada). */
  ev: number;
  /** VE por dólar de colateral (fracción, no %) — la columna de orden. */
  evPerDollarCollateral: number;
  earningsWithin: boolean;
  openInterestShort: number;
}

function findLongLeg(
  legs: CreditSpreadLeg[],
  structure: SpreadStructure,
  shortStrike: number,
  targetLong: number,
): CreditSpreadLeg | null {
  const candidates = legs.filter((l) =>
    structure === "put_credit" ? l.strike < shortStrike : l.strike > shortStrike,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, l) =>
    Math.abs(l.strike - targetLong) < Math.abs(best.strike - targetLong) ? l : best,
  );
}

/**
 * Candidatos de spread de crédito para UN ticker en UN vencimiento. Genera un
 * candidato por cada strike corta OTM razonable (hasta `maxStrikesPerSide`,
 * las más cercanas al spot primero), emparejada con la pata larga más cercana
 * a un ancho de distancia (mediana de la cadena). Sigue el mismo patrón que
 * `wheelCandidates` en lib/wheel.ts: puede devolver varias filas por ticker
 * a distintos strikes — el POP y el VE/$ de cada una deciden si sobrevive al
 * filtro y a qué altura queda ordenada.
 */
export function creditSpreadCandidatesForTicker(input: CreditSpreadChainInput): CreditSpreadCandidate[] {
  const { ticker, spot, expiration, dte, bias, realizedVolPct, premiumSeriesPct, earningsWithin } = input;
  if (!(spot > 0) || !(dte > 0)) return [];

  const structure: SpreadStructure = bias === "alcista" ? "put_credit" : "call_credit";
  const legs = structure === "put_credit" ? input.putLegs : input.callLegs;
  if (legs.length === 0) return [];

  const width = medianStrikeWidth(legs.map((l) => l.strike));
  if (!(width > 0)) return [];

  const otm = legs
    .filter((l) => (structure === "put_credit" ? l.strike < spot : l.strike > spot))
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, Math.max(1, input.maxStrikesPerSide ?? MAX_STRIKES_PER_SIDE));

  const T = dte / 365;
  const realizedVol = Math.max(realizedVolPct, 0) / 100;
  const optType: OptionType = structure === "put_credit" ? "put" : "call";

  const out: CreditSpreadCandidate[] = [];
  for (const shortLeg of otm) {
    const targetLong = structure === "put_credit" ? shortLeg.strike - width : shortLeg.strike + width;
    const longLeg = findLongLeg(legs, structure, shortLeg.strike, targetLong);
    if (!longLeg) continue;

    const shortQuote = resolveLegQuote({ bid: shortLeg.bid, ask: shortLeg.ask, lastPrice: shortLeg.lastPrice ?? null });
    const longQuote = resolveLegQuote({ bid: longLeg.bid, ask: longLeg.ask, lastPrice: longLeg.lastPrice ?? null });
    if (shortQuote.source == null || longQuote.source == null) continue; // sin ningún precio observable: no se inventa

    const creditPerShare = conservativeCredit(shortQuote.bid, longQuote.ask);
    if (creditPerShare == null) continue;
    const creditSource: QuoteSource = shortQuote.source === "real" && longQuote.source === "real" ? "real" : "estimado";

    const actualWidth = Math.abs(shortLeg.strike - longLeg.strike);
    if (!(actualWidth > 0)) continue;

    const collateral = collateralOf(actualWidth, creditPerShare);
    if (!(collateral > 0)) continue; // riesgo definido inválido (crédito ≥ ancho×100): no se muestra

    const mid = shortQuote.bid != null && shortQuote.ask != null ? (shortQuote.bid + shortQuote.ask) / 2 : null;
    const implied = mid != null ? impliedVol(mid, spot, shortLeg.strike, T, optType) : null;
    // Cascada de IV: la que ya trae la fuente calculada para ESTE contrato
    // (más fiable que reconstruirla de un bid/ask a veces estimado) → la
    // bisección propia sobre el precio disponible → la volatilidad realizada
    // como último respaldo. Nunca se presta la IV de la OTRA pata (ese es
    // justo el error de skew que hay que evitar).
    const iv = shortLeg.impliedVolatility ?? implied ?? realizedVol;
    const ivSource: "fuente" | "implicita" | "estimada" =
      shortLeg.impliedVolatility != null ? "fuente" : implied != null ? "implicita" : "estimada";

    const pop = popAtBreakeven({
      structure, spot, shortStrike: shortLeg.strike, creditPerShare, iv, dte,
    });

    const ev = expectedValueSpread({
      structure, spot, shortStrike: shortLeg.strike, width: actualWidth,
      creditPerShare, realizedVol, dte,
    });
    const evPerDollarCollateral = collateral > 0 ? ev / collateral : 0;

    const premium = classifyPremium(iv * 100, premiumSeriesPct);

    out.push({
      ticker, structure, bias, expiration, dte, spot,
      shortStrike: shortLeg.strike, longStrike: longLeg.strike, width: actualWidth,
      creditPerShare, credit: creditPerShare * MULTIPLIER, collateral, breakeven:
        breakevenOf(shortLeg.strike, creditPerShare, structure),
      iv, ivSource, creditSource, pop, premium, ev, evPerDollarCollateral,
      earningsWithin, openInterestShort: shortLeg.openInterest,
    });
  }

  // VE/$ es la columna de orden a propósito (§6 del prompt): un crédito
  // grande sobre un colateral enorme es peor negocio que uno pequeño sobre
  // poco colateral — el crédito absoluto NO ordena esta lista.
  return out.sort((a, b) => b.evPerDollarCollateral - a.evPerDollarCollateral);
}

/** Elige, entre los vencimientos 21-45 DTE disponibles, el más cercano al punto medio de la ventana. */
export function pickExpiration(
  expirations: { expiration: string; dte: number }[],
  dteMin = DTE_MIN,
  dteMax = DTE_MAX,
): { expiration: string; dte: number } | null {
  const valid = expirations.filter((e) => e.dte >= dteMin && e.dte <= dteMax);
  if (valid.length === 0) return null;
  const mid = (dteMin + dteMax) / 2;
  return valid.reduce((best, e) => (Math.abs(e.dte - mid) < Math.abs(best.dte - mid) ? e : best));
}

// Reexport para que la ruta pueda tipar el precio teórico "justo" en los
// tests de auto-consistencia (bsPrice con r=0, ver creditSpreads.test.ts).
export { bsPrice };
