// Guarda las alertas EN VIVO de un día dentro de su backtest (ver lib/visionFuturaLive.ts).
// Solo servidor / scripts. Lo usan la tarea del cierre (scripts/vision-futura-replay/run.ts) y la
// tarea de fondo del día (scripts/vision-futura-live/poll.ts, al terminar la sesión).
//
//   1. Copia el estado en vivo del día a data/vision-futura/live/{inst-}{fecha}.json, porque
//      alert-state*.json se reinicia al día siguiente.
//   2. Baja las velas de 1 min de tastytrade de la sesión (9:30–16:00 NY).
//   3. Califica cada alerta disparada y guarda el bloque `live` en backtest/{inst-}{fecha}.json.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadAlertStateFor, type AlertState } from "./visionFuturaAlertStore";
import { loadBacktestDay, saveBacktestDay } from "./visionFuturaBacktestStore";
import { fetchFutureCandles } from "./futuresCandles";
import { instrumentOf } from "./visionFuturaInstruments";
import { minutesWatched, scoreLiveDay, type LiveDay, type LiveFired } from "./visionFuturaLive";

const LIVE_DIR = join(process.cwd(), "data", "vision-futura", "live");
const archiveFile = (inst: string, date: string) => join(LIVE_DIR, inst === "SPX" ? `${date}.json` : `${inst}-${date}.json`);

/** 9:30 NY de esa fecha, en ms (horario de verano/invierno correcto). */
function sessionOpenMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`);
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date(guess)));
  return h === 9 ? guess : guess + 3_600_000;
}

/** Copia el estado en vivo del día al archivo permanente (si el estado sigue siendo de ese día). */
export function archiveLiveState(inst: string, date: string): AlertState | null {
  const s = loadAlertStateFor(date, inst);
  if (s) {
    mkdirSync(LIVE_DIR, { recursive: true });
    writeFileSync(archiveFile(inst, date), JSON.stringify(s), "utf8");
    return s;
  }
  try {
    return JSON.parse(readFileSync(archiveFile(inst, date), "utf8")) as AlertState;
  } catch {
    return null;
  }
}

/**
 * Califica lo que salió en vivo y lo guarda en el backtest del día. Devuelve null si ese día no
 * hubo estado en vivo (nadie vigiló) o todavía no existe el backtest (la repetición lo crea).
 */
export async function attachLiveDay(inst: string, date: string): Promise<LiveDay | null> {
  const state = archiveLiveState(inst, date);
  if (!state) return null;
  const bt = loadBacktestDay(date, inst);
  if (!bt) return null;

  const cfg = instrumentOf(inst);
  const sym = cfg.tastyMain.index ?? cfg.tastyMain.equity ?? cfg.main;
  const open = sessionOpenMs(date);
  const bars = await fetchFutureCandles(sym, open, "1m", 12_000, 0).catch(() => []);
  const candles = bars.filter((b) => b.time * 1000 >= open && b.time * 1000 < open + 390 * 60_000);

  let fallbackPrices: { time: number; value: number }[] = [];
  if (candles.length === 0) {
    try {
      const rp = JSON.parse(readFileSync(join(process.cwd(), "data", "vision-futura", inst === "SPX" ? `replay-${date}.json` : `replay-${inst}-${date}.json`), "utf8"));
      fallbackPrices = rp.priceSeries ?? [];
    } catch { /* sin repetición */ }
  }

  const cycles = (state.cycles ?? []).filter((t) => t >= open && t <= open + 390 * 60_000);
  // Estados de antes de este cambio no tienen `cycles`: se estima con los disparos y la última muestra.
  const approx = cycles.length === 0
    ? [...state.fired.flatMap((f) => [f.firedAt, f.lastSeenAt]), ...state.prices.map((p) => p.t)].filter((t) => t >= open)
    : cycles;
  const live = scoreLiveDay({
    date,
    fired: state.fired as LiveFired[],
    candles,
    fallbackPrices,
    money: (state.moneyTrades ?? []).filter((m) => m.openedAt >= open),
    lottos: state.lottos ?? [],
    coverage: {
      first: approx.length ? Math.min(...approx) : null,
      last: approx.length ? Math.max(...approx) : null,
      cycles: cycles.length,
      minutesWatched: cycles.length ? minutesWatched(cycles) : 0,
    },
  });
  saveBacktestDay({ ...bt, live });
  return live;
}
