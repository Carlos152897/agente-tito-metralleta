// Pre-mercado de VisionFutura (Carlos, 25-oct-2026: "quiero que analices el pre mercado... y que
// vayas viendo las posiciones importantes, darme un detalle en qué rango posiblemente se
// encuentre el activo ese día").
//
// PURO (sin red ni disco). Entra: precio implícito antes de la apertura (cierre anterior + lo
// que se movió el futuro desde las 4 pm), el movimiento esperado del día (straddle ATM real o
// la IV), el open interest por strike del vencimiento del día y, si existe, el OI anterior.
// Sale: rango probable (piso/techo por posiciones de opciones), rango extendido, Magneto, flip,
// régimen de GEX, escenarios, posiciones importantes y nuevas, y la calificación al cierre.
//
// GEX propio (no el de MarketSnack): con el precio de pre-mercado, el gamma de cada strike es
// distinto al del cierre, así que se recalcula con Black-Scholes (gamma × OI × 100 × S² × 1%),
// calls positivas y puts negativas (convención usual: dealers largos calls / cortos puts).

import { bsGamma } from "./blackScholes";

export interface PremarketStrike {
  strike: number;
  callOi: number;
  putOi: number;
  callIv: number | null;
  putIv: number | null;
}

export interface PremarketInput {
  inst: string;
  /** Día de mercado que se pronostica (YYYY-MM-DD). */
  targetDate: string;
  /** Vencimiento de las opciones usado (el del día si existe). */
  expiration: string;
  now: number;
  /** Cierre de la sesión anterior del instrumento. */
  prevClose: number;
  /** Precio implícito ahora (pre-mercado). */
  spot: number;
  spotSource: string;
  future: { symbol: string; last: number; atPrevClose: number | null; onHigh: number | null; onLow: number | null } | null;
  prevDay: { high: number; low: number; close: number } | null;
  /** Movimiento esperado del día (1σ, en puntos). */
  sigma: { points: number; source: string };
  strikes: PremarketStrike[];
  /** Años hasta el vencimiento (para el gamma). */
  yearsToExpiry: number;
  /** IV de respaldo para strikes sin IV (decimal). */
  fallbackIv: number;
  /** OI de la versión anterior (antes de la última actualización de OCC), por strike. */
  oiPrev: { capturedAt: string; byStrike: Record<string, [number, number]> } | null;
  /** Eventos del día (FOMC, CPI…): ensanchan el rango. */
  events: string[];
  /** Aclaración de dónde salen las opciones (ej. NQ con QQQ). */
  optionsNote?: string;
}

export interface PremarketPosition {
  strike: number;
  callOi: number;
  putOi: number;
  /** Cambio de OI contra la versión anterior (null si no hay anterior). */
  dCall: number | null;
  dPut: number | null;
  netGex: number;
  /** Etiquetas de nivel que caen en ese strike. */
  tags: string[];
  lectura: string;
}

export interface PremarketMark {
  label: string;
  price: number;
  kind: "cierre" | "ayer" | "noche" | "magneto" | "flip" | "techo" | "piso" | "max_pain";
}

export interface PremarketScenario {
  kind: "base" | "alcista" | "bajista";
  title: string;
  text: string;
}

export interface PremarketReport {
  inst: string;
  targetDate: string;
  expiration: string;
  asOf: string;
  spot: number;
  spotSource: string;
  prevClose: number;
  gap: number;
  gapPct: number;
  sigma: number;
  sigmaSource: string;
  /** Futuro − precio implícito (para pasar los niveles a /ES o /NQ). */
  futBasis: number | null;
  futSymbol: string | null;
  regime: "positivo" | "negativo" | null;
  totalGex: number;
  levels: { magnet: number | null; callWall: number | null; putWall: number | null; flip: number | null; maxPain: number | null };
  techo: { price: number; why: string };
  piso: { price: number; why: string };
  range: { low: number; high: number };
  extended: { low: number; high: number };
  confidence: "alta" | "media" | "baja";
  confidenceWhy: string[];
  bias: "alcista" | "bajista" | "neutral";
  biasWhy: string[];
  scenarios: PremarketScenario[];
  positions: PremarketPosition[];
  newPositions: PremarketPosition[];
  oiPrevAt: string | null;
  marks: PremarketMark[];
  lecturas: string[];
  events: string[];
}

