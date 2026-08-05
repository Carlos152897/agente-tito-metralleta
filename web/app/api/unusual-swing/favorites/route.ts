// GET/PUT /api/unusual-swing/favorites — copia en servidor de la watchlist de
// "Unusual Swing Trades" (ver lib/unusualSwingStore.ts). El navegador sigue
// siendo la fuente de verdad para la UI; esto solo existe para que una tarea
// programada pueda leer qué contratos están guardados sin acceso al navegador.

import { loadFavorites, saveFavorites } from "@/lib/unusualSwingStore";
import type { UnusualSwingEntry } from "@/lib/unusualSwingWatchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadFavorites();
  return Response.json({ entries });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { entries?: UnusualSwingEntry[] } | null;
  if (!body || !Array.isArray(body.entries)) {
    return Response.json({ error: "Se espera { entries: [...] }" }, { status: 400 });
  }
  await saveFavorites(body.entries);
  return Response.json({ ok: true, total: body.entries.length });
}
