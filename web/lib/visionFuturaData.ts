// Carga completa de VisionFutura (Prueba de Fuego): junta todos los fetch
// (MarketSnack, tastytrade) y arma el reporte con lib/visionFutura.ts. Vive
// en lib/ (no en la ruta) para que lo usen igual la ruta
// app/api/vision-futura y el poller de alertas por Telegram
// (scripts/vision-futura-alert/poll.ts) — mismo motor en los dos lados.
// Imports relativos a propósito: el poller corre con tsx, fuera de Next.

import { buildVisionFutura, yearsToExpiry, type VisionFuturaReport, type VixReading } from "./visionFutura";
import { fetchAssetPrice, fetchAssetPriceChart, fetchGexStats, fetchOptionChainExtended } from "./marketsnack";
import {
  fetchActiveFuture, fetchFuturesQuote, fetchMacroQuote, fetchNestedOptionChain, fetchOptionQuotesByType, fetchUnderlyingQuote,
  type NestedChainExpiration,
} from "./tastytrade";
import { buildSpreads, type SpreadQuoteRow, type SpreadsReport } from "./visionFuturaSpreads";
import { isMarketOpen } from "./marketHours";
import { marketDateStr } from "./occ";

export class VisionFuturaError extends Error {}

export interface VisionFuturaPayload extends VisionFuturaReport {
  asOf: string;
  gexAsOf: string | null;
  marketOpen: boolean;
  expiration: string;
  esSymbol: string | null;
  radius: number;
  priceSeries: { time: number; value: number }[];
  history: { time: number; magnet: number; callWall: number; putWall: number; gammaFlip: number | null; maxPain: number }[];
  vixMagnet: number | null;
  /** Sección "Spreads": ideas de crédito/débito/iron condor con cotización real de tastytrade. */
  spreads: SpreadsReport | null;
  spreadsError: string | null;
}

// La cadena anidada de SPX (qué símbolos existen) cambia poco: se cachea 30 min.
let nestedCache: { at: number; exps: NestedChainExpiration[] } | null = null;
async function spxNested(): Promise<NestedChainExpiration[]> {
  if (nestedCache && Date.now() - nestedCache.at < 30 * 60_000) return nestedCache.exps;
  const exps = await fetchNestedOptionChain("SPX");
  nestedCache = { at: Date.now(), exps };
  return exps;
}

/** Cotizaciones reales (bid/ask/delta/IV) de los SPXW de un vencimiento, a ±`range` pts del precio. */
async function spreadQuotes(expiration: string, spot: number, range = 80): Promise<SpreadQuoteRow[]> {
  const exp = (await spxNested()).find((e) => e["expiration-date"] === expiration);
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

const TICKER = "SPX";
const MAX_LOOKAHEAD_DAYS = 6;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function nearestChain(now: Date) {
  const today = marketDateStr(now);
  const startOffset = isMarketOpen(now) ? 0 : (() => {
    // Antes de la apertura el 0DTE de hoy sigue siendo el más próximo.
    const hourNy = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(now));
    return hourNy < 9 ? 0 : 1;
  })();
  for (let i = startOffset; i <= MAX_LOOKAHEAD_DAYS; i++) {
    const expiration = addDays(today, i);
    const contracts = await fetchOptionChainExtended(TICKER, expiration);
    if (contracts.length > 0) return { expiration, contracts };
  }
  return { expiration: today, contracts: [] };
}

async function fetchEs(): Promise<{ symbol: string; price: number } | null> {
  const active = await fetchActiveFuture("ES");
  if (!active) return null;
  const price = await fetchFuturesQuote(active.symbol);
  return price != null ? { symbol: active.symbol, price } : null;
}

