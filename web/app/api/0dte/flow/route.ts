// GET /api/0dte/flow — acumula el agresor (compra vs venta) del vencimiento de
// hoy de SPX. Cada llamada suma su tramo de cinta al acumulado del día. Ver
// Agente Principal/Proceso 0DTE.md §6.3.

import { fetchFlow, MarketSnackError } from "@/lib/marketsnack";
import { marketDateStr } from "@/lib/occ";
import {
  accumulate, loadFlow, readAggressor, saveFlow, type AggressorRead,
} from "@/lib/zerodteFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER = "SPX";
/** Páginas por ciclo. Cada una son 50 trades (~1 segundo de cinta en SPX). */
const PAGES = 40;

export async function GET() {
  const now = new Date();
  const date = marketDateStr(now);

  try {
    const before = await loadFlow(TICKER, date);
    const { trades } = await fetchFlow(TICKER, { period: "1d", maxPages: PAGES });
    const acc = accumulate(before, trades, date, now);
    await saveFlow(acc);

    const reads: Record<string, AggressorRead> = {};
    for (const b of Object.values(acc.buckets)) {
      const r = readAggressor(acc, b.type, b.strike);
      if (r) reads[`${b.type}:${b.strike}`] = r;
    }

    return Response.json({
      ticker: TICKER, date, cycles: acc.cycles, updatedAt: acc.updatedAt,
      contracts: Object.keys(acc.buckets).length, tradesThisCycle: trades.length, reads,
    });
  } catch (err) {
    const message = err instanceof MarketSnackError ? err.message : "Error al acumular el flujo 0DTE.";
    // 200 con `error`: la página funciona sin agresor, solo pierde esa columna.
    return Response.json({ error: message, reads: {} }, { status: 200 });
  }
}
