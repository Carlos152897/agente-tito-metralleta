// Carga completa de VisionFutura (Prueba de Fuego): junta todos los fetch
// (MarketSnack, tastytrade) y arma el reporte con lib/visionFutura.ts, para el
// instrumento (SPX / NQ / TSLA, ver lib/visionFuturaInstruments.ts) y el
// vencimiento elegidos. Vive en lib/ (no en la ruta) para que la ruta y
// cualquier script la usen igual. Imports relativos a propósito.

import { buildVisionFutura, yearsToExpiry, type VisionFuturaReport, type VixReading } from "./visionFutura";
import { fetchAssetPrice, fetchAssetPriceChart, fetchContractTradeSummary, fetchGexStats, fetchOptionChainExtended } from "./marketsnack";
import {
  fetchActiveFuture, fetchFuturesQuote, fetchMacroQuote, fetchNestedOptionChain, fetchOptionQuotesByType, fetchUnderlyingQuote,
  type NestedChainExpiration,
} from "./tastytrade";
import { buildSpreads, type SpreadQuoteRow, type SpreadsReport } from "./visionFuturaSpreads";
import type { NightConfirm } from "./visionFuturaAlerts";
import {
  instrumentOf, labelsOf, scaleFor, strikeStepNear,
  type InstrumentConfig, type InstrumentId, type InstrumentLabels,
} from "./visionFuturaInstruments";
import { isMarketOpen } from "./marketHours";
import { marketDateStr } from "./occ";
import type { ExtendedChainContract, GexStatsBucket } from "./spxLevels";
import { loadNightVisionFutura, nightGexStats } from "./visionFuturaNight";
import { fetchYahooCandles, fetchYahooQuote } from "./yahooCandles";
import type { ZRow } from "./zerodteTypes";
import { captureChainsForReplay } from "./visionFuturaReplay";
import { captureMsDay, loadMsDay, type MsDay, type MsPressureSnap } from "./visionFuturaMsStore";
import { withSingleLeg } from "./visionFuturaLegs";
import { unusualExits, type DotExit } from "./visionFuturaUnusualExit";
import { backingOf, multiExpGex, MULTI_EXP_TUNING } from "./visionFuturaMultiExp";
import { etfGexToIndex } from "./visionFuturaFlowMagnets";
import { computeStrikeGex } from "./spxLevels";

// Cadenas de los vencimientos siguientes (para el GEX de varios vencimientos): cambian despacio, 5 min.
const chainCache = new Map<string, { at: number; c: ExtendedChainContract[] }>();
async function cachedChain(ticker: string, exp: string): Promise<ExtendedChainContract[]> {
  const k = `${ticker}|${exp}`;
  const hit = chainCache.get(k);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.c;
  const c = await fetchOptionChainExtended(ticker, exp).catch(() => [] as ExtendedChainContract[]);
  chainCache.set(k, { at: Date.now(), c });
  return c;
}

// Cadena del vencimiento mostrado: si MarketSnack falló (p. ej. 500 tras 15 s), no se le vuelve a
// esperar en 60 s — mientras, el respaldo de tastytrade + trade_summaries.
const chainFailUntil = new Map<string, number>();
async function mainChain(ticker: string, exp: string): Promise<ExtendedChainContract[]> {
  const k = `${ticker}|${exp}`;
  if (Date.now() < (chainFailUntil.get(k) ?? 0)) return [];
  const c = await fetchOptionChainExtended(ticker, exp).catch(() => [] as ExtendedChainContract[]);
  if (c.length === 0) chainFailUntil.set(k, Date.now() + 60_000);
  else chainFailUntil.delete(k);
  return c;
}

export class VisionFuturaError extends Error {}

export interface ExpirationChip {
  date: string;
  /** 0 = el más próximo (0DTE en horario), 1 = el siguiente… */
  dte: number;
}

