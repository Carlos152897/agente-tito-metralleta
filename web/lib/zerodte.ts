// ============================================================================
// Agente ODTE — cadena del vencimiento del día, ordenada por volumen. Ver
// Agente Principal/Proceso 0DTE.md (compartido por Carlos). Genérico por
// ticker (ver lib/zerodteTickers.ts para el selector SPX/SPY/QQQ/ES/NQ).
// Cadena de opciones vía tastytrade (tastytradeChain.ts, ago 2026 — reemplazó
// a Schwab por dar tiempo real de fábrica en vez de isDelayed=true). Las
// barras intradía del subyacente siguen en Schwab (zerodteSchwab.ts) —
// tastytrade no tiene REST de velas, solo DXLink. No toca
// `lib/schwab.ts`/`lib/types.ts`/`lib/gex.ts` reales — ver plan de port.
// ============================================================================

import { marketDateStr } from "./occ";
import { expectedMove, probTouch } from "./expectedMove";
import { bsCharm, bsVanna, chainIV, MAX_SANE_IV } from "./zerodteGex";
import { evaluateEntry, noSetupReason, riskReward, type EntryDecision } from "./zerodteStrategy";
import { fetchZeroDteChain } from "./tastytradeChain";
import type { ContractType, ZRow } from "./zerodteTypes";
import { loadFlow, netAggressorTotals, overlayRealtime } from "./zerodteFlow";
import { INDEX_UNDERLYINGS } from "./zerodteTickers";
import { buildSuggestions, type ZeroDteSuggestions } from "./zerodteSuggestions";

/** Cuántos strikes se toman de cada lado. */
export const TOP_N = 10;

/** Símbolo que espera Schwab: los índices necesitan el prefijo "$", las ETF no. */
export function toSchwabSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  if (!t) return "";
  return INDEX_UNDERLYINGS.has(t) ? `$${t}` : t;
}

/** Fecha de HOY en hora de Nueva York (no UTC — la premisa del agente). */
export function etDate(now: Date = new Date()): string {
  return marketDateStr(now);
}

