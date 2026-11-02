// GET /api/vision-futura/candles?inst=SPX|NQ|TSLA|ESN|NQN[&date=YYYY-MM-DD]
// Velas japonesas de 1 minuto para la gráfica de VisionFutura (Carlos, 26-oct-2026:
// "que la gráfica salga en velas japonesas y no una línea… minuto a minuto").
//   - SPX / NQ / TSLA: velas reales de tastytrade (DXLink) del índice o la acción
//     (NQ = NDX real, ya no QQQ convertido), solo sesión regular 9:30–16:00 NY.
//     Sin `date`: la sesión de hoy, o la última que tenga velas (fin de semana / antes de abrir).
//   - 🌙 ESN / NQN: velas de 1 min del futuro activo desde la apertura de las 6 pm.
// El navegador la pide cada ~20 s y mueve la última vela con el precio en vivo entre pedidos.

import { fetchFutureCandles, type Candle } from "@/lib/futuresCandles";
import { fetchYahooCandles } from "@/lib/yahooCandles";
import { instrumentOf } from "@/lib/visionFuturaInstruments";
import { activeStreamerSymbol, sessionStartMs } from "@/lib/visionFuturaNight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_CACHE_MS = 15_000;
const CLOSED_CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; ttl: number; body: CandlesResponse }>();
/** Si DXLink (tastytrade) no dio velas cuando debía, no se le vuelve a esperar (~10 s) hasta esta hora. */
let dxDownUntil = 0;
const DX_RETRY_MS = 2 * 60_000;

/** Velas de tastytrade y, si no llegan, de Yahoo (respaldo, 2-nov-2026: DXLink devolvía 502). */
async function candlesWithFallback(sym: string, fromMs: number, toMs: number, now: number): Promise<{ bars: Candle[]; source: "tastytrade" | "yahoo" }> {
  if (now >= dxDownUntil) {
    const dx = (await fetchFutureCandles(sym, fromMs, "1m", 10_000, LIVE_CACHE_MS)).filter((b) => b.time * 1000 < toMs);
    if (dx.length > 0) return { bars: dx, source: "tastytrade" };
    dxDownUntil = now + DX_RETRY_MS;
  }
  return { bars: await fetchYahooCandles(sym, fromMs, toMs, LIVE_CACHE_MS), source: "yahoo" };
}

interface CandlesResponse {
  instrument: string;
  date: string | null;
  symbol: string;
  /** De dónde salieron las velas: tastytrade (DXLink) o Yahoo (respaldo). */
  source?: "tastytrade" | "yahoo";
  candles: Pick<Candle, "time" | "open" | "high" | "low" | "close">[];
}

/** Fecha (YYYY-MM-DD) y minuto del día en Nueva York. */
function nyParts(ms: number): { date: string; min: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** 9:30 NY de esa fecha, en ms (con el horario de verano/invierno correcto). */
function openMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`); // 9:30 EDT
  return nyParts(guess).min === 9 * 60 + 30 ? guess : guess + 3_600_000; // 9:30 EST = 14:30Z
}

const prevDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const slim = (b: Candle[]) => b.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const cfg = instrumentOf(params.get("inst"));
  const wanted = params.get("date");
  const now = Date.now();
  const key = `${cfg.id}|${wanted ?? "hoy"}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return Response.json(hit.body);

  try {
    let body: CandlesResponse;
    let ttl = LIVE_CACHE_MS;
    if (cfg.night) {
      const sym = await activeStreamerSymbol(cfg.night.product);
      if (!sym) return Response.json({ error: `tastytrade no devolvió el futuro activo de /${cfg.night.product}.` }, { status: 502 });
      const got = await candlesWithFallback(sym, sessionStartMs(new Date(now)), now + 60_000, now);
      body = { instrument: cfg.id, date: null, symbol: sym, source: got.source, candles: slim(got.bars) };
    } else {
      const sym = cfg.tastyMain.index ?? cfg.tastyMain.equity ?? cfg.main;
      // Sesión pedida, o la de hoy; si no tiene velas (fin de semana, antes de abrir), la anterior.
      let date = wanted ?? nyParts(now).date;
      let bars: Candle[] = [];
      let source: CandlesResponse["source"];
      for (let i = 0; i < (wanted ? 1 : 5); i++) {
        const from = openMs(date);
        if (from <= now) {
          const got = await candlesWithFallback(sym, from, from + 390 * 60_000, now);
          bars = got.bars;
          source = got.source;
          if (bars.length > 0) break;
        }
        date = prevDay(date);
      }
      const sessionDone = now >= openMs(date) + 390 * 60_000;
      if (sessionDone) ttl = CLOSED_CACHE_MS;
      body = { instrument: cfg.id, date, symbol: sym, source, candles: slim(bars) };
    }
    if (body.candles.length > 0) cache.set(key, { at: now, ttl, body });
    return Response.json(body);
  } catch (err) {
    if (hit) return Response.json(hit.body);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
