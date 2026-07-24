// GET /api/history?ticker=XXX — barras diarias del subyacente para la gráfica.

import { fetchDailyBars, MassiveError } from "@/lib/massive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return Response.json({ error: "ticker requerido" }, { status: 400 });
  }
  try {
    const bars = await fetchDailyBars(ticker);
    return Response.json({ ticker, bars });
  } catch (err) {
    const message = err instanceof MassiveError ? err.message : "Error al cargar histórico.";
    return Response.json({ error: message }, { status: 502 });
  }
}