export const PREMARKET_TUNING = {
  /** Ventana de strikes para buscar niveles: ±2.5σ. */
  searchSigma: 2.5,
  /** Piso/techo por posiciones solo si quedan entre 0.3σ y 1.6σ del precio. */
  minLevelSigma: 0.3,
  maxLevelSigma: 1.6,
  /** Un strike cuenta como "pared" si tiene ≥ 50% del GEX del lado más grande. */
  wallShare: 0.5,
  /** Rango extendido: ±1.5σ (o más si el piso/techo queda afuera). */
  extendedSigma: 1.5,
  /** Día con evento: σ × 1.25. */
  eventWiden: 1.25,
  /** Posiciones importantes a mostrar (dentro de ±1.5σ). */
  topPositions: 8,
  positionsSigma: 1.5,
  topNew: 5,
};

const gexOf = (s: PremarketStrike, S: number, T: number, iv0: number) => {
  const k = 100 * S * S * 0.01;
  const g = (iv: number | null) => bsGamma(S, s.strike, T, iv != null && iv > 0.02 && iv < 3 ? iv : iv0);
  const call = s.callOi * g(s.callIv) * k;
  const put = s.putOi * g(s.putIv) * k;
  return { call, put, net: call - put };
};

/** GEX total si el precio estuviera en S (para el gamma flip). */
export function totalGexAt(strikes: PremarketStrike[], S: number, T: number, iv0: number): number {
  let t = 0;
  for (const s of strikes) t += gexOf(s, S, T, iv0).net;
  return t;
}

/** Precio donde el GEX total cambia de signo, el más cercano al spot (null si no cruza en ±3σ). */
export function gammaFlip(strikes: PremarketStrike[], spot: number, sigma: number, T: number, iv0: number): number | null {
  const lo = spot - 3 * sigma, hi = spot + 3 * sigma;
  const n = 120;
  const dx = (hi - lo) / n;
  let best: number | null = null;
  let prevS = lo, prevV = totalGexAt(strikes, lo, T, iv0);
  for (let i = 1; i <= n; i++) {
    const S = lo + i * dx;
    const v = totalGexAt(strikes, S, T, iv0);
    if ((prevV < 0 && v >= 0) || (prevV > 0 && v <= 0)) {
      const x = prevS + (dx * Math.abs(prevV)) / (Math.abs(prevV) + Math.abs(v) || 1);
      if (best == null || Math.abs(x - spot) < Math.abs(best - spot)) best = x;
    }
    prevS = S; prevV = v;
  }
  return best;
}

