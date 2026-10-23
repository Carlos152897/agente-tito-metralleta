// GET /api/vision-futura?radius=60 — pestaña "VisionFutura" de Prueba de
// Fuego (Carlos, oct 2026): niveles de SPX (Magneto, imanes +/−, pisos,
// resistencias, gamma flip, charm) convertidos a SPY y /ES, VIX con rango
// esperado y Magneto del VIX, posicionamiento de dealers leído del flujo real
// de MarketSnack, y las alertas de confluencia. La carga vive en
// lib/visionFuturaData.ts y el ciclo de alertas en lib/visionFuturaAlertStore.ts
// (compartidos con el poller de Telegram).

import { VisionFuturaError } from "@/lib/visionFuturaData";
import { runVisionFuturaCycle } from "@/lib/visionFuturaAlertStore";
import { MarketSnackError } from "@/lib/marketsnack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const radiusParam = Number(new URL(req.url).searchParams.get("radius"));
  const radius = Number.isFinite(radiusParam) && radiusParam > 0 ? Math.min(radiusParam, 300) : 60;
  try {
    const { payload, alerts, watch } = await runVisionFuturaCycle(new Date(), radius);
    return Response.json({ ...payload, alerts, watch });
  } catch (err) {
    const message = err instanceof MarketSnackError || err instanceof VisionFuturaError
      ? err.message
      : "Error inesperado calculando VisionFutura.";
    return Response.json({ error: message }, { status: 502 });
  }
}
