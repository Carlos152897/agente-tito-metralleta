// GET/PUT /api/unusual-swing/likes — copia en servidor de "Agregar a Robinhood"
// de Unusual Swing Trades (ver lib/unusualSwingLikesStore.ts). Mismo patrón que
// /api/contract-search/likes: merge (no reemplazo) para no perder los "me
// gusta" hechos desde otro navegador (celular, otra pestaña).

import { loadLikes, saveLikes } from "@/lib/unusualSwingLikesStore";
import { mergeLikes, type LikedContract } from "@/lib/contractSearchLikes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadLikes();
  return Response.json({ entries });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { entries?: LikedContract[] } | null;
  if (!body || !Array.isArray(body.entries)) {
    return Response.json({ error: "Se espera { entries: [...] }" }, { status: 400 });
  }
  const merged = mergeLikes(await loadLikes(), body.entries);
  await saveLikes(merged);
  return Response.json({ ok: true, entries: merged });
}
