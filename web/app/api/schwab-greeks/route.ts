// GET /api/schwab-greeks?ticker=XXX — griegos e IV reales de Schwab (Market Data
// Production) para complementar la estimación por Black-Scholes de gex.ts/wheel.ts.
//
// Opcional a propósito: si no hay credenciales o Schwab falla (token vencido,
// rate limit), se devuelve `available: false` y el llamador sigue con la
// estimación de siempre — nunca bloquea el reporte principal.

import { fetchGreeksMap, SchwabError } from "@/lib/schwab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return Response.json({ available: false, error: "Ticker vacío." }, { status: 400 });
  }

  try {
    const { underlyingPrice, greeks } = await fetchGreeksMap(ticker, { strikeCount: 60 });
    return Response.json({ available: true, underlyingPrice, greeks });
  } catch (err) {
    const message = err instanceof SchwabError ? err.message : "Error inesperado al consultar Schwab.";
    return Response.json({ available: false, error: message });
  }
}
