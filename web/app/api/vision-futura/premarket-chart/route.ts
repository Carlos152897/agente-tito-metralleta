// GET /api/vision-futura/premarket-chart?inst=SPX|NQ|TSLA
// Gráfica del pre-mercado (Carlos, 27-oct-2026): velas de 1 min desde la apertura de la noche
// (6 pm NY del día anterior) hasta las 9:30, con los puntos importantes marcados.
//   - SPX / NQ: velas del futuro activo (/ES, /NQ) pasadas a precio del índice restando la base
//     (futuro − índice al cierre de las 4 pm, la misma del "precio implícito" del pre-mercado).
//   - TSLA: la acción en pre-market, desde las 4 am.
// Niveles (cierre/ayer/Magneto/flip/techo/piso/rango) = los del reporte de pre-mercado
// (congelado si ya abrió la sesión). Puntos de la noche: lib/visionFuturaPremarketChart.ts.

import { fetchFutureCandles } from "@/lib/futuresCandles";
import { instrumentOf } from "@/lib/visionFuturaInstruments";
import { activeFutureInfo } from "@/lib/visionFuturaNight";
import { loadPremarket } from "@/lib/visionFuturaPremarketData";
import { nyTimeMs } from "@/lib/visionFuturaPremarket";
import { analyzePremarket, type PmAnalysis, type PmCandle } from "@/lib/visionFuturaPremarketChart";
import type { PremarketMark } from "@/lib/visionFuturaPremarket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PremarketChartResponse {
  inst: string;
  date: string;
  phase: "pre" | "sesion";
  /** Ventana de la gráfica (segundos). */
  from: number;
  to: number;
  /** 9:30 NY del día (segundos): fin del eje. */
  open: number;
  /** De dónde salen las velas (ej. "/ESZ26 − 31.2"). */
  source: string;
  futSymbol: string | null;
  /** Futuro − índice (para mostrar el precio del futuro). */
  basis: number | null;
  candles: PmCandle[];
  analysis: PmAnalysis;
  marks: PremarketMark[];
  range: { low: number; high: number } | null;
  extended: { low: number; high: number } | null;
  prevClose: number | null;
  note: string | null;
}

const LIVE_MS = 30_000;
const CLOSED_MS = 10 * 60_000;
const cache = new Map<string, { at: number; ttl: number; body: PremarketChartResponse }>();

const prevCalendarDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function GET(req: Request) {
  const instRaw = new URL(req.url).searchParams.get("inst") ?? "SPX";
  const inst = ["SPX", "NQ", "TSLA"].includes(instRaw) ? instRaw : "SPX";
  const now = Date.now();
  const hit = cache.get(inst);
  if (hit && now - hit.at < hit.ttl) return Response.json(hit.body);

  try {
    const pm = await loadPremarket(inst);
    const cfg = instrumentOf(inst);
    const r = pm.day ? (pm.phase === "sesion" ? pm.day.frozen ?? pm.day.report : pm.day.report) : null;
    const date = pm.date;
    const open = nyTimeMs(date, "09:30");
    // Futuros: la noche abre a las 6 pm del día de calendario anterior (lunes → domingo 6 pm).
    const fromMs = cfg.future ? nyTimeMs(prevCalendarDay(date), "18:00") : nyTimeMs(date, "04:00");
    const toMs = Math.min(now, open);

    let candles: PmCandle[] = [];
    let source = "";
    let futSymbol: string | null = null;
    let basis: number | null = null;
    let note: string | null = null;

    if (fromMs > now) {
      note = cfg.future ? "La noche de futuros abre a las 6 pm NY; la gráfica empieza a dibujarse entonces." : "El pre-market de la acción abre a las 4 am NY.";
    } else if (cfg.future) {
      const fut = await activeFutureInfo(cfg.future).catch(() => null);
      futSymbol = fut?.symbol ?? null;
      basis = r?.futBasis ?? null;
      if (!fut?.streamer) note = `tastytrade no devolvió el futuro activo de /${cfg.future}.`;
      else {
        const bars = await fetchFutureCandles(fut.streamer, fromMs, "1m", 12_000, LIVE_MS);
        const b = basis ?? 0;
        candles = bars
          .filter((x) => x.time * 1000 >= fromMs && x.time * 1000 < open)
          .map((x) => ({ ...x, open: x.open - b, high: x.high - b, low: x.low - b, close: x.close - b }));
        source = basis != null
          ? `${fut.symbol} ${basis >= 0 ? "−" : "+"} ${Math.abs(basis).toFixed(2)} (base al cierre) = precio de ${cfg.main}`
          : `${fut.symbol} sin convertir (sin base todavía)`;
        if (basis == null) note = "Todavía no hay base futuro−índice: las velas están en precio del futuro.";
      }
    } else {
      const sym = cfg.tastyMain.equity ?? cfg.main;
      const bars = await fetchFutureCandles(sym, fromMs, "1m", 12_000, LIVE_MS);
      candles = bars.filter((x) => x.time * 1000 >= fromMs && x.time * 1000 < open);
      source = `${sym} pre-market (desde las 4 am NY)`;
    }

    const body: PremarketChartResponse = {
      inst, date, phase: pm.phase,
      from: Math.floor(fromMs / 1000), to: Math.floor(toMs / 1000), open: Math.floor(open / 1000),
      source, futSymbol, basis, candles,
      analysis: analyzePremarket(candles),
      // "Máx./Mín. de la noche" del reporte se reemplazan por los de la gráfica (con hora).
      marks: (r?.marks ?? []).filter((m) => m.kind !== "noche"),
      range: r?.range ?? null,
      extended: r?.extended ?? null,
      prevClose: r?.prevClose ?? null,
      note: note ?? (candles.length === 0 && fromMs <= now ? "tastytrade no devolvió velas de la noche todavía." : null),
    };
    const ttl = pm.phase === "sesion" ? CLOSED_MS : LIVE_MS;
    if (candles.length > 0) cache.set(inst, { at: now, ttl, body });
    return Response.json(body);
  } catch (err) {
    if (hit) return Response.json(hit.body);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
