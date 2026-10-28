// GET /api/vision-futura/replay[?date=YYYY-MM-DD][&force=1] — "Repetir sesión"
// de VisionFutura (ver lib/visionFuturaReplay.ts).
//   - sin `date` (o con la fecha de la última sesión): la arma con MarketSnack
//     (la primera vez tarda; después sale del cache en disco). Si la sesión ya
//     cerró, guarda además su backtest del día (lib/visionFuturaBacktestStore.ts).
//   - con `date` de un día anterior: lee la repetición guardada (MarketSnack solo
//     da el flujo por contrato del último día, así que los días viejos no se
//     pueden volver a armar).

import { buildReplay } from "@/lib/visionFuturaReplay";
import { simulateDay, spreadsForBacktest } from "@/lib/visionFuturaBacktest";
import { loadSavedReplay, saveBacktestDay } from "@/lib/visionFuturaBacktestStore";
import { MarketSnackError } from "@/lib/marketsnack";
import { processAmigaDay } from "@/lib/amigaStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { positionsFromTicks } from "@/lib/visionFuturaPositioning";
import { instrumentOf } from "@/lib/visionFuturaInstruments";
import { settleLottoWithRule } from "@/lib/visionFuturaLottos";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const force = params.get("force") === "1";
  const date = params.get("date");
  const inst = (params.get("inst") ?? "SPX").toUpperCase();
  try {
    if (date && !force) {
      const saved = loadSavedReplay(date, inst);
      if (saved) return Response.json(saved);
    }
    const replay = await buildReplay(new Date(), { force, inst });
    if (date && replay.date !== date) {
      return Response.json({ error: `No hay repetición guardada del ${date}.` }, { status: 404 });
    }
    if (!replay.partial) {
      saveBacktestDay({
        ...simulateDay({ date: replay.date, alerts: replay.alerts, priceSeries: replay.priceSeries }),
        instrument: replay.instrument,
        spreads: spreadsForBacktest(replay.spreadTrades ?? []),
        lottos: (replay.lottoTrades ?? []).filter((t) => t.settle != null).map((t) => settleLottoWithRule(t)),
        money: (replay.moneyTrades ?? []).filter((t) => t.points != null),
        pressure: positionsFromTicks(replay.ticks, !!instrumentOf(replay.instrument).night).pressure,
      });
      // "Verticales amiga": lecturas + salidas + cierre del día (idempotente, no repite lo hecho).
      if (replay.instrument === "SPX") await processAmigaDay(replay.date, new Date()).catch(() => null);
    }
    return Response.json(replay);
  } catch (err) {
    const message = err instanceof MarketSnackError || err instanceof Error ? err.message : "Error reconstruyendo la sesión.";
    return Response.json({ error: message }, { status: 502 });
  }
}
