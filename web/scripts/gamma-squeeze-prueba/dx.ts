// Descarga de velas de 1 min (OHLC + volumen al bid/ask) de muchos contratos por DXLink: UNA
// conexión, un canal por cada 40 símbolos (varias conexiones chocan con el límite de sesiones).
// Compartido por medir.ts y papel.ts de Gamma Squeeze Prueba.

export type Bar = { time: number; open: number; high: number; low: number; close: number; volume?: number; bidVolume?: number; askVolume?: number };

export async function pullOhlc(syms: string[], fromMs: number, timeoutMs = 40_000): Promise<Map<string, Bar[]>> {
  const { DXLinkWebSocketClient } = await import("@dxfeed/dxlink-websocket-client");
  const { DXLinkFeed, FeedContract } = await import("@dxfeed/dxlink-feed");
  const { fetchQuoteToken } = await import("../../lib/tastytrade");
  const out = new Map<string, Map<number, Bar>>();
  const { token, dxlinkUrl } = await fetchQuoteToken();
  const client = new DXLinkWebSocketClient();
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (quiet) clearTimeout(quiet);
      clearTimeout(hard);
      try { client.close(); } catch { /* cerrado */ }
      resolve(new Map([...out].map(([k, m]) => [k, [...m.values()].sort((a, b) => a.time - b.time)])));
    };
    const hard = setTimeout(finish, timeoutMs);
    client.addAuthStateChangeListener((state) => {
      if (state !== "AUTHORIZED") return;
      for (let i = 0; i < syms.length; i += 40) {
        const feed = new DXLinkFeed(client, FeedContract.HISTORY);
        feed.configure({ acceptEventFields: { Candle: ["eventSymbol", "time", "open", "high", "low", "close", "volume", "bidVolume", "askVolume"] } });
        feed.addEventListener((events) => {
          for (const ev of events as unknown as Record<string, unknown>[]) {
            const t = Number(ev.time), o = Number(ev.open), h = Number(ev.high), l = Number(ev.low), c = Number(ev.close);
            if (![t, o, h, l, c].every(Number.isFinite) || t < fromMs || c <= 0 || t > Date.now() + 120_000) continue;
            const sym = String(ev.eventSymbol).replace(/\{.*\}$/, "");
            const opt = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
            const m = out.get(sym) ?? new Map<number, Bar>();
            m.set(Math.floor(t / 1000), { time: Math.floor(t / 1000), open: o, high: h, low: l, close: c, volume: opt(ev.volume), bidVolume: opt(ev.bidVolume), askVolume: opt(ev.askVolume) });
            out.set(sym, m);
          }
          if (quiet) clearTimeout(quiet);
          quiet = setTimeout(finish, 2500);
        });
        feed.addSubscriptions(syms.slice(i, i + 40).map((s) => ({ type: "Candle", symbol: `${s}{=1m}`, fromTime: fromMs })));
      }
    });
    client.connect(dxlinkUrl);
    client.setAuthToken(token);
  });
}

