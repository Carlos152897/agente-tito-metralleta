// GET /api/vision-futura/inusuales?inst=SPX&date=YYYY-MM-DD
// Operaciones inusuales de MarketSnack GUARDADAS de un día (data/vision-futura/marketsnack/) para las
// bolas de la gráfica en "Repetir sesión" (Carlos, 30-oct-2026). Las salidas se calculan con todo el
// día; el navegador solo muestra lo que ya había pasado en el minuto del cursor.

import { loadMsDay } from "@/lib/visionFuturaMsStore";
import { unusualExits } from "@/lib/visionFuturaUnusualExit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const inst = (q.get("inst") ?? "").toUpperCase();
  const date = q.get("date") ?? "";
  if (!/^[A-Z0-9]{1,10}$/.test(inst) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "inst o date inválidos" }, { status: 400 });
  }
  const day = loadMsDay(inst, date);
  if (!day) return Response.json({ inst, date, expiration: null, unusual: [], unusualExits: {} });
  const flow = Object.fromEntries(Object.entries(day.contractFlow ?? {}).map(([k, v]) => [k, v.buckets]));
  return Response.json({
    inst,
    date,
    expiration: day.expiration,
    unusual: day.unusual,
    unusualExits: unusualExits(day.unusual, flow, Date.now()),
  });
}
