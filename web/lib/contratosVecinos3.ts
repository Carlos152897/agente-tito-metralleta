// "Contratos vecinos 3.0" — a diferencia de "Contratos vecinos 2.0"
// (lib/magnetWall.ts, el imán del GEX decide la dirección y el dinero real
// solo confirma), acá NO hay GEX: el dinero real de MarketSnack decide TODO.
// Pedido explícito de Carlos (ago 2026), con un ejemplo práctico dado a mano:
//
//   1. Dónde hay más "Premium Traded" (actividad total, ambos lados, sin
//      importar dirección) en el vecindario marca los puntos donde "está el
//      dinero" — soportes/resistencias candidatos, sin importar todavía si
//      son alcistas o bajistas.
//   2. El Net Premium en ESOS puntos confirma la dirección: en calls,
//      positivo = compra agresiva = alcista, negativo = venta = resistencia;
//      en puts, positivo = compra agresiva = bajista/cobertura, negativo =
//      venta = soporte (misma convención que ya usa lib/magnetWall.ts).
//   3. Donde la actividad es baja, es candidato a stop-loss/límite — se
//      confirma también con el Net Premium ahí (si es negativo del lado que
//      se está mirando).
//
// Solo mira CALLS arriba del spot y PUTS abajo (nunca puts arriba ni calls
// abajo) — así lo pidió Carlos en el ejemplo: "buscar los contratos en call
// de 7750 hasta 7795... y los puts de 7750 hasta 7715". PURA — no toca red.

export const NEIGHBOR_COUNT = 10; // 10 strikes arriba (calls) y 10 abajo (puts)
export const MAX_TARGETS = 2;

/**
 * Un strike cuenta como "actividad alta" (candidato a target) si su Premium
 * Traded es al menos este % del máximo del propio vecindario — sin esto,
 * cualquier strike con algo de actividad "confirmaría" algo.
 */
export const HIGH_ACTIVITY_RATIO = 0.5;
/** Un strike cuenta como "actividad baja" (candidato a stop-loss) por debajo de este %. */
export const LOW_ACTIVITY_RATIO = 0.15;

/**
 * Cuántos strikes más cercanos al spot se revisan para el stop-loss — MENOS
 * que `NEIGHBOR_COUNT` (10) a propósito. Backtest real (SPX, 2026-08-13,
 * 12:15 ET): sin este tope, el stop-loss cayó en un strike de baja actividad
 * a 49 puntos de la entrada — matemáticamente correcto según la regla, pero
 * inservible como gestión de riesgo real. Mejor no sugerir stop-loss
 * (`null`) que sugerir uno a 10 strikes de distancia.
 */
export const STOP_LOSS_MAX_STRIKES = 4;

export type ActivityTrend = "subiendo" | "bajando" | "estable";

export interface TradeSummaryBucketLike {
  t: string;
  ask_premium: number;
  bid_premium: number;
  mid_premium: number;
}

export interface ActivitySummary {
  totalPremium: number; // "Premium Traded": ask + bid + mid, toda la actividad de hoy
  netPremium: number; // ask − bid: compra vs. venta agresiva
  trend: ActivityTrend;
}

/**
 * Resume los buckets de 5 min de UN contrato en actividad total + neta +
 * tendencia reciente. A diferencia de `summarizeTradeBuckets`
 * (neighborContracts.ts, que descarta el mid a propósito porque solo le
 * interesa la dirección), acá el mid SÍ cuenta — "Premium Traded" es toda la
 * plata que se movió, no solo la agresiva. La tendencia compara la mitad más
 * reciente de los buckets de hoy contra la mitad más vieja (no un solo
 * bucket, que sería ruido) — con menos de 4 buckets no hay suficiente
 * historia todavía y se reporta "estable".
 */
export function summarizeActivity(buckets: TradeSummaryBucketLike[]): ActivitySummary {
  let askPremium = 0;
  let bidPremium = 0;
  let midPremium = 0;
  for (const b of buckets) {
    askPremium += b.ask_premium;
    bidPremium += b.bid_premium;
    midPremium += b.mid_premium;
  }
  const totalPremium = askPremium + bidPremium + midPremium;
  const netPremium = askPremium - bidPremium;

  const sorted = [...buckets].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let trend: ActivityTrend = "estable";
  if (sorted.length >= 4) {
    const mid = Math.floor(sorted.length / 2);
    const sum = (xs: TradeSummaryBucketLike[]) =>
      xs.reduce((s, x) => s + x.ask_premium + x.bid_premium + x.mid_premium, 0);
    const older = sum(sorted.slice(0, mid));
    const recent = sum(sorted.slice(mid));
    if (recent > older * 1.1) trend = "subiendo";
    else if (recent < older * 0.9) trend = "bajando";
  }

  return { totalPremium, netPremium, trend };
}