export async function loadVisionFutura(now: Date, radius = 60): Promise<VisionFuturaPayload> {
  const [spotMs, gexBuckets, chain, spy, es, vixQuote, priceChart, vixGexBuckets] = await Promise.all([
    fetchAssetPrice(TICKER),
    fetchGexStats(TICKER, { period: "1d" }),
    nearestChain(now),
    fetchUnderlyingQuote("SPY", false).catch(() => null),
    fetchEs().catch(() => null),
    fetchMacroQuote({ index: "VIX" }).catch(() => null),
    fetchAssetPriceChart(TICKER).catch(() => []),
    fetchGexStats("VIX", { period: "1d" }).catch(() => []),
  ]);

  // MarketSnack a veces deja `gamma_flip` en null en el bucket más reciente
  // (visto en vivo 2026-10-22, el de 15:55 ET) — se usa el último flip real.
  const latestBucket = gexBuckets.at(-1) ?? null;
  const lastFlip = [...gexBuckets].reverse().find((b) => b.gamma_flip != null)?.gamma_flip ?? null;
  const gexStats = latestBucket ? { ...latestBucket, gamma_flip: latestBucket.gamma_flip ?? lastFlip } : null;
  const spot = spotMs && spotMs > 0 ? spotMs : gexStats?.asset_price ?? null;
  if (!spot || spot <= 0) throw new VisionFuturaError("Sin precio en vivo para SPX.");

  const vix: VixReading | null = vixQuote
    ? { last: vixQuote.last, prevClose: vixQuote.prevClose, changePct: ((vixQuote.last - vixQuote.prevClose) / vixQuote.prevClose) * 100 }
    : null;

  const report = buildVisionFutura({
    contracts: chain.contracts, spot, gexStats,
    spy, es: es?.price ?? null, vix, radius,
    yearsToExpiry: yearsToExpiry(chain.expiration, now),
  });

  // Para la gráfica: precio de hoy (MarketSnack, puntos de 5 min; si no
  // viene, el asset_price de cada bucket del GEX) + el último spot, y la
  // historia de Magneto / paredes / flip cada 5 min (gex_stats_chart).
  const toSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const rawPrice = priceChart.length > 0
    ? priceChart.map((p) => ({ time: toSec(p.t), value: p.v }))
    : gexBuckets.map((b) => ({ time: toSec(b.t), value: b.asset_price }));
  const priceSeries = rawPrice
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.time - b.time);
  const nowSec = Math.floor(now.getTime() / 1000);
  const last = priceSeries.at(-1);
  if (isMarketOpen(now) && (!last || nowSec - last.time > 30)) priceSeries.push({ time: nowSec, value: spot });
  const history = gexBuckets
    .map((b) => ({
      time: toSec(b.t),
      magnet: b.magnet, callWall: b.call_wall, putWall: b.put_wall,
      gammaFlip: b.gamma_flip, maxPain: b.max_pain,
    }))
    .filter((h) => Number.isFinite(h.time))
    .sort((a, b) => a.time - b.time);

  // Spreads (no rompen la pestaña si tastytrade falla).
  let spreads: SpreadsReport | null = null;
  let spreadsError: string | null = null;
  try {
    const rows = await spreadQuotes(chain.expiration, spot);
    spreads = rows.length === 0 ? null : buildSpreads({
      rows, spot,
      days: yearsToExpiry(chain.expiration, now) * 365,
      keyLevels: report.keyLevels, dealerLevels: report.dealerLevels, expectedMove: report.expectedMove,
      fallbackIv: vix ? vix.last / 100 : 0.18,
    });
    if (rows.length === 0) spreadsError = `tastytrade no tiene cotizaciones del vencimiento ${chain.expiration}.`;
  } catch (e) {
    spreadsError = e instanceof Error ? e.message : "No se pudieron leer las cotizaciones de tastytrade.";
  }

  return {
    spreads,
    spreadsError,
    asOf: now.toISOString(),
    gexAsOf: gexStats?.t ?? null,
    marketOpen: isMarketOpen(now),
    expiration: chain.expiration,
    esSymbol: es?.symbol ?? null,
    radius,
    priceSeries,
    history,
    // Magneto del VIX (mismo gex_stats_chart de MarketSnack, ticker VIX) —
    // solo se muestra debajo del recuadro del VIX, a pedido de Carlos.
    vixMagnet: vixGexBuckets.at(-1)?.magnet ?? null,
    ...report,
  };
}