export interface VisionFuturaPayload extends VisionFuturaReport {
  /** Cotizaciones de tastytrade del vencimiento (uso interno del ciclo: lottos). No se envían al navegador. */
  optionQuotes?: SpreadQuoteRow[];
  instrument: InstrumentId;
  labels: InstrumentLabels;
  /** Escala de los umbrales en puntos (1 = SPX). */
  scale: number;
  strikeStep: number;
  expirations: ExpirationChip[];
  asOf: string;
  gexAsOf: string | null;
  marketOpen: boolean;
  expiration: string;
  /** Símbolo del futuro equivalente (/ESZ6, /NQZ6) o null. */
  esSymbol: string | null;
  /** Solo NQ: GEX neto por strike calculado con la cadena de QQQ y pasado a strikes del NDX (Imán GEX × lado). */
  etfGex?: { strike: number; netGex: number }[];
  /** Ventana visible en puntos del instrumento (ya escalada). */
  radius: number;
  priceSeries: { time: number; value: number }[];
  /** La gráfica del día sale del ETF convertido (MarketSnack no tiene la del índice). */
  priceSeriesApprox: boolean;
  history: { time: number; magnet: number; callWall: number; putWall: number; gammaFlip: number | null; maxPain: number }[];
  vixMagnet: number | null;
  /** Mini gráfica del VIX bajo el precio: VIX real del día (5 min de MarketSnack + último en vivo), siempre VIX aunque el instrumento sea NQ/TSLA. */
  vixSeries: { time: number; value: number }[];
  /** Cierre anterior del VIX (línea de referencia de la mini gráfica). */
  vixPrevClose: number | null;
  /** Historial del Magneto VIX (buckets de 5 min, solo SPX). */
  vixMagnetSeries: { time: number; value: number }[];
  /** 🌙 Modo noche: agresor del futuro (velas de 1 min) y /VX para las alertas. */
  nightConfirm?: NightConfirm | null;
  /** 🌙 Modo noche: velas de 1 min recientes (máx/mín reales para la ventana de 15 min de las alertas). */
  nightBars?: { time: number; high: number; low: number; close: number }[];
  /**
   * Datos de la terminal de MarketSnack del vencimiento (presión una pata vs spreads, prima por
   * minuto, inusuales) — guardados cada día en data/vision-futura/marketsnack (lib/visionFuturaMsStore.ts).
   * null si MarketSnack no los dio o no es el vencimiento más próximo.
   */
  marketSnack?: {
    pressure: MsPressureSnap | null;
    premium: MsDay["premium"];
    unusual: MsDay["unusual"];
    /** Inusuales que (estimado) ya salieron, por id (lib/visionFuturaUnusualExit.ts). */
    unusualExits?: Record<number, DotExit>;
  } | null;
  /**
   * Respaldos en uso en esta carga (Carlos, 2-nov-2026: "siempre que haya un fallo quiero que siempre
   * haya respaldo"). Vacío = todo salió de la fuente normal.
   */
  backups: string[];
  /** Sección "Spreads": ideas de crédito/débito/iron condor con cotización real de tastytrade. */
  spreads: SpreadsReport | null;
  spreadsError: string | null;
}

// La cadena anidada (qué símbolos y vencimientos existen) cambia poco: se cachea 30 min por subyacente.
const nestedCache = new Map<string, { at: number; exps: NestedChainExpiration[] }>();
export async function nestedFor(symbol: string): Promise<NestedChainExpiration[]> {
  const c = nestedCache.get(symbol);
  if (c && Date.now() - c.at < 30 * 60_000) return c.exps;
  const exps = await fetchNestedOptionChain(symbol);
  nestedCache.set(symbol, { at: Date.now(), exps });
  return exps;
}