export interface ActivityLevel {
  strike: number;
  /** El tipo PRIMARIO de este strike para el motor — call arriba del spot, put abajo (ver cabecera del archivo). */
  type: "call" | "put";
  /** Actividad del tipo primario — lo único que usan `walkSide`/`contratosVecinos3Signal`. */
  activity: ActivitySummary;
  /**
   * Actividad del tipo CONTRARIO en el mismo strike (put arriba del spot,
   * call abajo) — pedido explícito de Carlos para mostrar en la tabla junto
   * al net premium del tipo primario. Puramente informativo: el motor
   * (`walkSide`/`contratosVecinos3Signal`) nunca la lee, solo la pestaña.
   * `null`/`undefined` si ese strike no tiene contrato del tipo contrario.
   */
  otherActivity?: ActivitySummary | null;
}

export interface ContratosVecinos3Target {
  strike: number;
  totalPremium: number;
  netPremium: number;
}

export interface StopLossLevel {
  strike: number;
  netPremium: number;
  type: "call" | "put";
}

interface SideWalk {
  type: "call" | "put";
  targets: ContratosVecinos3Target[];
  /** Strike donde la pared de venta (actividad alta + net premium en contra) frenó el camino, si pasó. */
  wallStrike: number | null;
  /**
   * Compra real (actividad alta + net premium positivo) encontrada DETRÁS de
   * la primera pared — no se promueve a target porque el precio necesita
   * romper la pared antes de llegar ahí, pero es evidencia real que vale la
   * pena vigilar. Caso real: SPX 2026-08-14, 10:05 ET, spot $7807 — el put
   * $7805 (más cercano) era pared vendida y frenaba el camino, pero el put
   * $7800, un strike más atrás, tenía compra agresiva real y CRECIENTE
   * (net premium +$36,778 y subiendo cada 5 min) que antes quedaba invisible.
   */
  beyondWall: ContratosVecinos3Target | null;
  /** Strike donde el Premium Traded empezó a caer justo después del último target — probable máximo. */
  capStrike: number | null;
  /** Primer strike de actividad baja (posible stop-loss), confirmado con net premium negativo ahí. */
  lowActivity: StopLossLevel | null;
  /**
   * Premium Traded del primer strike de actividad alta encontrado (target O
   * pared) — usado para decidir qué lado "gana" en `contratosVecinos3Signal`.
   * Una pared real (mucha actividad, vendida) también es evidencia de "acá
   * está el dinero", no solo los targets confirmados.
   */
  leadPremium: number;
}

/**
 * Camina un solo lado (calls arriba o puts abajo), ya ordenado del strike más
 * cercano al spot hacia afuera. Junta hasta `MAX_TARGETS` strikes de
 * actividad alta cuyo net premium confirma compra agresiva (positivo,
 * misma convención en call y put — ver cabecera del archivo). Si encuentra
 * actividad alta pero con net premium en contra (venta real), es una pared
 * real: frena ahí mismo, no sigue buscando más targets detrás de una
 * resistencia/soporte confirmado.
 *
 * `globalMaxPremium` (el máximo de TODO el vecindario, ambos lados) es la
 * vara para "baja actividad" — comparar contra el máximo del propio lado
 * fallaba en el caso real de Carlos: el lado perdedor puede no tener ningún
 * strike gigante, pero igual estar lleno de actividad relativa a SÍ mismo sin
 * serlo respecto a dónde está el dinero de verdad.
 */
