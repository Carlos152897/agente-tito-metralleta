// GET /api/spx-amiga — "SPX amiga", Agente 0DTE (Carlos, 2026-08-04). JSON
// plano, no SSE — 2 fetches rápidos en paralelo (spot + cadena 0DTE extendida
// de MarketSnack), mismo patrón que app/api/spx-levels/route.ts. Ver
// lib/spxAmiga.ts para el motor puro (nuevo, separado de lib/gex.ts).

import { buildSpxAmigaBoard } from "@/lib/spxAmiga";
import { fetchAssetPrice, fetchOptionChainExtended, MarketSnackError } from "@/lib/marketsnack";
import { marketDateStr } from "@/lib/occ";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER = "SPX";

export async function GET() {
  try {
    const now = new Date();
    // SPXW son semanales que expiran TODOS los días de mercado — 0DTE de hoy.
    const expiration = marketDateStr(now);

    const [spot, contracts] = await Promise.all([
      fetchAssetPrice(TICKER),
      fetchOptionChainExtended(TICKER, expiration),
    ]);

    if (!spot || spot <= 0) {
      return Response.json({ error: "Sin precio en vivo para SPX." }, { status: 502 });
    }
    if (contracts.length === 0) {
      return Response.json({ error: "Sin cadena 0DTE disponible para hoy." }, { status: 502 });
    }

    const board = buildSpxAmigaBoard({ spot, expiration, contracts, now });
    return Response.json(board);
  } catch (err) {
    const message = err instanceof MarketSnackError ? err.message : "Error inesperado armando el tablero de SPX amiga.";
    return Response.json({ error: message }, { status: 502 });
  }
}
