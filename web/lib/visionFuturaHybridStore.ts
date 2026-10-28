// Guarda el Motor híbrido de un día en su backtest (ver lib/visionFuturaHybrid.ts). Solo servidor /
// scripts: lo llaman la tarea del cierre (scripts/vision-futura-replay/run.ts) y "Repetir sesión".
// Califica con velas REALES de 1 min (tastytrade): el precio de 5 min de la repetición es optimista.
// Si ese día hubo vigilancia en vivo, también guarda lo que el híbrido sacó en vivo.

import { readFileSync } from "fs";
import { join } from "path";
import { fetchFutureCandles } from "./futuresCandles";
import { instrumentOf } from "./visionFuturaInstruments";
import { loadBacktestDay, saveBacktestDay } from "./visionFuturaBacktestStore";
import { loadAlertStateFor } from "./visionFuturaAlertStore";
import { hybridFromReplay, resolveHybrid, type HybridDay, type HybridReplayInput } from "./visionFuturaHybrid";

export interface HybridBacktest extends HybridDay {
  priceSource: string;
  /** Lo que salió EN VIVO (si hubo vigilancia ese día), calificado igual. */
  live?: HybridDay | null;
}

function sessionOpenMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`);
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(guess)));
  return h === 9 ? guess : guess + 3_600_000;
}

export async function attachHybridDay(inst: string, date: string, replay: HybridReplayInput & { priceSeries: { time: number; value: number }[] }): Promise<HybridBacktest | null> {
  const bt = loadBacktestDay(date, inst);
  if (!bt) return null;
  const cfg = instrumentOf(inst);
  const sym = cfg.tastyMain.index ?? cfg.tastyMain.equity ?? cfg.main;
  const open = sessionOpenMs(date);
  const bars = (await fetchFutureCandles(sym, open, "1m", 12_000, 0).catch(() => []))
    .filter((b) => b.time * 1000 >= open && b.time * 1000 < open + 390 * 60_000);
  const prices = bars.length
    ? bars.map((b) => ({ t: b.time * 1000, high: b.high, low: b.low, close: b.close })) // t = inicio: solo cuentan las velas que empiezan DESPUÉS de la entrada
    : replay.priceSeries.map((p) => ({ t: p.time * 1000, v: p.value }));
  const priceSource = bars.length ? "velas 1 min (tastytrade)" : "precio 5 min (sin velas de 1 min)";
  const score = (d: HybridDay): HybridDay => ({
    alerts: d.alerts.map((t) => resolveHybrid(t, prices, true)),
    money: d.money.map((t) => resolveHybrid(t, prices, true)),
    blocked: d.blocked,
  });
  let live: HybridDay | null = null;
  const state = loadAlertStateFor(date, inst) as { hybrid?: HybridDay } | null;
  let liveHybrid = state?.hybrid ?? null;
  if (!liveHybrid) {
    try {
      const arch = JSON.parse(readFileSync(join(process.cwd(), "data", "vision-futura", "live", inst === "SPX" ? `${date}.json` : `${inst}-${date}.json`), "utf8"));
      liveHybrid = arch.hybrid ?? null;
    } catch { /* sin vivo */ }
  }
  if (liveHybrid) live = score({ alerts: liveHybrid.alerts.map((t) => ({ ...t, outcome: null, exit: null, exitAt: null, points: null })), money: liveHybrid.money.map((t) => ({ ...t, outcome: null, exit: null, exitAt: null, points: null })), blocked: liveHybrid.blocked });
  const hybrid: HybridBacktest = { ...score(hybridFromReplay(replay, prices)), priceSource, live };
  saveBacktestDay({ ...loadBacktestDay(date, inst)!, hybrid });
  return hybrid;
}