function walkSide(levels: ActivityLevel[], type: "call" | "put", globalMaxPremium: number): SideWalk {
  const empty: SideWalk = {
    type, targets: [], wallStrike: null, beyondWall: null, capStrike: null, lowActivity: null, leadPremium: 0,
  };
  if (levels.length === 0) return empty;

  const maxPremium = Math.max(...levels.map((l) => l.activity.totalPremium));
  if (!(maxPremium > 0)) return empty;

  const targets: ContratosVecinos3Target[] = [];
  let wallStrike: number | null = null;
  let beyondWall: ContratosVecinos3Target | null = null;
  let leadPremium = 0;
  let stopIndex = -1;

  for (let i = 0; i < levels.length; i++) {
    const lvl = levels[i];
    const isHighActivity = lvl.activity.totalPremium >= maxPremium * HIGH_ACTIVITY_RATIO;
    if (!isHighActivity) continue;
    if (leadPremium === 0) leadPremium = lvl.activity.totalPremium;

    if (lvl.activity.netPremium > 0) {
      if (wallStrike == null) {
        targets.push({ strike: lvl.strike, totalPremium: lvl.activity.totalPremium, netPremium: lvl.activity.netPremium });
        stopIndex = i;
        if (targets.length >= MAX_TARGETS) break;
      } else {
        // Ya pasamos una pared real — esto NO es un target (el precio
        // primero tiene que romper la pared), pero es compra real que antes
        // quedaba invisible porque el camino frenaba en la primera pared.
        beyondWall = { strike: lvl.strike, totalPremium: lvl.activity.totalPremium, netPremium: lvl.activity.netPremium };
        break;
      }
    } else if (wallStrike == null) {
      // Actividad alta pero vendida agresivamente = pared real (resistencia si
      // es call, soporte si es put). Antes esto frenaba el camino del todo;
      // ahora solo deja de contar targets nuevos — se sigue mirando un poco
      // más allá por si hay compra real detrás (`beyondWall`).
      wallStrike = lvl.strike;
      stopIndex = i;
    }
  }

  // "También puedes verificar 7775, y si el Premium traded es menor que el
  // 7770, puede que 7770 sea su punto máximo" — mirar el siguiente strike CON
  // actividad después del último target confirmado; si decae, ese último
  // target es el probable techo del movimiento.
  let capStrike: number | null = null;
  if (targets.length > 0 && wallStrike == null) {
    const next = levels[stopIndex + 1];
    const last = targets[targets.length - 1];
    if (next && next.activity.totalPremium < last.totalPremium) capStrike = last.strike;
  }

  // Zona de baja actividad = candidato a stop-loss, confirmado por net
  // premium negativo del mismo tipo que se está caminando (venta real, no
  // solo silencio). Se busca en TODO el lado, no solo después de los
  // targets — puede ser el primer strike ya de entrada. Limitado a los
  // `STOP_LOSS_MAX_STRIKES` strikes más cercanos al spot — más allá de eso,
  // un stop-loss deja de ser útil aunque sea "correcto" (ver constante).
  let lowActivity: StopLossLevel | null = null;
  for (const lvl of levels.slice(0, STOP_LOSS_MAX_STRIKES)) {
    if (lvl.activity.totalPremium <= globalMaxPremium * LOW_ACTIVITY_RATIO && lvl.activity.netPremium < 0) {
      lowActivity = { strike: lvl.strike, netPremium: lvl.activity.netPremium, type };
      break;
    }
  }

  return { type, targets, wallStrike, beyondWall, capStrike, lowActivity, leadPremium };
}

export interface SupportingWall {
  strike: number;
  type: "call" | "put";
  label: "resistencia" | "soporte";
  netPremium: number;
}

/** Compra real detrás de la pared del lado PERDEDOR (ver `ContratosVecinos3Signal.reversalWatch`). */
export interface ReversalWatch extends ContratosVecinos3Target {
  type: "call" | "put";
}

export interface ContratosVecinos3Signal {
  type: "call" | "put" | null;
  target1: ContratosVecinos3Target | null;
  target2: ContratosVecinos3Target | null;
  /** Strike donde la actividad ya empezó a decaer — probable techo del movimiento. `null` si no se detectó. */
  capStrike: number | null;
  /** Pared de venta real (lado ganador) que frenó el camino antes de completar los targets, si pasó. */
  wallStrike: number | null;
  /** Nivel de baja actividad del lado CONTRARIO a la dirección — referencia de stop-loss. */
  stopLoss: StopLossLevel | null;
  /**
   * Pared real (actividad alta + venta agresiva) del lado CONTRARIO a la
   * dirección — evidencia que REFUERZA la tesis (venta de puts abajo cuando
   * la señal es CALL = soporte real; venta de calls arriba cuando es PUT =
   * resistencia real). Pedido explícito de Carlos, confirmado con datos
   * reales: SPX 2026-08-13 09:36 ET, señal CALL en $7785, con venta real de
   * puts en $7780 — soporte que reforzaba la tesis alcista. `null` sin pared
   * real del lado contrario todavía.
   */
  supportingWall: SupportingWall | null;
  /**
   * Compra real detrás de la primera pared del lado GANADOR (ver
   * `SideWalk.beyondWall`) — informativo, no un target: el precio necesita
   * romper la pared antes de que este nivel sea alcanzable.
   */
  breakoutWatch: ContratosVecinos3Target | null;
  /**
   * Compra real detrás de la pared del lado PERDEDOR — caso real: SPX
   * 2026-08-14, 10:05 ET, spot $7807.01. El lado CALL ganó (pared en $7810
   * con más dólares acumulados que la pared PUT en $7805), pero detrás de esa
   * pared PUT ya había compra real y CRECIENTE en $7800 (net premium
   * +$36,778, subiendo cada 5 min) — invisible antes porque solo se miraba
   * el lado ganador. Distinto de `supportingWall` (que es una pared VENDIDA
   * del lado perdedor, reforzando la tesis actual): esto es compra real del
   * lado perdedor, una posible reversión gestándose.
   */
  reversalWatch: ReversalWatch | null;
  reason: string;
}