/** Fechas de vencimiento seleccionables: hoy + los próximos `count` días hábiles. */
export function expirationDates(now: Date = new Date(), count = 3): string[] {
  const out = [etDate(now)];
  const cursor = new Date(now.getTime());
  while (out.length <= count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const wd = new Date(`${marketDateStr(cursor)}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(marketDateStr(cursor));
  }
  return out;
}

/** Los N strikes con mayor volumen de un lado. PURA. */
export function topByVolume(rows: ZRow[], type: ContractType, n: number = TOP_N): ZRow[] {
  return rows
    .filter((r) => r.contractType === type)
    .sort((a, b) => b.volume - a.volume || Math.abs(a.strike) - Math.abs(b.strike))
    .slice(0, n);
}

export interface ChainLine {
  strike: number;
  call: ZRow | null;
  put: ZRow | null;
  from: "call" | "put" | "both";
}

/** Construye la tabla con forma de option chain. PURA. */
export function buildChainTable(all: ZRow[], n: number = TOP_N): ChainLine[] {
  const topCalls = topByVolume(all, "call", n);
  const topPuts = topByVolume(all, "put", n);
  const callRank = new Set(topCalls.map((r) => r.strike));
  const putRank = new Set(topPuts.map((r) => r.strike));

  const byStrike = new Map<number, { call: ZRow | null; put: ZRow | null }>();
  for (const r of all) {
    if (!callRank.has(r.strike) && !putRank.has(r.strike)) continue;
    let e = byStrike.get(r.strike);
    if (!e) { e = { call: null, put: null }; byStrike.set(r.strike, e); }
    if (r.contractType === "call") e.call = r;
    else e.put = r;
  }

  return [...byStrike.entries()]
    .map(([strike, e]) => ({
      strike,
      call: e.call,
      put: e.put,
      from: (callRank.has(strike) && putRank.has(strike)
        ? "both"
        : callRank.has(strike)
          ? "call"
          : "put") as ChainLine["from"],
    }))
    .sort((a, b) => b.strike - a.strike);
}

export interface ChainSummary {
  maxCallStrike: number | null;
  maxCallVolume: number;
  maxPutStrike: number | null;
  maxPutVolume: number;
  callVolume: number;
  putVolume: number;
  putCallRatio: number | null;
}

/** Resumen de la cadena. PURA. */
export function summarize(all: ZRow[]): ChainSummary {
  let maxCall: ZRow | null = null;
  let maxPut: ZRow | null = null;
  let callVolume = 0;
  let putVolume = 0;
  for (const r of all) {
    if (r.contractType === "call") {
      callVolume += r.volume;
      if (!maxCall || r.volume > maxCall.volume) maxCall = r;
    } else {
      putVolume += r.volume;
      if (!maxPut || r.volume > maxPut.volume) maxPut = r;
    }
  }
  return {
    maxCallStrike: maxCall?.strike ?? null,
    maxCallVolume: maxCall?.volume ?? 0,
    maxPutStrike: maxPut?.strike ?? null,
    maxPutVolume: maxPut?.volume ?? 0,
    callVolume,
    putVolume,
    putCallRatio: callVolume > 0 ? putVolume / callVolume : null,
  };
}

const CLOSE_MIN = 16 * 60;

/** Horas que faltan para el cierre (16:00 ET). PURA. */
export function hoursToClose(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const raw = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const h = raw === 24 ? 0 : raw;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return Math.max(0, (CLOSE_MIN - (h * 60 + m)) / 60);
}

/** Ventana estrecha alrededor del spot para medir la IV del día (0DTE). */
export const ATM_PCT = 0.02;

/** IV at-the-money del vencimiento del día, ponderada por Open Interest. PURA. */
export function atmIV(rows: ZRow[], spot: number, pct: number = ATM_PCT): number | null {
  if (!(spot > 0)) return null;
  const lo = spot * (1 - pct);
  const hi = spot * (1 + pct);
  let weighted = 0;
  let weight = 0;
  for (const r of rows) {
    const iv = r.greeks?.iv;
    if (typeof iv !== "number" || !(iv > 0) || iv > MAX_SANE_IV) continue;
    if (r.strike < lo || r.strike > hi) continue;
    if (!(r.openInterest > 0)) continue;
    weighted += iv * r.openInterest;
    weight += r.openInterest;
  }
  return weight > 0 ? weighted / weight : null;
}

export const GEX_NEAR_PCT = 0.03;

export interface ZeroDteGexNode {
  strike: number;
  netGex: number;
  callGex: number;
  putGex: number;
  side: "call" | "put";
  concentration: number;
}

export interface ZeroDteGex {
  nodes: ZeroDteGexNode[];
  kingStrike: number | null;
  flipStrike: number | null;
  regime: "positive" | "negative";
  totalNetGex: number;
  realGammaShare: number;
  n: number;
}

/** GEX del vencimiento del día, con la gamma real de Schwab. PURA. */
export function zeroDteGex(rows: ZRow[], spot: number, nearPct: number = GEX_NEAR_PCT): ZeroDteGex {
  const empty: ZeroDteGex = {
    nodes: [], kingStrike: null, flipStrike: null,
    regime: "positive", totalNetGex: 0, realGammaShare: 0, n: 0,
  };
  if (!(spot > 0) || rows.length === 0) return empty;

  const lo = spot * (1 - nearPct);
  const hi = spot * (1 + nearPct);
  const byStrike = new Map<number, { callGex: number; putGex: number }>();
  let considered = 0;
  let withRealGamma = 0;

  for (const r of rows) {
    if (r.strike < lo || r.strike > hi) continue;
    if (!(r.openInterest > 0)) continue;
    const gamma = r.greeks?.gamma;
    considered += 1;
    if (typeof gamma !== "number" || !(gamma > 0)) continue;
    withRealGamma += 1;

    const gex = gamma * r.openInterest * 100 * spot * spot * 0.01;
    const s = byStrike.get(r.strike) ?? { callGex: 0, putGex: 0 };
    if (r.contractType === "call") s.callGex += gex;
    else s.putGex += gex;
    byStrike.set(r.strike, s);
  }

  if (byStrike.size === 0) return empty;

  const raw = [...byStrike.entries()]
    .map(([strike, g]) => ({
      strike, netGex: g.callGex - g.putGex, callGex: g.callGex, putGex: g.putGex,
      total: g.callGex + g.putGex,
    }))
    .sort((a, b) => a.strike - b.strike);

  const maxTotal = Math.max(...raw.map((r) => r.total), 0);
  const nodes: ZeroDteGexNode[] = raw.map((r) => ({
    strike: r.strike, netGex: r.netGex, callGex: r.callGex, putGex: r.putGex,
    side: (r.netGex >= 0 ? "call" : "put") as "call" | "put",
    concentration: maxTotal > 0 ? r.total / maxTotal : 0,
  }));

  const king = nodes.reduce((a, b) => (b.concentration > a.concentration ? b : a));

  let flipStrike: number | null = null;
  let acc = 0;
  let prev = 0;
  for (const nd of raw) {
    prev = acc;
    acc += nd.netGex;
    if (prev !== 0 && Math.sign(acc) !== Math.sign(prev)) {
      flipStrike = nd.strike;
      break;
    }
  }

  const totalNetGex = raw.reduce((s, r) => s + r.netGex, 0);

  return {
    nodes: [...nodes].sort((a, b) => b.concentration - a.concentration),
    kingStrike: king.strike,
    flipStrike,
    regime: totalNetGex >= 0 ? "positive" : "negative",
    totalNetGex,
    realGammaShare: considered > 0 ? withRealGamma / considered : 0,
    n: byStrike.size,
  };
}

export interface DealerFlow {
  netCharm: number;
  netVanna: number;
  charmIntensity: number;
  vannaIfVolDrops: Lean;
  note: string;
}

/** Agrega charm y vanna de la cadena del día como "flujo de dealer". PURA. */
export function dealerFlow(
  rows: ZRow[], spot: number, iv: number | null, hoursLeft: number, nearPct = 0.03,
): DealerFlow | null {
  if (!(spot > 0) || iv == null || !(iv > 0) || hoursLeft <= 0) return null;

  const lo = spot * (1 - nearPct);
  const hi = spot * (1 + nearPct);
  const T = hoursLeft / (24 * 365);

  let netCharm = 0;
  let netVanna = 0;
  for (const r of rows) {
    if (r.strike < lo || r.strike > hi) continue;
    if (!(r.openInterest > 0)) continue;
    const sign = r.contractType === "call" ? 1 : -1;
    netCharm += bsCharm(spot, r.strike, T, iv) * r.openInterest * sign;
    netVanna += bsVanna(spot, r.strike, T, iv) * r.openInterest * sign;
  }

  const charmIntensity = Math.max(0, Math.min(1, 1 - hoursLeft / 6.5));
  const vannaIfVolDrops: Lean =
    Math.abs(netVanna) < 1e-6 ? "lateral" : netVanna > 0 ? "bajista" : "alcista";

  const note =
    `Charm ${netCharm >= 0 ? "positivo" : "negativo"} (intensidad ${(charmIntensity * 100).toFixed(0)}%, ` +
    `sube hacia el cierre); vanna sugiere sesgo ${vannaIfVolDrops} si la IV baja.`;

  return { netCharm, netVanna, charmIntensity, vannaIfVolDrops, note };
}

export type Lean = "alcista" | "bajista" | "lateral";

export interface ShortTermOutlook {
  spot: number;
  horizonMinutes: number;
  sigma: number;
  rangeLow: number;
  rangeHigh: number;
  magnet: number | null;
  regime: "positive" | "negative";
  lean: Lean;
  headline: string;
  detail: string;
  confidence: "baja" | "media";
  charmIntensity: number | null;
  charmNote: string | null;
  vannaNote: string | null;
}

const nfPts = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Panorama del próximo tramo (por defecto 5 min). PURA. */
export function shortTermOutlook(
  spot: number, iv: number | null, gex: ZeroDteGex, horizonMinutes = 5, flow?: DealerFlow | null,
): ShortTermOutlook | null {
  if (!(spot > 0) || iv == null || !(iv > 0)) return null;

  const days = horizonMinutes / 1440;
  const em = expectedMove(spot, iv, days);
  const sigma = em.sigma;
  const lo = em.lower1;
  const hi = em.upper1;
  const magnet = gex.kingStrike;
  const dist = magnet != null ? magnet - spot : 0;
  const charmI = flow?.charmIntensity ?? null;

  let lean: Lean = "lateral";
  let detail: string;
  const reach = 2 * sigma * (1 + 0.5 * (charmI ?? 0));

  if (magnet == null) {
    detail = "Sin imán de gamma identificable; movimiento sin sesgo claro.";
  } else if (gex.regime === "positive") {
    if (Math.abs(dist) <= sigma) {
      lean = "lateral";
      detail = `Gamma positiva y el precio ya está sobre el imán ${nfPts(magnet)}: los dealers lo anclan, se espera lateral.`;
    } else if (Math.abs(dist) <= reach) {
      lean = dist > 0 ? "alcista" : "bajista";
      detail = `Gamma positiva: el precio tiende a volver al imán ${nfPts(magnet)}, ${dist > 0 ? "por encima" : "por debajo"}.`;
    } else {
      lean = "lateral";
      detail = `El imán ${nfPts(magnet)} queda fuera de alcance en ${horizonMinutes} min; sesgo lateral dentro del rango.`;
    }
  } else {
    lean = "lateral";
    const flipDisp = gex.flipStrike != null ? nfPts(gex.flipStrike) : "un extremo";
    detail = `Gamma negativa: los movimientos se amplifican. Si rompe ${flipDisp}, puede acelerar.`;
  }

  const confidence: "baja" | "media" =
    gex.regime === "positive" && magnet != null && Math.abs(dist) <= sigma ? "media" : "baja";

  let charmNote: string | null = null;
  let vannaNote: string | null = null;
  if (flow && charmI != null) {
    const pct = `${(charmI * 100).toFixed(0)}%`;
    const magDisp = magnet != null ? nfPts(magnet) : "el imán";
    charmNote =
      gex.regime === "positive"
        ? `Charm ${pct}: la atracción hacia ${magDisp} se intensifica hacia el cierre (pin).`
        : `Charm ${pct}: un rompimiento puede acelerar hacia el cierre (gamma negativa).`;
    if (flow.vannaIfVolDrops !== "lateral") {
      vannaNote = `Vanna: si la IV baja, añade sesgo ${flow.vannaIfVolDrops}.`;
    }
  }

  const headline =
    `Ahora ${spot.toFixed(2)} → en ~${horizonMinutes} min, probablemente entre ${nfPts(lo)} y ${nfPts(hi)}` +
    (magnet != null && lean !== "lateral" ? `, gravitando hacia ${nfPts(magnet)}` : "");

  return {
    spot, horizonMinutes, sigma, rangeLow: lo, rangeHigh: hi, magnet,
    regime: gex.regime, lean, headline, detail, confidence,
    charmIntensity: charmI, charmNote, vannaNote,
  };
}

export const CLOSING_WINDOW_MIN = 60;

export type ClosingPhase = "pending" | "live" | "final";

export interface ClosingForecast {
  phase: ClosingPhase;
  minutesLeft: number;
  spot: number;
  magnet: number | null;
  regime: "positive" | "negative";
  estimate: number;
  strike: number | null;
  rangeLow: number;
  rangeHigh: number;
  sigma: number;
  confidence: "baja" | "media" | "alta";
  note: string;
  fromDate?: string;
}

/** Pronóstico del strike de cierre a las 4:00pm ET. Solo activo 3-4pm. PURA. */
export function closingForecast(
  spot: number, iv: number | null, gex: ZeroDteGex, now: Date = new Date(), strikeStep = 5,
): ClosingForecast | null {
  if (!(spot > 0) || iv == null || !(iv > 0)) return null;

  const minutesLeft = hoursToClose(now) * 60;
  if (minutesLeft <= 0 || minutesLeft > CLOSING_WINDOW_MIN) return null;

  const em = expectedMove(spot, iv, minutesLeft / 1440);
  const sigma = em.sigma;
  const reach = 2 * sigma;
  const magnet = gex.kingStrike;

  let estimate: number;
  if (gex.regime === "positive" && magnet != null) {
    estimate = Math.min(spot + reach, Math.max(spot - reach, magnet));
  } else {
    estimate = spot;
  }

  const strike = Math.round(estimate / strikeStep) * strikeStep;
  const rangeLow = Math.round((spot - sigma) / strikeStep) * strikeStep;
  const rangeHigh = Math.round((spot + sigma) / strikeStep) * strikeStep;

  let confidence: "baja" | "media" | "alta";
  if (gex.regime !== "positive" || magnet == null) confidence = "baja";
  else if (minutesLeft <= 15) confidence = "alta";
  else confidence = "media";

  const note =
    gex.regime === "positive" && magnet != null
      ? `Gamma positiva: los dealers tienden a anclar el cierre cerca de ${nfPts(magnet)}. Quedan ${minutesLeft.toFixed(0)} min y el margen de movimiento es +/-${sigma.toFixed(1)} pts.`
      : `Gamma negativa: sin efecto de anclaje fiable. El mejor estimado es el precio actual; un rompimiento puede alejarlo.`;

  return {
    phase: "live", minutesLeft, spot, magnet, regime: gex.regime, estimate, strike,
    rangeLow, rangeHigh, sigma, confidence, note,
  };
}

export type ScenarioKind = "bear" | "base" | "bull";

export interface ZeroDteScenario {
  kind: ScenarioKind;
  target: number;
  changePct: number;
  probTouch: number;
  reason: string;
}

export interface ZeroDteForecast {
  spot: number;
  iv: number;
  hoursToClose: number;
  sigma: number;
  sigmaPct: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  scenarios: ZeroDteScenario[];
  calibShiftPct: number;
  caveat: string | null;
}

/** Parámetros del lazo de auto-corrección. */
export const CALIBRATION = { minSamples: 5, gain: 0.6, capPct: 3 };

/** Cuánto (en %) corregir el objetivo central según el sesgo histórico. PURA. */
export function calibrationShiftPct(
  biasPct: number | null, samples: number, cfg = CALIBRATION,
): number {
  if (biasPct == null || samples < cfg.minSamples) return 0;
  return Math.max(-cfg.capPct, Math.min(cfg.capPct, biasPct * cfg.gain));
}

/** Tres escenarios para lo que queda de sesión. PURA. */
export function buildForecast(
  spot: number, iv: number | null, lines: ChainLine[], now: Date = new Date(), calibShiftPct = 0,
): ZeroDteForecast | null {
  if (!(spot > 0) || iv == null || !(iv > 0)) return null;

  const hrs = hoursToClose(now);
  const days = hrs / 24;
  const em = expectedMove(spot, iv, days);
  const sigma = em.sigma;
  const upper1 = em.upper1, lower1 = em.lower1;
  const upper2 = em.upper2, lower2 = em.lower2;
  const clamp = (v: number) => Math.min(upper2, Math.max(lower2, v));

  const weighted = lines
    .map((l) => {
      const volume = (l.call?.volume ?? 0) + (l.put?.volume ?? 0);
      const touch = probTouch(spot, l.strike, iv, days);
      return { strike: l.strike, volume, touch, weight: volume * touch };
    })
    .filter((w) => w.volume > 0)
    .sort((a, b) => b.weight - a.weight);

  const top = weighted[0];
  const base = top ? clamp(top.strike + (spot * calibShiftPct) / 100) : spot;
  const minGap = Math.max(sigma * 0.5, spot * 0.001);

  const above = weighted.filter((w) => w.strike >= base + minGap);
  const below = weighted.filter((w) => w.strike <= base - minGap);

  const bullRaw = above.length ? above[0].strike : upper1;
  const bearRaw = below.length ? below[0].strike : lower1;
  const bull = Math.max(clamp(bullRaw), base);
  const bear = Math.min(clamp(bearRaw), base);

  const mk = (kind: ScenarioKind, target: number, reason: string): ZeroDteScenario => ({
    kind, target, changePct: ((target - spot) / spot) * 100,
    probTouch: probTouch(spot, target, iv, days), reason,
  });

  const volTxt = top ? `${top.volume.toLocaleString("en-US")} contratos` : "sin volumen";

  let caveat: string | null = null;
  if (hrs <= 0) caveat = "Sesión cerrada: el vencimiento de hoy ya expiró.";
  else if (hrs < 0.5) caveat = "Menos de 30 minutos para el cierre: el modelo pierde sentido.";
  else if (!top) caveat = "Sin volumen suficiente en la cadena.";

  return {
    spot, iv, hoursToClose: hrs, sigma, sigmaPct: em.sigmaPct,
    upper1, lower1, upper2, lower2, calibShiftPct, caveat,
    scenarios: [
      mk("bear", bear, below.length
        ? `Zona de atracción por debajo (${below[0].volume.toLocaleString("en-US")} contratos)`
        : "Banda inferior de 1σ — no hay muro relevante debajo"),
      mk("base", base, top
        ? `Strike de mayor atracción: ${top.strike} (${volTxt})${calibShiftPct !== 0 ? ` · ajustado ${calibShiftPct > 0 ? "+" : ""}${calibShiftPct.toFixed(2)}% por sesgo histórico` : ""}`
        : "Sin imán identificable"),
      mk("bull", bull, above.length
        ? `Zona de atracción por encima (${above[0].volume.toLocaleString("en-US")} contratos)`
        : "Banda superior de 1σ — no hay muro relevante encima"),
    ],
  };
}

export interface ZeroDteResult {
  ticker: string;
  expiration: string;
  /** true si el vencimiento pedido es el de hoy (0DTE). */
  isToday: boolean;
  spot: number | null;
  delayed: boolean;
  contractCount: number;
  realtimeStrikes: number;
  realtimeAgeSec: number | null;
  lines: ChainLine[];
  summary: ChainSummary;
  forecast: ZeroDteForecast | null;
  outlook: ShortTermOutlook | null;
  dealerFlow: DealerFlow | null;
  closing: ClosingForecast | null;
  gex: ZeroDteGex;
  entry: EntryDecision | null;
  entryRR: number | null;
  noSetup: string | null;
  suggestions: ZeroDteSuggestions | null;
  asOf: string;
}

/**
 * Descarga la cadena de UN vencimiento (por defecto hoy) y devuelve la tabla
 * ya ordenada, con GEX, panorama y escenarios. Solo SPX.
 */
export async function fetchZeroDte(
  ticker: string, now: Date = new Date(), targetDate?: string, calibShiftPct = 0,
): Promise<ZeroDteResult> {
  const symbol = toSchwabSymbol(ticker);
  const today = etDate(now);
  const day = targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : today;
  const isToday = day === today;

  const parsed = await fetchZeroDteChain(symbol, day);

  // Superpone la foto EN TIEMPO REAL de MarketSnack sobre la cadena de Schwab
  // (que llega con retraso). Solo para el vencimiento de hoy.
  let rows = parsed.rows;
  let realtimeStrikes = 0;
  let realtimeAgeSec: number | null = null;
  let netAggressorSign = 0;
  if (isToday) {
    const acc = await loadFlow(ticker, day).catch(() => null);
    const ov = overlayRealtime(parsed.rows, acc);
    rows = ov.rows;
    realtimeStrikes = ov.realtimeStrikes;
    if (ov.newestTs > 0) realtimeAgeSec = Math.max(0, Math.round((now.getTime() - ov.newestTs) / 1000));
    if (acc) {
      const totals = netAggressorTotals(acc);
      if (totals.enough) netAggressorSign = Math.sign(totals.net);
    }
  }

  const lines = buildChainTable(rows);

  const spot = parsed.underlyingPrice;
  const iv = spot != null ? (atmIV(rows, spot) ?? chainIV(rows, spot)) : null;
  const gex = zeroDteGex(rows, spot ?? 0);
  const flow = dealerFlow(rows, spot ?? 0, iv, hoursToClose(now));

  const entry = isToday && spot != null
    ? evaluateEntry(spot, gex.regime, gex.kingStrike, gex.flipStrike)
    : null;

  const suggestions = isToday && spot != null
    ? buildSuggestions(rows, spot, iv, hoursToClose(now), entry, netAggressorSign)
    : null;

  return {
    ticker: ticker.toUpperCase(),
    expiration: day,
    isToday,
    spot: parsed.underlyingPrice,
    delayed: parsed.delayed,
    contractCount: rows.length,
    realtimeStrikes,
    realtimeAgeSec,
    lines,
    summary: summarize(rows),
    forecast: isToday ? buildForecast(spot ?? 0, iv, lines, now, calibShiftPct) : null,
    outlook: isToday ? shortTermOutlook(spot ?? 0, iv, gex, 5, flow) : null,
    dealerFlow: isToday ? flow : null,
    closing: isToday ? closingForecast(spot ?? 0, iv, gex, now) : null,
    gex,
    entry,
    entryRR: entry ? riskReward(entry) : null,
    noSetup: isToday && !entry && spot != null ? noSetupReason(spot, gex.regime, gex.kingStrike) : null,
    suggestions,
    asOf: now.toISOString(),
  };
}
