// GET /api/vision-futura/premarket?inst=SPX|NQ|TSLA[&force=1] — pronóstico de pre-mercado:
// rango probable del día, piso/techo por posiciones de opciones, posiciones importantes y
// nuevas, recorrido del pre-mercado e historial de aciertos. Ver lib/visionFuturaPremarketData.ts.

import { loadPremarket } from "@/lib/visionFuturaPremarketData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inst = (url.searchParams.get("inst") ?? "SPX").toUpperCase();
  try {
    return Response.json(await loadPremarket(inst, new Date(), { force: url.searchParams.get("force") === "1" }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error en el pre-mercado." }, { status: 502 });
  }
}
