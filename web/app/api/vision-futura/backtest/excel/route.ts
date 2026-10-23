// GET /api/vision-futura/backtest/excel — descarga el Excel con el backtest de
// todos los días guardados (hoja "Resumen" + una hoja por día).

import { buildBacktestWorkbook } from "@/lib/visionFuturaBacktestStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const buf = await buildBacktestWorkbook();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="VisionFutura-Backtest.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
