// Velas de 1 min para los motores Retest y v3 (lib/visionFuturaRetest.ts). Solo servidor.
// En vivo: tastytrade DXLink con caché de 45 s y, si no responde, Yahoo (respaldo; no se le vuelve a
// esperar a DXLink por 2 min). Nunca lanza.

import { fetchFutureCandles } from "./futuresCandles";
import { fetchYahooCandles } from "./yahooCandles";
import { instrumentOf } from "./visionFuturaInstruments";
import type { RetestBar } from "./visionFuturaRetest";

const LIVE_CACHE_MS = 45_000;
let dxDownUntil = 0;

/** 9:30 NY de esa fecha, en ms (horario de verano/invierno correcto). */
export function dayOpenMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`);
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(guess)));
  return h === 9 ? guess : guess + 3_600_000;
}

export async function liveSessionBars(inst: string, date: string, now: number): Promise<{ bars: RetestBar[]; source: "tastytrade" | "yahoo" | null }> {
  const cfg = instrumentOf(inst);
  const sym = cfg.tastyMain.index ?? cfg.tastyMain.equity ?? cfg.main;
  const open = dayOpenMs(date);
  const close = open + 390 * 60_000;
  const slim = (b: RetestBar[]) => b.filter((x) => x.time * 1000 >= open && x.time * 1000 < close).map(({ time, open: o, high, low, close: c }) => ({ time, open: o, high, low, close: c }));
  try {
    if (now >= dxDownUntil) {
      const dx = slim(await fetchFutureCandles(sym, open, "1m", 8_000, LIVE_CACHE_MS));
      if (dx.length > 0) return { bars: dx, source: "tastytrade" };
      dxDownUntil = now + 2 * 60_000;
    }
    const yb = slim(await fetchYahooCandles(sym, open, close, LIVE_CACHE_MS));
    return { bars: yb, source: yb.length ? "yahoo" : null };
  } catch {
    return { bars: [], source: null };
  }
}
