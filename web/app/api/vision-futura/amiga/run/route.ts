// GET /api/vision-futura/amiga/run?date=YYYY-MM-DD — backtest del día con la
// regla Sombra 1–5 DTE (lecturas 10:00/12:30/15:30 ya pasadas + cierre), con
// datos de MarketSnack. Idempotente: lo ya procesado no se repite.

import { processAmigaDay } from "@/lib/amigaStore";
import { marketDateStr } from "@/lib/occ";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const now = new Date();
  const date = new URL(req.url).searchParams.get("date") ?? marketDateStr(now);
  try {
    const { hechas } = await processAmigaDay(date, now);
    return Response.json({ date, hechas });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Error procesando el día." }, { status: 502 });
  }
}
