// GET /api/vision-futura/replay/days — días con repetición guardada y el
// resumen del backtest de cada uno (para el selector de "Repetir sesión").

import { listBacktestDays, listReplayDays } from "@/lib/visionFuturaBacktestStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const bt = new Map(listBacktestDays().map((d) => [d.date, d]));
  return Response.json({
    days: listReplayDays().map((date) => {
      const d = bt.get(date);
      return { date, backtest: d ? { trades: d.trades.length, wins: d.wins, losses: d.losses, points: d.points } : null };
    }),
  });
}
