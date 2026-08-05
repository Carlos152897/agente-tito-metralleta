// POST /api/registro-operaciones/evaluate — el agente identifica la entrada
// por `id` (no `symbol`: en modo bitácora — ver `isContinuousLogTicker` —
// puede haber varias entradas abiertas con el mismo contrato) y manda el
// spot/precio actuales, su lectura del flujo de los vecinos
// (`neighborConfirming`) y — SOLO para SPX — el gamma flip actual de
// MarketSnack (`currentGammaFlip`, null para TSLA). Toda la aritmética
// (target tocado, reversión, fin de día) queda acá, server-side, como única
// fuente de verdad. Si toca salir, esta misma llamada cierra la entrada.

import { evaluateRegistroExit, closeEntry } from "@/lib/registroOperaciones";
import { loadRegistroStore, saveRegistroStore } from "@/lib/registroOperacionesStore";
import { isMarketCloseNear } from "@/lib/marketHours";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateBody {
  id: string;
  currentSpot: number;
  currentPrice: number;
  neighborConfirming: boolean;
  currentGammaFlip: number | null;
}

export async function POST(request: Request) {
  let body: EvaluateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body JSON inválido." }, { status: 400 });
  }
  const { id, currentSpot, currentPrice, neighborConfirming, currentGammaFlip } = body;
  if (!id || !(currentSpot > 0) || !(currentPrice > 0) || typeof neighborConfirming !== "boolean") {
    return Response.json(
      { error: "id, currentSpot (> 0), currentPrice (> 0) y neighborConfirming (boolean) son requeridos." },
      { status: 400 },
    );
  }
  if (currentGammaFlip !== undefined && currentGammaFlip !== null && typeof currentGammaFlip !== "number") {
    return Response.json({ error: "currentGammaFlip debe ser number o null." }, { status: 400 });
  }

  const store = await loadRegistroStore();
  const entry = store.open.find((e) => e.id === id);
  if (!entry) {
    return Response.json({ error: `No hay una entrada abierta con id ${id}.` }, { status: 409 });
  }

  const now = new Date();
  const { shouldExit, reason } = evaluateRegistroExit({
    entry,
    currentSpot,
    neighborConfirming,
    currentGammaFlip: currentGammaFlip ?? null,
    isMarketCloseNear: isMarketCloseNear(now),
    now,
  });

  if (shouldExit && reason) {
    const closed = closeEntry(store, id, currentPrice, currentSpot, reason, now);
    await saveRegistroStore(closed);
    return Response.json({ exited: true, entry: closed.closed[0], store: closed });
  }

  return Response.json({ exited: false, store });
}