export interface ContratosVecinos3Input {
  spot: number;
  /** Strikes > spot, actividad de CALLS, ordenados del más cercano al spot hacia afuera. */
  above: ActivityLevel[];
  /** Strikes < spot, actividad de PUTS, ordenados del más cercano al spot hacia afuera. */
  below: ActivityLevel[];
}

/**
 * Compara ambos lados y decide cuál gana. Un target CONFIRMADO (compra
 * agresiva real) pesa más que una simple pared, sin importar cuántos dólares
 * acumuló esa pared — una pared es resistencia/freno, no una señal de
 * entrada. Bug real encontrado con datos en vivo (SPX, 2026-08-13, 10:35 ET,
 * pico del día en $7816): antes de esto, el lado CALL "ganaba" solo porque su
 * pared en $7820 llevaba acumulados más dólares en el día, mientras el lado
 * PUT ya tenía DOS targets confirmados (compra agresiva real) en $7810 y
 * $7805 — la herramienta seguía diciendo CALL justo en el techo real, cuando
 * el dinero real ya estaba confirmando la baja. Con targets confirmados de
 * los dos lados, gana el de mayor Premium Traded en su primer target; sin
 * ningún target confirmado en ningún lado (solo paredes o nada), se cae al
 * criterio de magnitud de siempre.
 */
function pickWinner(above: SideWalk, below: SideWalk): { winner: SideWalk; loser: SideWalk } {
  const aboveConfirmed = above.targets.length > 0;
  const belowConfirmed = below.targets.length > 0;
  if (aboveConfirmed && !belowConfirmed) return { winner: above, loser: below };
  if (belowConfirmed && !aboveConfirmed) return { winner: below, loser: above };
  if (aboveConfirmed && belowConfirmed) {
    return above.targets[0].totalPremium >= below.targets[0].totalPremium
      ? { winner: above, loser: below }
      : { winner: below, loser: above };
  }
  return above.leadPremium >= below.leadPremium ? { winner: above, loser: below } : { winner: below, loser: above };
}

