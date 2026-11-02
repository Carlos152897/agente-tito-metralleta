// Velas de 1 minuto de Yahoo Finance: RESPALDO de la gráfica de VisionFutura cuando el
// streaming DXLink de tastytrade no responde (2-nov-2026 su servidor devolvía 502 y la
// gráfica se quedaba sin velas). Sin clave. Yahoo guarda velas de 1 min de los últimos ~7 días.
// Solo servidor.

import { fetchFutureCandles, type Candle } from "./futuresCandles";

/** Símbolo de tastytrade/DXLink → símbolo de Yahoo. */
export function yahooSymbolFor(sym: string): string {
  const s = sym.toUpperCase();
  if (s === "SPX") return "^GSPC";
  if (s === "NDX") return "^NDX";
  if (s === "VIX") return "^VIX";
  if (s.startsWith("/ES")) return "ES=F";
  if (s.startsWith("/NQ")) return "NQ=F";
  return s;
}

const cache = new Map<string, { at: number; bars: Candle[] }>();

/** Velas de 1 min entre `fromMs` y `toMs`. Nunca lanza: [] si falla. */
export async function fetchYahooCandles(sym: string, fromMs: number, toMs: number, cacheMs = 15_000): Promise<Candle[]> {
  const ySym = yahooSymbolFor(sym);
  const key = `${ySym}|${fromMs}|${toMs}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < cacheMs) return c.bars;
  try {
    const params = new URLSearchParams({
      interval: "1m",
      period1: String(Math.floor(fromMs / 1000)),
      period2: String(Math.ceil(Math.min(toMs, Date.now()) / 1000)),
      includePrePost: "false",
    });
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?${params}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return c?.bars ?? [];
    const json = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] } }[] };
    };
    const r = json.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r?.timestamp || !q) return c?.bars ?? [];
    const bars: Candle[] = [];
    r.timestamp.forEach((t, i) => {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], cl = q.close?.[i];
      if (o == null || h == null || l == null || cl == null || !(cl > 0)) return;
      // La última "vela" de Yahoo trae la hora del último tick (ej. 15:04:29): se lleva al inicio del minuto.
      const time = Math.floor(t / 60) * 60;
      if (time * 1000 < fromMs || time * 1000 >= toMs) return;
      bars.push({ time, open: o, high: h, low: l, close: cl, volume: q.volume?.[i] ?? undefined });
    });
    const byTime = new Map(bars.map((b) => [b.time, b]));
    const out = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (out.length > 0) cache.set(key, { at: Date.now(), bars: out });
    return out.length > 0 ? out : c?.bars ?? [];
  } catch {
    return c?.bars ?? [];
  }
}

export interface YahooQuote { last: number; prevClose: number }
const quoteCache = new Map<string, { at: number; q: YahooQuote }>();

/** Último precio y cierre anterior (respaldo de precio en vivo). Nunca lanza: null si falla. */
export async function fetchYahooQuote(sym: string, cacheMs = 5_000): Promise<YahooQuote | null> {
  const ySym = yahooSymbolFor(sym);
  const c = quoteCache.get(ySym);
  if (c && Date.now() - c.at < cacheMs) return c.q;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return c?.q ?? null;
    const json = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] } };
    const m = json.chart?.result?.[0]?.meta;
    const last = m?.regularMarketPrice;
    const prevClose = m?.previousClose ?? m?.chartPreviousClose;
    if (!(last && last > 0) || !(prevClose && prevClose > 0)) return c?.q ?? null;
    const q = { last, prevClose };
    quoteCache.set(ySym, { at: Date.now(), q });
    return q;
  } catch {
    return c?.q ?? null;
  }
}

/**
 * Velas de 1 min de la sesión para CALIFICAR (backtest, en vivo, híbrido): tastytrade DXLink y,
 * si no da nada, Yahoo. Nunca lanza. `source` dice de dónde salieron.
 */
export async function fetchSessionMinutes(sym: string, openMs: number): Promise<{ bars: Candle[]; source: "tastytrade" | "yahoo" | null }> {
  const close = openMs + 390 * 60_000;
  const inSession = (b: Candle) => b.time * 1000 >= openMs && b.time * 1000 < close;
  const dx = (await fetchFutureCandles(sym, openMs, "1m", 12_000, 0).catch(() => [])).filter(inSession);
  if (dx.length > 0) return { bars: dx, source: "tastytrade" };
  const yb = (await fetchYahooCandles(sym, openMs, close, 0).catch(() => [])).filter(inSession);
  return { bars: yb, source: yb.length ? "yahoo" : null };
}