/** Strike con el menor pago total a los compradores al vencimiento. */
export function maxPain(strikes: PremarketStrike[]): number | null {
  if (strikes.length === 0) return null;
  let best: number | null = null, bestPay = Infinity;
  for (const k of strikes) {
    let pay = 0;
    for (const s of strikes) {
      if (k.strike > s.strike) pay += (k.strike - s.strike) * s.callOi;
      if (k.strike < s.strike) pay += (s.strike - k.strike) * s.putOi;
    }
    if (pay < bestPay) { bestPay = pay; best = k.strike; }
  }
  return best;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function buildPremarket(input: PremarketInput): PremarketReport {
  const T = Math.max(input.yearsToExpiry, 1 / (365 * 24 * 4)); // mínimo 15 min
  const iv0 = input.fallbackIv > 0 ? input.fallbackIv : 0.18;
  const P = input.spot;
  const hasEvent = input.events.length > 0;
  const sigma = input.sigma.points * (hasEvent ? PREMARKET_TUNING.eventWiden : 1);
  const tu = PREMARKET_TUNING;

  const near = input.strikes.filter((s) => Math.abs(s.strike - P) <= tu.searchSigma * sigma);
  const g = near.map((s) => ({ s, ...gexOf(s, P, T, iv0) }));
  const totalGex = totalGexAt(input.strikes, P, T, iv0);
  const regime = input.strikes.length === 0 ? null : totalGex >= 0 ? "positivo" : "negativo";

  const maxBy = <X>(arr: X[], f: (x: X) => number) => arr.reduce<X | null>((a, b) => (a == null || f(b) > f(a) ? b : a), null);
  const callWall = maxBy(g, (x) => x.call)?.s.strike ?? null;
  const putWall = maxBy(g, (x) => x.put)?.s.strike ?? null;
  const magnet = maxBy(g.filter((x) => Math.abs(x.s.strike - P) <= 2 * sigma), (x) => Math.abs(x.net))?.s.strike ?? null;
  const flip = input.strikes.length ? gammaFlip(input.strikes, P, sigma, T, iv0) : null;
  const mp = maxPain(near);

  // Techo: la pared de calls más CERCANA arriba con ≥ 50% del GEX de calls más grande, dentro de 0.3–1.6σ.
  const maxCall = Math.max(0, ...g.map((x) => x.call));
  const maxPut = Math.max(0, ...g.map((x) => x.put));
  const inBand = (k: number) => Math.abs(k - P) >= tu.minLevelSigma * sigma && Math.abs(k - P) <= tu.maxLevelSigma * sigma;
  const techoC = g.filter((x) => x.s.strike > P && inBand(x.s.strike) && x.call >= tu.wallShare * maxCall && maxCall > 0)
    .sort((a, b) => a.s.strike - b.s.strike)[0];
  const pisoC = g.filter((x) => x.s.strike < P && inBand(x.s.strike) && x.put >= tu.wallShare * maxPut && maxPut > 0)
    .sort((a, b) => b.s.strike - a.s.strike)[0];
  const fmtK = (k: number) => k.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const techo = techoC
    ? { price: techoC.s.strike, why: `${techoC.s.strike === callWall ? "pared de calls" : "concentración de calls"} (${fmtK(techoC.s.callOi)} contratos)` }
    : { price: r2(P + sigma), why: "sin pared de calls cerca: movimiento esperado (+1σ)" };
  const piso = pisoC
    ? { price: pisoC.s.strike, why: `${pisoC.s.strike === putWall ? "pared de puts" : "concentración de puts"} (${fmtK(pisoC.s.putOi)} contratos)` }
    : { price: r2(P - sigma), why: "sin pared de puts cerca: movimiento esperado (−1σ)" };

  const range = { low: piso.price, high: techo.price };
  const ext = tu.extendedSigma * sigma;
  const extended = { low: r2(Math.min(range.low, P - ext)), high: r2(Math.max(range.high, P + ext)) };

  // Confianza del rango.
  const confidenceWhy: string[] = [];
  let score = 0;
  if (techoC && pisoC) { score += 2; confidenceWhy.push("piso y techo salen de posiciones reales de opciones"); }
  else if (techoC || pisoC) { score += 1; confidenceWhy.push(`solo el ${techoC ? "techo" : "piso"} sale de posiciones; el otro lado es el movimiento esperado`); }
  else confidenceWhy.push("no hay paredes de opciones cerca: el rango es solo el movimiento esperado");
  if (regime === "positivo") { score += 1; confidenceWhy.push("GEX positivo: los dealers frenan los movimientos (días de rango)"); }
  else if (regime === "negativo") { score -= 1; confidenceWhy.push("GEX negativo: los dealers aceleran los movimientos (rompe rangos más fácil)"); }
  if (hasEvent) { score -= 1; confidenceWhy.push(`evento del día (${input.events.join(", ")}): rango ensanchado ×${tu.eventWiden}`); }
  if (input.sigma.source.startsWith("IV")) confidenceWhy.push("movimiento esperado por IV (sin straddle cotizado en pre-mercado)");
  const confidence = score >= 3 ? "alta" : score >= 1 ? "media" : "baja";

  // Sesgo: Magneto, gap y tendencia de la noche.
  const gap = r2(P - input.prevClose);
  const gapPct = input.prevClose > 0 ? r2((gap / input.prevClose) * 100) : 0;
  const biasWhy: string[] = [];
  let b = 0;
  if (magnet != null && Math.abs(magnet - P) >= 0.2 * sigma) {
    b += magnet > P ? 1 : -1;
    biasWhy.push(`Magneto ${fmtK(magnet)} ${magnet > P ? "arriba" : "abajo"} del precio (${Math.abs(magnet - P).toFixed(1)} pts): jala hacia allá`);
  }
  if (flip != null) {
    if (P > flip) biasWhy.push(`precio arriba del gamma flip ${fmtK(r2(flip))}: zona más tranquila`);
    else { b -= 1; biasWhy.push(`precio debajo del gamma flip ${fmtK(r2(flip))}: zona de movimientos rápidos, sesgo bajista`); }
  }
  if (Math.abs(gap) >= 0.3 * sigma) {
    biasWhy.push(`gap ${gap > 0 ? "alcista" : "bajista"} de ${Math.abs(gap).toFixed(1)} pts (${gapPct > 0 ? "+" : ""}${gapPct}%): el cierre anterior ${fmtK(input.prevClose)} queda como objetivo de relleno`);
  }
  const bias = b >= 1 ? "alcista" : b <= -1 ? "bajista" : "neutral";

  // Posiciones importantes: mayor OI total cerca del precio.
  const tagsOf = (k: number) => {
    const t: string[] = [];
    if (k === magnet) t.push("Magneto");
    if (k === techo.price && techoC) t.push("Techo");
    if (k === piso.price && pisoC) t.push("Piso");
    if (k === callWall) t.push("Pared calls");
    if (k === putWall) t.push("Pared puts");
    if (k === mp) t.push("Max pain");
    return t;
  };
  const prev = input.oiPrev?.byStrike ?? null;
  const posOf = (x: (typeof g)[number]): PremarketPosition => {
    const p = prev ? prev[String(x.s.strike)] : undefined;
    const dCall = prev ? x.s.callOi - (p?.[0] ?? 0) : null;
    const dPut = prev ? x.s.putOi - (p?.[1] ?? 0) : null;
    const k = x.s.strike;
    const dom = x.s.callOi > 1.5 * x.s.putOi ? "calls" : x.s.putOi > 1.5 * x.s.callOi ? "puts" : null;
    const tags = tagsOf(k);
    const lectura = tags.includes("Techo") ? "techo del día: la pared de calls más cercana arriba frena las subidas"
      : tags.includes("Piso") ? "piso del día: la pared de puts más cercana abajo frena las caídas"
      : tags.includes("Magneto") ? "Magneto: el strike con más gamma; el precio tiende a regresar aquí"
      : dom === "calls"
        ? k > P ? "pared de calls arriba: freno a las subidas" : "calls ya dentro del dinero: pierde fuerza como nivel"
        : dom === "puts"
          ? k < P ? "pared de puts abajo: freno a las caídas" : "puts ya dentro del dinero (coberturas): pierde fuerza como nivel"
          : "calls y puts parejas: zona de pelea / el precio se puede quedar pegado";
    return { strike: k, callOi: x.s.callOi, putOi: x.s.putOi, dCall, dPut, netGex: x.net, tags, lectura };
  };
  const positions = [...g]
    .filter((x) => x.s.callOi + x.s.putOi > 0 && Math.abs(x.s.strike - P) <= tu.positionsSigma * sigma)
    .sort((a, b2) => b2.s.callOi + b2.s.putOi - (a.s.callOi + a.s.putOi))
    .slice(0, tu.topPositions)
    .map(posOf)
    .sort((a, b2) => b2.strike - a.strike);
  const newPositions = prev
    ? g.map(posOf)
      .filter((p) => (p.dCall ?? 0) + (p.dPut ?? 0) > 0)
      .sort((a, b2) => (b2.dCall ?? 0) + (b2.dPut ?? 0) - ((a.dCall ?? 0) + (a.dPut ?? 0)))
      .slice(0, tu.topNew)
    : [];

  // Marcas para la barra del rango.
  const marks: PremarketMark[] = [{ label: "Cierre anterior", price: input.prevClose, kind: "cierre" }];
  if (input.prevDay) {
    marks.push({ label: "Máx. de ayer", price: input.prevDay.high, kind: "ayer" }, { label: "Mín. de ayer", price: input.prevDay.low, kind: "ayer" });
  }
  const fut = input.future;
  if (fut?.atPrevClose != null && fut.onHigh != null && fut.onLow != null) {
    // Máx/mín de la noche del futuro pasados al instrumento.
    marks.push(
      { label: "Máx. de la noche", price: r2(input.prevClose + (fut.onHigh - fut.atPrevClose)), kind: "noche" },
      { label: "Mín. de la noche", price: r2(input.prevClose + (fut.onLow - fut.atPrevClose)), kind: "noche" },
    );
  }
  if (magnet != null) marks.push({ label: "Magneto", price: magnet, kind: "magneto" });
  if (flip != null) marks.push({ label: "Gamma flip", price: r2(flip), kind: "flip" });
  if (mp != null) marks.push({ label: "Max pain", price: mp, kind: "max_pain" });
  marks.push({ label: "Techo", price: techo.price, kind: "techo" }, { label: "Piso", price: piso.price, kind: "piso" });

  // Escenarios en palabras simples.
  const nextAbove = g.filter((x) => x.s.strike > range.high && x.call >= 0.3 * maxCall && maxCall > 0).sort((a, b2) => a.s.strike - b2.s.strike)[0]?.s.strike ?? extended.high;
  const nextBelow = g.filter((x) => x.s.strike < range.low && x.put >= 0.3 * maxPut && maxPut > 0).sort((a, b2) => b2.s.strike - a.s.strike)[0]?.s.strike ?? extended.low;
  const scenarios: PremarketScenario[] = [
    {
      kind: "base",
      title: `Base: rango ${fmtK(range.low)} – ${fmtK(range.high)}`,
      text: regime === "negativo"
        ? `Lo más probable es que se mueva entre ${fmtK(range.low)} y ${fmtK(range.high)}, pero con GEX negativo los toques del piso o el techo pueden romperse con fuerza.${magnet != null ? ` Magneto ${fmtK(magnet)} como imán.` : ""}`
        : `Lo más probable es que rebote entre ${fmtK(range.low)} y ${fmtK(range.high)}: los dealers venden las subidas y compran las caídas.${magnet != null ? ` Tiende a regresar al Magneto ${fmtK(magnet)}.` : ""}`,
    },
    {
      kind: "alcista",
      title: `Alcista: rompe ${fmtK(range.high)}`,
      text: `Si pasa el techo ${fmtK(range.high)} y se sostiene arriba, el siguiente objetivo es ${fmtK(nextAbove)}. Confirma con el VIX bajando.`,
    },
    {
      kind: "bajista",
      title: `Bajista: pierde ${fmtK(range.low)}`,
      text: `Si pierde el piso ${fmtK(range.low)} y no lo recupera, el siguiente objetivo es ${fmtK(nextBelow)}. Confirma con el VIX subiendo.`,
    },
  ];

  const lecturas: string[] = [
    `Precio implícito ${fmtK(r2(P))} (${input.spotSource}); cierre anterior ${fmtK(input.prevClose)} → ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts.`,
    `Movimiento esperado hoy ±${sigma.toFixed(1)} pts (${input.sigma.source}${hasEvent ? `, ×${tu.eventWiden} por evento` : ""}).`,
    `Rango probable ${fmtK(range.low)} – ${fmtK(range.high)} (${(range.high - range.low).toFixed(0)} pts) · extendido ${fmtK(extended.low)} – ${fmtK(extended.high)}.`,
  ];
  // Paredes pegadas al precio (< 0.3σ): no cuentan como piso/techo del día, pero son el primer freno.
  if (putWall != null && putWall < P && P - putWall < tu.minLevelSigma * sigma) {
    lecturas.push(`Soporte inmediato: pared de puts en ${fmtK(putWall)} (a ${(P - putWall).toFixed(1)} pts). Si la pierde, va hacia el piso ${fmtK(piso.price)}.`);
  }
  if (callWall != null && callWall > P && callWall - P < tu.minLevelSigma * sigma) {
    lecturas.push(`Resistencia inmediata: pared de calls en ${fmtK(callWall)} (a ${(callWall - P).toFixed(1)} pts). Si la pasa, va hacia el techo ${fmtK(techo.price)}.`);
  }
  if (input.optionsNote) lecturas.push(`Opciones: ${input.optionsNote}.`);
  if (regime) lecturas.push(`GEX total ${regime} con el precio de pre-mercado${regime === "positivo" ? ": día más de rango" : ": día con más tendencia/volatilidad"}.`);

  return {
    inst: input.inst, targetDate: input.targetDate, expiration: input.expiration, asOf: new Date(input.now).toISOString(),
    spot: r2(P), spotSource: input.spotSource, prevClose: input.prevClose, gap, gapPct,
    sigma: r2(sigma), sigmaSource: input.sigma.source,
    futBasis: fut ? r2(fut.last - P) : null, futSymbol: fut?.symbol ?? null,
    regime, totalGex,
    levels: { magnet, callWall, putWall, flip: flip != null ? r2(flip) : null, maxPain: mp },
    techo, piso, range, extended, confidence, confidenceWhy, bias, biasWhy, scenarios,
    positions, newPositions, oiPrevAt: input.oiPrev?.capturedAt ?? null,
    marks, lecturas, events: input.events,
  };
}

// ── Calificación al cierre ──

export interface PremarketGrade {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** El día completo quedó dentro del rango probable. */
  insideRange: boolean;
  insideExtended: boolean;
  /** El cierre quedó dentro del rango probable. */
  closeInside: boolean;
  /** Tocó el techo (±tolerancia) y cerró debajo: el techo aguantó. */
  techoHeld: boolean | null;
  pisoHeld: boolean | null;
  /** Rango real ÷ rango esperado (2σ). >1 = más movido de lo esperado. */
  realizedVsExpected: number;
  closeVsMagnet: number | null;
  notes: string[];
}

/** Compara el pronóstico con lo que hizo el día. `tol` = tolerancia para "tocó" (pts). */
export function gradePremarket(r: PremarketReport, day: { open: number; high: number; low: number; close: number; date: string }, tol = Math.max(1, r.sigma * 0.05)): PremarketGrade {
  const touchedT = day.high >= r.techo.price - tol;
  const touchedP = day.low <= r.piso.price + tol;
  const techoHeld = touchedT ? day.close < r.techo.price && day.high <= r.techo.price + 2 * tol : null;
  const pisoHeld = touchedP ? day.close > r.piso.price && day.low >= r.piso.price - 2 * tol : null;
  const insideRange = day.high <= r.range.high + tol && day.low >= r.range.low - tol;
  const insideExtended = day.high <= r.extended.high + tol && day.low >= r.extended.low - tol;
  const closeInside = day.close <= r.range.high && day.close >= r.range.low;
  const notes: string[] = [];
  if (insideRange) notes.push("el día completo quedó dentro del rango probable");
  else {
    if (day.high > r.range.high + tol) notes.push(`superó el techo por ${(day.high - r.range.high).toFixed(1)} pts`);
    if (day.low < r.range.low - tol) notes.push(`perforó el piso por ${(r.range.low - day.low).toFixed(1)} pts`);
  }
  if (techoHeld === true) notes.push("el techo aguantó");
  if (pisoHeld === true) notes.push("el piso aguantó");
  return {
    date: day.date, open: day.open, high: day.high, low: day.low, close: day.close,
    insideRange, insideExtended, closeInside, techoHeld, pisoHeld,
    realizedVsExpected: r.sigma > 0 ? r2((day.high - day.low) / (2 * r.sigma)) : 0,
    closeVsMagnet: r.levels.magnet != null ? r2(day.close - r.levels.magnet) : null,
    notes,
  };
}

// ── Fechas ──

const nyParts = (ms: number) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")), weekday: get("weekday") };
};

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (date: string) => { const w = new Date(`${date}T12:00:00Z`).getUTCDay(); return w === 0 || w === 6; };

/** Día hábil siguiente (sin feriados). */
export const nextWeekday = (date: string) => { let d = addDays(date, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
export const prevWeekday = (date: string) => { let d = addDays(date, -1); while (isWeekend(d)) d = addDays(d, -1); return d; };

/**
 * Qué día se pronostica y en qué fase está: antes de las 9:30 NY de un día hábil → ese día,
 * "pre"; 9:30–16:00 → ese día, "sesion"; después de las 16:00 o fin de semana → el siguiente
 * día hábil, "pre".
 */
export function premarketTarget(nowMs: number): { date: string; phase: "pre" | "sesion" } {
  const { date, minutes } = nyParts(nowMs);
  if (!isWeekend(date)) {
    if (minutes < 9 * 60 + 30) return { date, phase: "pre" };
    if (minutes < 16 * 60) return { date, phase: "sesion" };
  }
  return { date: nextWeekday(date), phase: "pre" };
}

/** ms de una hora NY de un día (ej. 16:00 del día anterior). */
export function nyTimeMs(date: string, hhmm: string): number {
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T16:00:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  return Date.parse(`${date}T${hhmm}:00${off}`);
}