export function contratosVecinos3Signal(input: ContratosVecinos3Input): ContratosVecinos3Signal {
  const globalMaxPremium = Math.max(
    0,
    ...input.above.map((l) => l.activity.totalPremium),
    ...input.below.map((l) => l.activity.totalPremium),
  );
  const above = walkSide(input.above, "call", globalMaxPremium);
  const below = walkSide(input.below, "put", globalMaxPremium);

  if (above.leadPremium <= 0 && below.leadPremium <= 0) {
    return {
      type: null, target1: null, target2: null, capStrike: null, wallStrike: null, stopLoss: null,
      supportingWall: null, breakoutWatch: null, reversalWatch: null,
      reason: "Sin actividad real (Premium Traded) suficiente en el vecindario todavía — no operar.",
    };
  }

  const { winner, loser } = pickWinner(above, below);
  const stopLoss = loser.lowActivity;
  const supportingWall: SupportingWall | null =
    loser.wallStrike != null
      ? {
          strike: loser.wallStrike,
          type: loser.type,
          label: loser.type === "call" ? "resistencia" : "soporte",
          netPremium: (loser.type === "call" ? input.above : input.below).find((l) => l.strike === loser.wallStrike)
            ?.activity.netPremium ?? 0,
        }
      : null;

  const sideWord = winner.type === "call" ? "calls" : "puts";
  const dirWord = winner.type === "call" ? "CALL" : "PUT";
  const t1 = winner.targets[0] ?? null;
  const t2 = winner.targets[1] ?? null;

  let reason =
    `Mayor actividad real (Premium Traded) del lado de ${sideWord}` +
    (t1 ? `, confirmada con net premium positivo en $${t1.strike}` : "") +
    (t2 ? ` y $${t2.strike}` : "") +
    ` — sesgo ${dirWord}.`;
  if (winner.wallStrike != null) {
    reason += ` El camino se frenó en $${winner.wallStrike}: ahí hay actividad alta pero VENDIDA (pared real), no compra.`;
  } else if (winner.capStrike != null) {
    reason += ` La actividad cae justo después de $${winner.capStrike} — probable techo del movimiento.`;
  }
  if (supportingWall) {
    reason += ` Refuerza la tesis: venta real de ${supportingWall.type === "call" ? "calls" : "puts"} en $${supportingWall.strike} — ${supportingWall.label} real del lado contrario.`;
  }
  if (stopLoss) {
    reason += ` Zona de baja actividad en $${stopLoss.strike} (${stopLoss.type === "call" ? "calls" : "puts"}) con net premium negativo — referencia de stop-loss.`;
  }
  if (winner.beyondWall) {
    reason += ` Detrás de la pared, ya hay compra real acumulándose en $${winner.beyondWall.strike} — vigilar si la pared en $${winner.wallStrike} cede.`;
  }
  const reversalWatch: ReversalWatch | null = loser.beyondWall ? { ...loser.beyondWall, type: loser.type } : null;
  if (reversalWatch) {
    const loserSideWord = loser.type === "call" ? "calls" : "puts";
    reason += ` Ojo: del otro lado, detrás de su propia pared, ya hay compra real de ${loserSideWord} en $${reversalWatch.strike} — posible reversión gestándose.`;
  }

  return {
    type: winner.type, target1: t1, target2: t2,
    capStrike: winner.capStrike, wallStrike: winner.wallStrike, stopLoss, supportingWall,
    breakoutWatch: winner.beyondWall, reversalWatch, reason,
  };
}

// ── Filtro de persistencia (evita operar parpadeos de 1-2 lecturas) ────────
//
// Backtest real (SPX, 2026-08-13): con precio actualizándose cada minuto, la
// señal CALL de las 09:36-10:35 ET se sostuvo ~1 hora — real. Pero la señal
// PUT de las 12:15 ET desapareció al minuto siguiente (12:16), y la de las
// 14:50 ET duró un solo minuto — ninguna de las dos era operable de verdad.
// Pedido explícito de Carlos: exigir que la dirección se sostenga varias
// lecturas seguidas antes de confiar en ella. PURA — el caller (la pestaña)
// es quien acumula el historial de lecturas crudas; esta función solo decide
// si ese historial alcanza para confiar.

/** Lecturas seguidas que tiene que sostenerse la misma dirección para contar como confirmada. */
export const PERSISTENCE_REQUIRED = 3;

export interface PersistentSignal extends ContratosVecinos3Signal {
  /**
   * `true` si `type` y la presencia de `target1` se sostuvieron en las
   * últimas `PERSISTENCE_REQUIRED` lecturas seguidas (el STRIKE de target1
   * puede haber subido/bajado mientras tanto — "dejar correr" una posición
   * real no debe resetear la confirmación, solo un cambio de dirección o una
   * pérdida de confirmación sí).
   */
  confirmed: boolean;
}

const EMPTY_SIGNAL: ContratosVecinos3Signal = {
  type: null, target1: null, target2: null, capStrike: null, wallStrike: null, stopLoss: null,
  supportingWall: null, breakoutWatch: null, reversalWatch: null, reason: "Sin lecturas todavía.",
};

/**
 * Toma el historial de lecturas crudas más recientes (la última al final) y
 * devuelve la última con `confirmed` marcado según si se sostuvo. Con menos
 * de `PERSISTENCE_REQUIRED` lecturas en el historial, o si la última lectura
 * no tiene dirección/target1, nunca puede estar confirmada todavía.
 */
export function applyPersistence(history: ContratosVecinos3Signal[]): PersistentSignal {
  const latest = history.at(-1) ?? EMPTY_SIGNAL;
  if (latest.type == null || latest.target1 == null) {
    return { ...latest, confirmed: false };
  }
  const window = history.slice(-PERSISTENCE_REQUIRED);
  const confirmed =
    window.length >= PERSISTENCE_REQUIRED &&
    window.every((s) => s.type === latest.type && s.target1 != null);
  return { ...latest, confirmed };
}