/** Cotizaciones reales (bid/ask/delta/IV) de un vencimiento, a ±`range` pts del precio. */
export async function spreadQuotes(chainSymbol: string, expiration: string, spot: number, range: number): Promise<SpreadQuoteRow[]> {
  const exp = (await nestedFor(chainSymbol)).find((e) => e["expiration-date"] === expiration);
  if (!exp) return [];
  const strikes = exp.strikes.filter((s) => Math.abs(Number(s["strike-price"]) - spot) <= range);
  const quotes = await fetchOptionQuotesByType(strikes.flatMap((s) => [s.call, s.put]).filter(Boolean));
  const n = (v: string | number | undefined | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const rows: SpreadQuoteRow[] = [];
  for (const s of strikes) {
    const strike = Number(s["strike-price"]);
    for (const [type, sym] of [["call", s.call], ["put", s.put]] as const) {
      const q = quotes.get(sym);
      if (!q) continue;
      const bid = n(q.bid), ask = n(q.ask);
      rows.push({
        type, strike,
        bid: bid != null && bid > 0 ? bid : null,
        ask: ask != null && ask > 0 ? ask : null,
        delta: n(q.delta), iv: n(q.volatility),
        openInterest: n(q["open-interest"]) ?? 0, volume: n(q.volume) ?? 0,
      });
    }
  }
  return rows;
}

/**
 * Vencimientos para los botones: los 6 más próximos (0DTE … 5DTE). Con el
 * mercado ya cerrado (4 pm NY en adelante), el de hoy no cuenta; antes de la
 * apertura (pre-mercado, 9:00–9:30 incluido) sí.
 */
async function expirationsFor(cfg: InstrumentConfig, now: Date): Promise<ExpirationChip[]> {
  const today = marketDateStr(now);
  const hourNy = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now));
  const includeToday = isMarketOpen(now) || hourNy < 16;
  const dates = [...new Set((await nestedFor(cfg.tastyChain)).map((e) => e["expiration-date"]))]
    .filter((d) => (includeToday ? d >= today : d > today))
    .sort()
    .slice(0, 6);
  return dates.map((date, dte) => ({ date, dte }));
}

/** Vencimiento más próximo desde `date` (incluido): el 0DTE de la sesión `date` si existe. */
export async function nearestExpirationFrom(instrument: string, date: string): Promise<string | null> {
  const cfg = instrumentOf(instrument);
  const dates = [...new Set((await nestedFor(cfg.tastyChain)).map((e) => e["expiration-date"]))].filter((d) => d >= date).sort();
  return dates[0] ?? null;
}

async function futureQuote(product: string): Promise<{ symbol: string; price: number } | null> {
  const active = await fetchActiveFuture(product);
  if (!active) return null;
  const price = await fetchFuturesQuote(active.symbol);
  return price != null ? { symbol: active.symbol, price } : null;
}

/**
 * RESPALDO de la cadena de MarketSnack: cotizaciones reales de tastytrade (OI, volumen, griegos,
 * bid/ask) del vencimiento a ±`range` del precio. Sin flujo al bid/ask (compras/ventas en 0).
 */
