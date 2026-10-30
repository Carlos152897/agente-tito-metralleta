// GET /api/vision-futura/volumen?inst=SPX&exp=YYYY-MM-DD&spot=7720&radius=60[&since=segundos]
// Volumen DELTA minuto a minuto por strike: velas de 1 min de cada call y put con volumen al bid
// y al ask (tastytrade DXLink). Ver lib/visionFuturaVolumeDeltaData.ts.

import { loadVolumeDelta } from "@/lib/visionFuturaVolumeDeltaData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const exp = q.get("exp") ?? "";
  const spot = Number(q.get("spot"));
  const radius = Math.min(200, Math.max(5, Number(q.get("radius")) || 60));
  const since = q.get("since") != null ? Number(q.get("since")) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || !(spot > 0)) return Response.json({ error: "Faltan exp o spot." }, { status: 400 });
  try {
    return Response.json(await loadVolumeDelta(q.get("inst") ?? "SPX", exp, spot, radius, since));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
