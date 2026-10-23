// Velas intradía de futuros (/ES, /NQ) para la gráfica del modo noche de VisionFutura.
// tastytrade no tiene REST de velas: el historial sale de su streaming DXLink (mismo
// que usa scripts/tastytrade-candles/candle-streamer.mjs). Acá se abre una conexión
// CORTA: se piden las velas desde `fromMs`, se juntan hasta que dejan de llegar y se
// cierra. Cache de 60 s por símbolo para no reconectar en cada refresco.
// Solo servidor.

import { DXLinkWebSocketClient } from "@dxfeed/dxlink-websocket-client";
import { DXLinkFeed, FeedContract } from "@dxfeed/dxlink-feed";
import { fetchQuoteToken } from "./tastytrade";

export interface Candle {
  /** Segundos. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; bars: Candle[] }>();

/** Velas de `period` ("5m") de un símbolo de DXLink (ej. "/ESZ26:XCME") desde `fromMs`. Nunca lanza: [] si falla. */
export async function fetchFutureCandles(streamerSymbol: string, fromMs: number, period = "5m", timeoutMs = 8000): Promise<Candle[]> {
  const key = `${streamerSymbol}|${period}|${Math.floor(fromMs / 3_600_000)}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < CACHE_MS) return c.bars;
  try {
    const bars = await pull(streamerSymbol, fromMs, period, timeoutMs);
    if (bars.length > 0) cache.set(key, { at: Date.now(), bars });
    return bars.length > 0 ? bars : c?.bars ?? [];
  } catch {
    return c?.bars ?? [];
  }
}

async function pull(streamerSymbol: string, fromMs: number, period: string, timeoutMs: number): Promise<Candle[]> {
  // El cliente DXLink usa el WebSocket global (Node 22+ lo trae de serie).
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") return [];
  const { token, dxlinkUrl } = await fetchQuoteToken();
  const byTime = new Map<number, Candle>();
  const client = new DXLinkWebSocketClient();
  return new Promise<Candle[]>((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (quiet) clearTimeout(quiet);
      clearTimeout(hard);
      try { client.close(); } catch { /* ya cerrado */ }
      resolve([...byTime.values()].sort((a, b) => a.time - b.time));
    };
    const hard = setTimeout(finish, timeoutMs);
    client.addAuthStateChangeListener((state) => {
      if (state !== "AUTHORIZED") return;
      const feed = new DXLinkFeed(client, FeedContract.HISTORY);
      feed.configure({ acceptEventFields: { Candle: ["eventSymbol", "time", "open", "high", "low", "close"] } });
      feed.addEventListener((events) => {
        for (const ev of events as unknown as Record<string, unknown>[]) {
          const t = Number(ev.time), o = Number(ev.open), h = Number(ev.high), l = Number(ev.low), cl = Number(ev.close);
          if (![t, o, h, l, cl].every(Number.isFinite) || t < fromMs || cl <= 0) continue;
          byTime.set(Math.floor(t / 1000), { time: Math.floor(t / 1000), open: o, high: h, low: l, close: cl });
        }
        // El historial llega en ráfagas: cuando pasan 1.2 s sin nada nuevo, ya está.
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, 1200);
      });
      feed.addSubscriptions([{ type: "Candle", symbol: `${streamerSymbol}{=${period}}`, fromTime: fromMs }]);
    });
    client.connect(dxlinkUrl);
    client.setAuthToken(token);
  });
}