async function tastyChainContracts(chainSymbol: string, expiration: string, spot: number, range: number): Promise<ExtendedChainContract[]> {
  const exp = (await nestedFor(chainSymbol)).find((e) => e["expiration-date"] === expiration);
  if (!exp) return [];
  const strikes = exp.strikes.filter((s) => Math.abs(Number(s["strike-price"]) - spot) <= range);
  const quotes = await fetchOptionQuotesByType(strikes.flatMap((s) => [s.call, s.put]).filter(Boolean));
  const n = (v: string | number | undefined | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const out: ExtendedChainContract[] = [];
  for (const s of strikes) {
    const strike = Number(s["strike-price"]);
    for (const [type, sym] of [["call", s.call], ["put", s.put]] as const) {
      const q = sym ? quotes.get(sym) : undefined;
      if (!q) continue;
      const bid = n(q.bid), ask = n(q.ask);
      const mid = bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
      out.push({
        symbol: sym, strike, type, expiration,
        open_interest: n(q["open-interest"]) ?? 0, volume: n(q.volume) ?? 0, price: mid,
        greeks: { delta: n(q.delta) ?? 0, gamma: n(q.gamma) ?? 0, theta: n(q.theta) ?? 0, vega: n(q.vega) ?? 0 },
        implied_volatility: n(q.volatility),
        premium_breakdown: { bid: 0, mid: 0, ask: 0 },
      });
    }
  }
  return out;
}

/**
 * RESPALDO del flujo (2026-11-05: la cadena de SPX 0DTE de MarketSnack daba 500 y el posicionamiento
 * salía vacío): prima al ask / al bid del día por contrato con `trade_summaries` de MarketSnack, solo
 * para los strikes a ±`win` del precio. Cache 60 s por contrato. Devuelve cuántos contratos se llenaron.
 */
const summaryCache = new Map<string, { at: number; ask: number; bid: number }>();
async function fillFlowFromSummaries(contracts: ExtendedChainContract[], spot: number, win: number): Promise<number> {
  const todo = contracts.filter((c) => c.symbol && Math.abs(c.strike - spot) <= win).slice(0, 160);
  let filled = 0;
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (c) => {
      const occ = c.symbol.replace(/\s+/g, "");
      let hit = summaryCache.get(occ);
      if (!hit || Date.now() - hit.at > 60_000) {
        const b = await fetchContractTradeSummary(occ).catch(() => null);
        if (!b) return;
        hit = { at: Date.now(), ask: b.reduce((s, x) => s + (x.ask_premium || 0), 0), bid: b.reduce((s, x) => s + (x.bid_premium || 0), 0) };
        summaryCache.set(occ, hit);
      }
      c.premium_breakdown = { bid: hit.bid, mid: 0, ask: hit.ask };
      if (hit.ask > 0 || hit.bid > 0) filled++;
    }));
  }
  return filled;
}

/** RESPALDO del GEX de MarketSnack: niveles propios con gamma × OI de la cadena (mismo método del modo noche). */
function ownGexBucket(contracts: ExtendedChainContract[], spot: number, now: Date): GexStatsBucket | null {
  const rows: ZRow[] = contracts.map((c) => ({
    optionTicker: c.symbol, contractType: c.type, expiration: c.expiration, strike: c.strike,
    openInterest: c.open_interest, volume: c.volume,
    bid: c.premium_breakdown.bid || null, ask: c.premium_breakdown.ask || null,
    greeks: { delta: c.greeks.delta, gamma: c.greeks.gamma, theta: c.greeks.theta, vega: c.greeks.vega, iv: c.implied_volatility },
  }));
  return nightGexStats(rows, spot, now);
}

/** Apertura de la sesión regular de hoy (9:30 NY) en ms. */
function todayOpenMs(now: Date): number {
  const date = marketDateStr(now);
  const guess = Date.parse(`${date}T13:30:00Z`);
  const hm = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(guess));
  return hm === "09:30" ? guess : guess + 3_600_000;
}

/** IV ATM: promedio de la IV de call y put de los 2 strikes más cercanos al precio. */
function atmIvOf(contracts: ExtendedChainContract[], spot: number): number | null {
  const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 2);
  const ivs = contracts
    .filter((c) => strikes.includes(c.strike) && c.implied_volatility != null && c.implied_volatility > 0.02 && c.implied_volatility < 3)
    .map((c) => c.implied_volatility!);
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

const snap = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);
/** Botón de ventana de SPX (±30/±60/±120) → strikes por lado para el resto de los instrumentos. */
export const strikesPerSide = (radius: number) => (radius <= 30 ? 10 : radius <= 60 ? 20 : 30);

