// GET /api/vision-futura/contexto[?date=YYYY-MM-DD]
// Panel derecho de VisionFutura: "VIX · SPY · QQQ" (precio + Imán + / Imán −) y "Vigía tecnológico"
// (Carlos, 29-oct-2026). Ver lib/visionFuturaContextData.ts. Cada llamada sin `date` también graba
// el minuto en curso (con el mercado abierto).

import { loadContext } from "@/lib/visionFuturaContextData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date");
  try {
    return Response.json(await loadContext(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
