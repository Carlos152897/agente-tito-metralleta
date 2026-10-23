// GET /api/vision-futura/live — precio EN VIVO de VisionFutura (Carlos, oct
// 2026: "quiero todo en vivo"): SPX, SPY, /ES y VIX de tastytrade en una sola
// llamada, pensada para pedirse cada pocos segundos. Los niveles (GEX de
// MarketSnack) siguen saliendo de /api/vision-futura, que es más pesado.

import { fetchActiveFuture, fetchLiveQuotes, TastytradeError } from "@/lib/tastytrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El contrato activo de /ES cambia solo en el roll trimestral: se cachea 1 h.
let esCache: { symbol: string; at: number } | null = null;
async function activeEs(): Promise<string | null> {
  if (esCache && Date.now() - esCache.at < 3_600_000) return esCache.symbol;
  const f = await fetchActiveFuture("ES").catch(() => null);
  if (f) esCache = { symbol: f.symbol, at: Date.now() };
  return f?.symbol ?? esCache?.symbol ?? null;
}

export async function GET() {
  try {
    const esSymbol = await activeEs();
    const q = await fetchLiveQuotes({ index: ["SPX", "VIX"], equity: ["SPY"], future: esSymbol ? [esSymbol] : [] });
    const spx = q.get("SPX");
    if (!spx) return Response.json({ error: "tastytrade no devolvió SPX." }, { status: 502 });
    const vix = q.get("VIX");
    return Response.json({
      asOf: new Date().toISOString(),
      source: "tastytrade",
      spx: spx.price,
      spxUpdatedAt: spx.updatedAt,
      spy: q.get("SPY")?.price ?? null,
      es: esSymbol ? q.get(esSymbol)?.price ?? null : null,
      esSymbol,
      vix: vix ? { last: vix.price, prevClose: vix.prevClose } : null,
    });
  } catch (err) {
    const message = err instanceof TastytradeError ? err.message : "Error leyendo precios en vivo.";
    return Response.json({ error: message }, { status: 502 });
  }
}
