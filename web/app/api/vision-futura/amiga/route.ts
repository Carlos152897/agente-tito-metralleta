// GET /api/vision-futura/amiga — sección "Verticales amiga" (regla Sombra 1–5 DTE):
// lectura en vivo (tastytrade), historial del backtest y su resumen, y el
// calendario de eventos de la compuerta N. Ver lib/amigaStore.ts.

import { amigaLive, loadEventos, loadHistorial, resumenAmiga } from "@/lib/amigaStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const h = loadHistorial();
  let live = null, liveError: string | null = null;
  try {
    live = await amigaLive(new Date());
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    liveError = /429/.test(msg)
      ? "tastytrade pidió esperar (demasiadas consultas seguidas). La lectura en vivo se reintenta en 1 minuto."
      : msg || "No se pudo leer tastytrade.";
  }
  return Response.json({
    live,
    liveError,
    resumen: resumenAmiga(h.jugadas),
    jugadas: [...h.jugadas].sort((a, b) => b.id.localeCompare(a.id)),
    lecturas: h.lecturas,
    salidas: h.eventos,
    procesadas: h.procesadas,
    calendario: loadEventos(),
  });
}
