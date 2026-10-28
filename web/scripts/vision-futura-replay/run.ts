// Guardado diario automático de VisionFutura (Carlos, 23-oct-2026: "instala la tarea programada
// que arme las repeticiones de SPX, NQ y TSLA cada día hábil después del cierre").
//
// Hace lo mismo que abrir "⏪ Repetir sesión" en la app para cada instrumento: arma la repetición
// del día con MarketSnack (que solo guarda el flujo por contrato del último día — si no se arma
// antes de la apertura siguiente, ese día se pierde), y como la sesión ya cerró guarda su
// backtest (entradas, spreads, lottos, señal del dinero, comparación de stops) y, para SPX, la
// regla de la amiga. NO necesita el servidor de la app: importa los mismos módulos que la ruta
// /api/vision-futura/replay. Idempotente: si la repetición ya estaba armada, la reusa.
// También guarda el bloque "En vivo" (lib/visionFuturaLiveStore.ts): las alertas que salieron de
// verdad ese día, calificadas con velas de 1 min.
//
// Uso (cwd = web): npx tsx scripts/vision-futura-replay/run.ts
// Log: data/vision-futura/replay-task.log

import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const WEB_DIR = process.cwd();
try {
  for (const rawLine of readFileSync(join(WEB_DIR, ".env.local"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
} catch { /* sin .env.local: la cookie de MarketSnack puede venir de data/ igual */ }

const LOG_DIR = join(WEB_DIR, "data", "vision-futura");
const LOG = join(LOG_DIR, "replay-task.log");
function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(LOG, line + "\n", "utf8"); } catch { /* sin disco */ }
}

async function main() {
  const { buildReplay } = await import("../../lib/visionFuturaReplay");
  const { simulateDay, spreadsForBacktest } = await import("../../lib/visionFuturaBacktest");
  const { saveBacktestDay } = await import("../../lib/visionFuturaBacktestStore");
  const { processAmigaDay } = await import("../../lib/amigaStore");
  const { gradePremarketDay } = await import("../../lib/visionFuturaPremarketData");
  const { attachLiveDay } = await import("../../lib/visionFuturaLiveStore");
  const { positionsFromTicks } = await import("../../lib/visionFuturaPositioning");
  const { instrumentOf } = await import("../../lib/visionFuturaInstruments");
  const { settleLottoWithRule } = await import("../../lib/visionFuturaLottos");
  const { attachHybridDay } = await import("../../lib/visionFuturaHybridStore");
  const { hybridSummary } = await import("../../lib/visionFuturaHybrid");

  const now = new Date();
  let fallas = 0;
  for (const inst of ["SPX", "NQ", "TSLA"]) {
    try {
      const replay = await buildReplay(now, { inst });
      if (replay.partial) {
        log(`${inst} ${replay.date}: la sesión sigue abierta — no se guarda el backtest todavía.`);
        continue;
      }
      const bt = simulateDay({ date: replay.date, alerts: replay.alerts, priceSeries: replay.priceSeries });
      saveBacktestDay({
        ...bt,
        instrument: replay.instrument,
        spreads: spreadsForBacktest(replay.spreadTrades ?? []),
        lottos: (replay.lottoTrades ?? []).filter((t) => t.settle != null).map((t) => settleLottoWithRule(t)),
        money: (replay.moneyTrades ?? []).filter((t) => t.points != null),
        pressure: positionsFromTicks(replay.ticks, !!instrumentOf(replay.instrument).night).pressure,
      });
      // En vivo: lo que de verdad salió en la pantalla / tarea de fondo, calificado con velas de 1 min.
      const live = await attachLiveDay(replay.instrument, replay.date).catch((e) => { log(`${inst} en vivo: ${e instanceof Error ? e.message : e}`); return null; });
      if (live) {
        const hm = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }));
        const lm = live.money.filter((m) => m.points != null);
        log(`${inst} ${replay.date}: EN VIVO vigilado ${hm(live.coverage.first)}–${hm(live.coverage.last)} (${live.coverage.minutesWatched} min con ciclos) · entradas ${live.trades.length} (${live.wins}/${live.losses}, ${live.points} pts, ${live.priceSource}) · señales del dinero ${lm.length} (${lm.reduce((a, m) => a + (m.points ?? 0), 0).toFixed(2)} pts)`);
      } else log(`${inst} ${replay.date}: sin alertas en vivo guardadas (nadie vigiló ese día).`);
      // Motor híbrido (después del vivo, que también guarda el estado del día): velas de 1 min.
      const hy = await attachHybridDay(replay.instrument, replay.date, replay).catch((e) => { log(`${inst} híbrido: ${e instanceof Error ? e.message : e}`); return null; });
      if (hy) {
        const a = hybridSummary(hy.alerts), m = hybridSummary(hy.money);
        log(`${inst} ${replay.date}: MOTOR HÍBRIDO (${hy.priceSource}) · alertas ${a.n} (${a.wins}/${a.losses}, ${a.points} pts) · señales ${m.n} (${m.wins}/${m.losses}, ${m.points} pts) · bloqueadas ${hy.blocked.length}`);
      }
      if (replay.instrument === "SPX") await processAmigaDay(replay.date, now).catch((e) => log(`SPX amiga: ${e instanceof Error ? e.message : e}`));
      const money = (replay.moneyTrades ?? []).filter((t) => t.points != null);
      const strikesConGex = replay.ticks.at(-1)?.rows.filter((r) => r.netGex !== 0).length ?? 0;
      // Pre-mercado: compara el rango pronosticado con lo que hizo el día (si hubo lectura).
      const pg = await gradePremarketDay(inst, replay.date).catch(() => null);
      if (pg) log(`${inst} ${replay.date}: pre-mercado ${pg.insideRange ? "DENTRO del rango" : "salió del rango"} · real ${pg.low.toFixed(2)}–${pg.high.toFixed(2)} · ${pg.notes.join("; ")}`);
      log(`${inst} ${replay.date}: OK v${replay.version} · ${replay.ticks.length} pasos · entradas ${bt.trades.length} (${bt.points} pts) · señales del dinero ${money.length} (${money.reduce((a, t) => a + (t.points ?? 0), 0).toFixed(2)} pts) · lottos ${(replay.lottoTrades ?? []).length} · strikes con GEX ${strikesConGex}`);
    } catch (e) {
      fallas++;
      log(`${inst}: FALLÓ — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (fallas > 0) process.exitCode = 1;
}

main().catch((e) => { log(`FALLÓ — ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