export async function loadVisionFutura(
  now: Date,
  radius = 60,
  instrument: string = "SPX",
  expIndex = 0,
): Promise<VisionFuturaPayload> {
  const cfg = instrumentOf(instrument);
  // 🌙 /ES y /NQ de noche: todo sale de las opciones de CME en tastytrade (lib/visionFuturaNight.ts).
  if (cfg.night) {
    try {
      return await loadNightVisionFutura(cfg, now, radius, expIndex);
    } catch (e) {
      throw new VisionFuturaError(e instanceof Error ? e.message : `No se pudo cargar ${cfg.label}.`);
    }
  }
  // En segundo plano: copia de las cadenas del día para la repetición (no bloquea la carga).
  void captureChainsForReplay(now).catch(() => {});
  const expirations = await expirationsFor(cfg, now).catch(() => [] as ExpirationChip[]);
  const expiration = expirations[Math.min(Math.max(0, expIndex), Math.max(0, expirations.length - 1))]?.date ?? marketDateStr(now);

  // ETF: el que se muestra (conversión) o el que solo arma la gráfica (NQ → QQQ, no se muestra).
  const etfSym = cfg.etf ?? cfg.chartEtf ?? null;
  const [spotMs, gexBuckets, contracts, etfPxRaw, futRaw, vixQuoteRaw, chartMain, chartEtf, vixGexBuckets, mainTasty, spxRefRaw, vixRefRaw, chartVix] = await Promise.all([
    fetchAssetPrice(cfg.msTicker).catch(() => null),
    fetchGexStats(cfg.msTicker, { period: "1d" }).catch(() => [] as GexStatsBucket[]),
    mainChain(cfg.msTicker, expiration),
    etfSym ? fetchUnderlyingQuote(etfSym, false).catch(() => null) : Promise.resolve(null),
    cfg.future ? futureQuote(cfg.future).catch(() => null) : Promise.resolve(null),
    cfg.volIndex ? fetchMacroQuote({ index: cfg.volIndex }).catch(() => null) : Promise.resolve(null),
    cfg.chartFromEtf ? Promise.resolve([]) : fetchAssetPriceChart(cfg.msTicker).catch(() => []),
    cfg.chartFromEtf && etfSym ? fetchAssetPriceChart(etfSym).catch(() => []) : Promise.resolve([]),
    cfg.volIndex ? fetchGexStats(cfg.volIndex, { period: "1d" }).catch(() => []) : Promise.resolve([]),
    fetchUnderlyingQuote(cfg.main, !!cfg.tastyMain.index).catch(() => null),
    // Referencias para la escala (solo fuera de SPX).
    cfg.id === "SPX" ? Promise.resolve(null) : fetchUnderlyingQuote("SPX", true).catch(() => null),
    cfg.id === "SPX" ? Promise.resolve(null) : fetchMacroQuote({ index: "VIX" }).catch(() => null),
    // Mini gráfica del VIX (siempre el VIX, para cualquier instrumento de día).
    fetchAssetPriceChart("VIX").catch(() => []),
  ]);

  // ── Respaldos: cada dato que falte se busca en otra fuente (MarketSnack ↔ tastytrade ↔ Yahoo). ──
  const backups: string[] = [];
  const yq = (sym: string) => fetchYahooQuote(sym).catch(() => null);
  let spot = (spotMs && spotMs > 0 ? spotMs : null) ?? (mainTasty && mainTasty > 0 ? mainTasty : null) ?? gexBuckets.at(-1)?.asset_price ?? null;
  if (!spot || spot <= 0) {
    spot = (await yq(cfg.main))?.last ?? null;
    if (spot) backups.push("Precio: Yahoo (MarketSnack y tastytrade no respondieron)");
  }
  if (!spot || spot <= 0) throw new VisionFuturaError(`Sin precio en vivo para ${cfg.main} (MarketSnack, tastytrade y Yahoo fallaron).`);

  if (contracts.length === 0) {
    const tc = await tastyChainContracts(cfg.tastyChain, expiration, spot, spot * 0.06).catch(() => [] as ExtendedChainContract[]);
    if (tc.length > 0) {
      contracts.push(...tc);
      // Compras/ventas por strike (posicionamiento, agresor, dealers): trade_summaries de MarketSnack
      // contrato por contrato — otro endpoint, sigue respondiendo cuando la cadena da 500.
      const step = strikeStepNear(tc.map((c) => c.strike), spot);
      const win = (cfg.id === "SPX" ? radius : strikesPerSide(radius) * step) + 2 * step;
      const filled = await fillFlowFromSummaries(contracts, spot, win).catch(() => 0);
      backups.push(filled > 0
        ? "Cadena de opciones: tastytrade (MarketSnack no respondió); compras/ventas por strike: MarketSnack contrato por contrato"
        : "Cadena de opciones: tastytrade (MarketSnack no respondió; sin compras/ventas por strike)");
    }
  }
  if (gexBuckets.length === 0 && contracts.length > 0) {
    const own = ownGexBucket(contracts, spot, now);
    if (own) {
      gexBuckets.push(own);
      backups.push("GEX / niveles: cálculo propio gamma × OI (MarketSnack no respondió)");
    }
  }

  // MarketSnack a veces deja `gamma_flip` en null en el bucket más reciente — se usa el último real.
  const latestBucket = gexBuckets.at(-1) ?? null;
  const lastFlip = [...gexBuckets].reverse().find((b) => b.gamma_flip != null)?.gamma_flip ?? null;
  const gexStats = latestBucket ? { ...latestBucket, gamma_flip: latestBucket.gamma_flip ?? lastFlip } : null;

  let etfPx = etfPxRaw;
  if (etfSym && !(etfPx && etfPx > 0)) {
    etfPx = (await yq(etfSym))?.last ?? null;
    if (etfPx) backups.push(`${etfSym}: Yahoo`);
  }
  let fut = futRaw;
  if (cfg.future && !fut) {
    const q = await yq(`/${cfg.future}`);
    if (q) {
      fut = { symbol: `/${cfg.future}`, price: q.last };
      backups.push(`/${cfg.future}: Yahoo (contrato continuo)`);
    }
  }
  let vixQuote = vixQuoteRaw;
  if (cfg.volIndex && !vixQuote) {
    const q = await yq(cfg.volIndex);
    if (q) {
      vixQuote = { symbol: cfg.volIndex, last: q.last, prevClose: q.prevClose, dayHigh: null, dayLow: null };
      backups.push(`${cfg.volIndex}: Yahoo`);
    }
  }
  const spxRef = spxRefRaw ?? (cfg.id === "SPX" ? null : (await yq("SPX"))?.last ?? null);
  let vixRef = vixRefRaw;
  if (cfg.id !== "SPX" && !vixRef) {
    const q = await yq("VIX");
    if (q) vixRef = { symbol: "VIX", last: q.last, prevClose: q.prevClose, dayHigh: null, dayLow: null };
  }

  const atmIv = atmIvOf(contracts, spot);
  const scale = scaleFor(cfg, spot, { spxSpot: spxRef, vix: vixRef?.last ?? null, atmIv });
  const strikeStep = strikeStepNear(contracts.map((c) => c.strike), spot);
  // Ventana visible fuera de SPX: los botones ±30/±60/±120 de SPX equivalen a 10/20/30 strikes por lado.
  const effRadius = cfg.id === "SPX" ? radius : strikesPerSide(radius) * strikeStep;

  // Volatilidad: VIX para SPX; IV ATM de la propia cadena para el resto (sin % del día).
  const vix: VixReading | null = vixQuote
    ? { last: vixQuote.last, prevClose: vixQuote.prevClose, changePct: ((vixQuote.last - vixQuote.prevClose) / vixQuote.prevClose) * 100 }
    : !cfg.volIndex && atmIv
      ? { last: Math.round(atmIv * 10_000) / 100, prevClose: Math.round(atmIv * 10_000) / 100, changePct: 0 }
      : null;

  const report = buildVisionFutura({
    contracts, spot, gexStats,
    spy: cfg.etf ? etfPx : null, es: fut?.price ?? null, vix, radius: effRadius, strikeStep,
    yearsToExpiry: yearsToExpiry(expiration, now),
  });

  // Gráfica del día: la del propio instrumento (5 min de MarketSnack) o, si no existe
  // (NDX), la del ETF × (precio / ETF ahora) — aproximada y marcada. + el último spot.
  const toSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  let priceSeriesApprox = false;
  let rawPrice: { time: number; value: number }[];
  if (cfg.chartFromEtf && etfPx && etfPx > 0 && chartEtf.length > 0) {
    const ratio = spot / etfPx;
    rawPrice = chartEtf.map((p) => ({ time: toSec(p.t), value: p.v * ratio }));
    priceSeriesApprox = true;
  } else {
    rawPrice = chartMain.length > 0
      ? chartMain.map((p) => ({ time: toSec(p.t), value: p.v }))
      : gexBuckets.map((b) => ({ time: toSec(b.t), value: b.asset_price }));
  }
  if (rawPrice.length < 2) {
    const open = todayOpenMs(now);
    const bars = open <= now.getTime() ? await fetchYahooCandles(cfg.main, open, open + 390 * 60_000).catch(() => []) : [];
    if (bars.length > 0) {
      rawPrice = bars.map((b) => ({ time: b.time, value: b.close }));
      priceSeriesApprox = false;
      backups.push("Gráfica del día: Yahoo (MarketSnack no respondió)");
    }
  }
  // El /chart de un ETF trae también el pre/post-market de varios días: solo la última sesión.
  const lastDay = marketDateStr(new Date((rawPrice.at(-1)?.time ?? 0) * 1000));
  const priceSeries = rawPrice
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && p.value > 0)
    .filter((p) => !priceSeriesApprox || marketDateStr(new Date(p.time * 1000)) === lastDay)
    .sort((a, b) => a.time - b.time);
  const nowSec = Math.floor(now.getTime() / 1000);
  const last = priceSeries.at(-1);
  if (isMarketOpen(now) && (!last || nowSec - last.time > 30)) priceSeries.push({ time: nowSec, value: spot });
  // Mini VIX: misma sesión que el precio + el último VIX en vivo con mercado abierto.
  const vixLast = cfg.volIndex === "VIX" ? vixQuote : vixRef;
  let vixChart = chartVix;
  if (vixChart.length === 0) {
    const open = todayOpenMs(now);
    const bars = open <= now.getTime() ? await fetchYahooCandles("VIX", open, open + 390 * 60_000).catch(() => []) : [];
    vixChart = bars.map((b) => ({ t: new Date(b.time * 1000).toISOString(), v: b.close }));
    if (bars.length > 0) backups.push("Mini gráfica VIX: Yahoo");
  }
  const vixSeries = vixChart
    .map((p) => ({ time: toSec(p.t), value: p.v }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && p.value > 0 && marketDateStr(new Date(p.time * 1000)) === lastDay)
    .sort((a, b) => a.time - b.time);
  if (isMarketOpen(now) && vixLast && vixLast.last > 0 && (!vixSeries.at(-1) || nowSec - vixSeries.at(-1)!.time > 30)) {
    vixSeries.push({ time: nowSec, value: vixLast.last });
  }
  const vixMagnetSeries = cfg.volIndex === "VIX"
    ? vixGexBuckets
      .map((b) => ({ time: toSec(b.t), value: b.magnet }))
      .filter((h) => Number.isFinite(h.time) && Number.isFinite(h.value) && h.value > 0)
      .sort((a, b) => a.time - b.time)
    : [];
  const history = gexBuckets
    .map((b) => ({
      time: toSec(b.t),
      magnet: b.magnet, callWall: b.call_wall, putWall: b.put_wall,
      gammaFlip: b.gamma_flip, maxPain: b.max_pain,
    }))
    .filter((h) => Number.isFinite(h.time))
    .sort((a, b) => a.time - b.time);

  // Spreads (no rompen la pestaña si tastytrade falla). Anchos ≈ 5 y 10 pts de SPX escalados al paso de strike.
  let spreads: SpreadsReport | null = null;
  let spreadsError: string | null = null;
  let optionQuotes: SpreadQuoteRow[] = [];
  try {
    const rows = await spreadQuotes(cfg.tastyChain, expiration, spot, 80 * scale);
    optionQuotes = rows;
    const widths = cfg.id === "SPX" ? [5, 10] : [...new Set([snap(5 * scale, strikeStep), snap(10 * scale, strikeStep)])];
    spreads = rows.length === 0 ? null : buildSpreads({
      rows, spot,
      days: yearsToExpiry(expiration, now) * 365,
      keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, expectedMove: report.expectedMove,
      fallbackIv: vix ? vix.last / 100 : 0.18,
      scale, widths,
    });
    if (rows.length === 0) spreadsError = `tastytrade no tiene cotizaciones de ${cfg.main} para el vencimiento ${expiration}.`;
  } catch (e) {
    spreadsError = e instanceof Error ? e.message : "No se pudieron leer las cotizaciones de tastytrade.";
  }

  // Terminal de MarketSnack: con mercado abierto se pide (máx 1/min) y se guarda; cerrado, lo guardado de hoy.
  let msDay: MsDay | null = null;
  if (expIndex === 0) {
    msDay = isMarketOpen(now)
      ? await captureMsDay({ inst: cfg.id, msTicker: cfg.msTicker, expiration, spot, now })
      : loadMsDay(cfg.id, marketDateStr(now));
    if (msDay && msDay.expiration !== expiration) msDay = null;
  }
  // GEX de los vencimientos siguientes por strike (lib/visionFuturaMultiExp.ts): `multiExp` y `backing`.
  if (expIndex === 0 && expirations.length > 1) {
    const next = expirations.slice(1, 1 + MULTI_EXP_TUNING.nextCount).map((e) => e.date);
    const chains = await Promise.all(next.map(async (exp) => ({ expiration: exp, contracts: await cachedChain(cfg.msTicker, exp) })));
    const by = multiExpGex(chains.filter((c) => c.contracts.length), spot, report.rows.map((r) => r.spx));
    report.rows = report.rows.map((r) => {
      const me = by.get(r.spx);
      return me ? { ...r, multiExp: me, backing: backingOf(r.netGex, me) } : r;
    });
  }
  // NQ: GEX con la cadena de QQQ (las NDXP casi no tienen OI de calls) para el Imán GEX × lado.
  let etfGex: { strike: number; netGex: number }[] | undefined;
  if (cfg.id === "NQ" && cfg.chartEtf && etfPx && etfPx > 0) {
    const qc = await cachedChain(cfg.chartEtf, expiration);
    if (qc.length) etfGex = etfGexToIndex(computeStrikeGex(qc, etfPx), spot / etfPx, report.rows.map((r) => r.spx));
  }
  // Una pata vs spreads por strike (lib/visionFuturaLegs.ts): campo `legs` en cada fila con datos.
  const lastPressure = msDay?.pressure.at(-1);
  if (lastPressure?.rows.length) report.rows = withSingleLeg(report.rows, lastPressure.rows, spot);

  return {
    instrument: cfg.id,
    labels: labelsOf(cfg, fut?.symbol ?? null),
    scale,
    strikeStep,
    expirations,
    marketSnack: msDay
      ? {
          pressure: msDay.pressure.at(-1) ?? null, premium: msDay.premium, unusual: msDay.unusual,
          unusualExits: unusualExits(msDay.unusual, Object.fromEntries(Object.entries(msDay.contractFlow ?? {}).map(([k, v]) => [k, v.buckets])), now.getTime()),
        }
      : null,
    spreads,
    spreadsError,
    optionQuotes,
    etfGex,
    backups,
    asOf: now.toISOString(),
    gexAsOf: gexStats?.t ?? null,
    marketOpen: isMarketOpen(now),
    expiration,
    esSymbol: fut?.symbol ?? null,
    radius: effRadius,
    priceSeries,
    priceSeriesApprox,
    history,
    // Magneto del VIX (gex_stats_chart de MarketSnack, ticker VIX) — solo SPX.
    vixMagnet: vixGexBuckets.at(-1)?.magnet ?? null,
    vixSeries,
    // Fuera de horario tastytrade ya "rueda" el cierre anterior (= cierre de hoy): no sirve de referencia.
    vixPrevClose: vixLast && (isMarketOpen(now) || Math.abs(vixLast.prevClose - vixLast.last) > 0.001) ? vixLast.prevClose : null,
    vixMagnetSeries,
    ...report,
  };
}
