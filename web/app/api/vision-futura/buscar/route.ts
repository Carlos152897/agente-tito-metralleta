// GET /api/vision-futura/buscar?q=nvd — sugerencias del buscador de VisionFutura: acciones y ETFs
// con opciones (tastytrade), sin SPX ni NQ (tienen botón propio). Traído del zip "visionfutura-main".

import { searchOptionSymbols } from "@/lib/tastytrade";
import { isEquityTicker } from "@/lib/visionFuturaInstruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 40);
  if (q.trim().length < 1) return Response.json({ items: [] });
  try {
    const items = (await searchOptionSymbols(q)).filter((i) => isEquityTicker(i.symbol) && i.symbol !== "SPX" && i.symbol !== "NDX").slice(0, 8);
    return Response.json({ items });
  } catch (e) {
    return Response.json({ items: [], error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
