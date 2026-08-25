// Backtest diario de "Contratos vecinos 3.0" (SPX + TSLA) — pedido explícito
// de Carlos (2026-08-25): correr esto TODOS los días después del cierre,
// reproducir el motor real (contratosVecinos3Signal + applyPersistence)
// minuto a minuto con SOLO datos hasta cada momento (sin mirar al futuro),
// registrar CADA entrada/salida, guardar el resultado y avisar por Telegram
// — así se acumula una bitácora real día a día para encontrar fallas y
// mejorar el motor con el tiempo, en vez de correr esto a mano cada vez.
//
// Uso: node_modules/.bin/tsx scripts/backtest-cv3/run.ts [YYYY-MM-DD]
// Sin fecha: usa el día más reciente con datos completos (si se corre
// después del cierre de HOY, es HOY; si se corre antes de la apertura, cae
// solo al último día hábil cerrado — ver metodología en memoria de Claude,
// "Contratos Vecinos 3.0 Backtest Log").
//
// Instalado como tarea de Windows (VisionaryTrades-CV3Backtest, ~15 min
// después del cierre) vía Instalar-BacktestCV3.ps1, mismo patrón que
// scripts/premarket-movers-alert/.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const WEB_DIR = process.cwd();
const envPath = join(WEB_DIR, ".env.local");
for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

const LOG_FILE = join(WEB_DIR, "data", "backtest-cv3.log");
const OUT_DIR = join(WEB_DIR, "data", "backtest-cv3");

function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(stamped);
  try {
    mkdirSync(join(WEB_DIR, "data"), { recursive: true });
    appendFileSync(LOG_FILE, stamped, "utf8");
  } catch {
    // no crítico
  }
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log("SIN TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID en .env.local — no se avisa por Telegram.");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ chat_id: chatId, text }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) log(`Telegram sendMessage falló: ${JSON.stringify(json)}`);
}

function round5(n: number) { return Math.round(n / 5) * 5; }

function etTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}

async function main() {
  const {
    fetchGexStats, fetchContractTradeSummary,
  } = await import("../../lib/marketsnack");
  const { fetchNestedOptionChain } = await import("../../lib/tastytrade");
  const { fetchBars } = await import("../../lib/massive");
  const { selectWeeklyExpirations } = await import("../../lib/grandesEmpresas");
  const {
    contratosVecinos3Signal, applyPersistence, summarizeActivity,
  } = await import("../../lib/contratosVecinos3");
  type ContratosVecinos3Signal = import("../../lib/contratosVecinos3").ContratosVecinos3Signal;
  type ActivityLevel = import("../../lib/contratosVecinos3").ActivityLevel;
  type TradeSummaryBucketLike = import("../../lib/contratosVecinos3").TradeSummaryBucketLike;

  interface ClockPoint { t: string; spot: number; }
  interface Episode {
    ticker: string; type: "call" | "put"; entryTime: string; entrySpot: number;
    target1: number; target2: number | null; stopLoss: number | null; stopLossType: "call" | "put" | null;
    exitTime: string | null; exitReason: string | null; exitSpot: number | null;
    target1Hit: { time: string; spot: number } | null;
    target2Hit: { time: string; spot: number } | null;
    stopHit: { time: string; spot: number } | null;
    outcome: string;
  }

  async function fetchStrikeBuckets(symbols: string[], period: string, concurrency = 10): Promise<Map<string, TradeSummaryBucketLike[]>> {
    const out = new Map<string, TradeSummaryBucketLike[]>();
    for (let i = 0; i < symbols.length; i += concurrency) {
      const chunk = symbols.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(async (sym) => {
        const buckets = await fetchContractTradeSummary(sym, { period });
        return [sym, buckets] as const;
      }));
      for (const [sym, buckets] of results) out.set(sym, buckets);
    }
    return out;
  }

  function activityUpTo(buckets: TradeSummaryBucketLike[], tIso: string) {
    const upTo = buckets.filter((b) => Date.parse(b.t) <= Date.parse(tIso));
    return summarizeActivity(upTo);
  }

  // `callBucketsByStrike`/`putBucketsByStrike`: buckets YA concatenados por
  // strike (si un strike tiene actividad repartida en VARIOS vencimientos
  // cercanos — caso real de TSLA/"Grandes empresas", ver más abajo — hay que
  // concatenar los buckets crudos de todos esos símbolos ANTES de
  // `summarizeActivity`, igual que hace `fetchContractActivitySummariesGrouped`
  // en producción; sumar resúmenes ya hechos por separado daría una
  // `trend` mal calculada). Para SPX (un solo símbolo por strike) esto es
  // simplemente un array de un elemento — mismo comportamiento de siempre.
  function buildLevels(
    strikes: number[], spot: number, side: "above" | "below",
    callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>,
    tIso: string,
  ): ActivityLevel[] {
    const sel = side === "above"
      ? strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, 10)
      : strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, 10);
    const primaryType: "call" | "put" = side === "above" ? "call" : "put";
    return sel.map((strike) => {
      const primaryBuckets = primaryType === "call" ? callBucketsByStrike.get(strike) ?? [] : putBucketsByStrike.get(strike) ?? [];
      const otherBuckets = primaryType === "call" ? putBucketsByStrike.get(strike) ?? [] : callBucketsByStrike.get(strike) ?? [];
      return {
        strike, type: primaryType,
        activity: activityUpTo(primaryBuckets, tIso),
        otherActivity: activityUpTo(otherBuckets, tIso),
      };
    });
  }

  function runReplay(
    ticker: string, clock: ClockPoint[], strikes: number[],
    callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>,
  ) {
    const history: ContratosVecinos3Signal[] = [];
    const readings: { t: string; spot: number; signal: ContratosVecinos3Signal; confirmed: boolean }[] = [];
    for (const point of clock) {
      const above = buildLevels(strikes, point.spot, "above", callBucketsByStrike, putBucketsByStrike, point.t);
      const below = buildLevels(strikes, point.spot, "below", callBucketsByStrike, putBucketsByStrike, point.t);
      const signal = contratosVecinos3Signal({ spot: point.spot, above, below });
      history.push(signal);
      const persistent = applyPersistence(history);
      readings.push({ t: point.t, spot: point.spot, signal: persistent, confirmed: persistent.confirmed });
    }

    const episodes: Episode[] = [];
    let current: Episode | null = null;

    function closeEpisode(ep: Episode, exitTime: string, exitReason: string, exitSpot: number) {
      ep.exitTime = exitTime; ep.exitReason = exitReason; ep.exitSpot = exitSpot;
      const windowPoints = clock.filter((p) => Date.parse(p.t) >= Date.parse(ep.entryTime) && Date.parse(p.t) <= Date.parse(exitTime));
      for (const p of windowPoints) {
        if (!ep.target1Hit) {
          const hit = ep.type === "call" ? p.spot >= ep.target1 : p.spot <= ep.target1;
          if (hit) ep.target1Hit = { time: p.t, spot: p.spot };
        }
        if (ep.target2 != null && !ep.target2Hit) {
          const hit2 = ep.type === "call" ? p.spot >= ep.target2 : p.spot <= ep.target2;
          if (hit2) ep.target2Hit = { time: p.t, spot: p.spot };
        }
        if (ep.stopLoss != null && !ep.stopHit) {
          const hitStop = ep.type === "call" ? p.spot <= ep.stopLoss : p.spot >= ep.stopLoss;
          if (hitStop) ep.stopHit = { time: p.t, spot: p.spot };
        }
      }
      const t1 = ep.target1Hit ? Date.parse(ep.target1Hit.time) : Infinity;
      const ts = ep.stopHit ? Date.parse(ep.stopHit.time) : Infinity;
      if (t1 < ts) ep.outcome = "GANADORA (tocó target1)";
      else if (ts < t1) ep.outcome = "PERDEDORA (tocó stop-loss)";
      else if (t1 === Infinity && ts === Infinity) ep.outcome = "SIN TOCAR (ni target1 ni stop-loss)";
      else ep.outcome = "EMPATE (mismo tick target1/stop-loss)";
      episodes.push(ep);
    }

    for (const r of readings) {
      if (r.confirmed && r.signal.type != null && r.signal.target1 != null) {
        if (current == null) {
          current = {
            ticker, type: r.signal.type, entryTime: r.t, entrySpot: r.spot,
            target1: r.signal.target1.strike, target2: r.signal.target2?.strike ?? null,
            stopLoss: r.signal.stopLoss?.strike ?? null, stopLossType: r.signal.stopLoss?.type ?? null,
            exitTime: null, exitReason: null, exitSpot: null,
            target1Hit: null, target2Hit: null, stopHit: null, outcome: "",
          };
        } else if (current.type !== r.signal.type) {
          closeEpisode(current, r.t, "reversal_confirmada", r.spot);
          current = {
            ticker, type: r.signal.type, entryTime: r.t, entrySpot: r.spot,
            target1: r.signal.target1.strike, target2: r.signal.target2?.strike ?? null,
            stopLoss: r.signal.stopLoss?.strike ?? null, stopLossType: r.signal.stopLoss?.type ?? null,
            exitTime: null, exitReason: null, exitSpot: null,
            target1Hit: null, target2Hit: null, stopHit: null, outcome: "",
          };
        }
      }
    }
    if (current) {
      const last = clock[clock.length - 1];
      closeEpisode(current, last.t, "cierre_de_mercado", last.spot);
    }
    return { episodes, totalReadings: readings.length, confirmedReadings: readings.filter((r) => r.confirmed).length };
  }

  // ─────────────────────────── SPX ───────────────────────────
  const gexAll = (await fetchGexStats("SPX", { period: "1d" })) as any[];
  if (gexAll.length === 0) {
    log("SPX: sin datos de gex_stats_chart todavía — abortando.");
    return;
  }
  const requestedDay = process.argv[2];
  const BACKTEST_DAY = requestedDay ?? gexAll[gexAll.length - 1].t.slice(0, 10);
  const gexDay = gexAll.filter((b) => String(b.t).startsWith(BACKTEST_DAY));
  log(`=== Backtest CV3 ${BACKTEST_DAY} — SPX: ${gexDay.length} puntos de reloj ===`);

  const spxClock: ClockPoint[] = gexDay.map((b: any) => ({ t: b.t, spot: b.asset_price }));
  const spxPrices = spxClock.map((p) => p.spot);
  const spxMin = Math.min(...spxPrices), spxMax = Math.max(...spxPrices);
  const spxLo = round5(spxMin - 50), spxHi = round5(spxMax + 50);
  const spxStrikes: number[] = [];
  for (let s = spxLo; s <= spxHi; s += 5) spxStrikes.push(s);

  const [y, m, d] = BACKTEST_DAY.split("-");
  const occDate = `${y.slice(2)}${m}${d}`;
  const spxCallSym = (s: number) => `SPXW${occDate}C${String(Math.round(s * 1000)).padStart(8, "0")}`;
  const spxPutSym = (s: number) => `SPXW${occDate}P${String(Math.round(s * 1000)).padStart(8, "0")}`;
  const spxSymbols = spxStrikes.flatMap((s) => [spxCallSym(s), spxPutSym(s)]);
  const spxAllBuckets = await fetchStrikeBuckets(spxSymbols, "1d");
  const spxCallBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
  const spxPutBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
  for (const s of spxStrikes) {
    spxCallBucketsByStrike.set(s, spxAllBuckets.get(spxCallSym(s)) ?? []);
    spxPutBucketsByStrike.set(s, spxAllBuckets.get(spxPutSym(s)) ?? []);
  }
  const spxResult = runReplay("SPX", spxClock, spxStrikes, spxCallBucketsByStrike, spxPutBucketsByStrike);
  log(`SPX: ${spxResult.episodes.length} episodios, ${spxResult.confirmedReadings}/${spxResult.totalReadings} lecturas confirmadas.`);

  // ─────────────────────────── TSLA ───────────────────────────
  const bars = await fetchBars("TSLA", 5, "minute", 10);
  const dayBars = bars.filter((b) => {
    const iso = new Date(b.time * 1000).toISOString();
    if (!iso.startsWith(BACKTEST_DAY)) return false;
    const hour = new Date(b.time * 1000).getUTCHours();
    const min = new Date(b.time * 1000).getUTCMinutes();
    const mins = hour * 60 + min;
    return mins >= 13 * 60 + 30 && mins <= 20 * 60;
  });
  const tslaClock: ClockPoint[] = dayBars.map((b) => ({ t: new Date(b.time * 1000).toISOString(), spot: b.close }));
  let tslaResult: ReturnType<typeof runReplay> = { episodes: [], totalReadings: 0, confirmedReadings: 0 };
  if (tslaClock.length > 0) {
    const tslaPrices = dayBars.flatMap((b) => [b.high, b.low]);
    const tslaMin = Math.min(...tslaPrices), tslaMax = Math.max(...tslaPrices);

    // MISMA lógica que el botón real "Grandes empresas" (app/api/grandes-
    // empresas/route.ts), no una simplificación propia — TSLA se opera ahí
    // con vencimientos SEMANALES (puede ser más de uno combinado, ver
    // `selectWeeklyExpirations`), nunca 0DTE. `now` se fija al día del
    // backtest (no al reloj real) para pedir la MISMA ventana de vencimientos
    // que se habría pedido ESE día — funciona porque esos vencimientos, al
    // ser de días después, siguen listados hoy en la cadena en vivo de
    // tastytrade (a diferencia del 0DTE de SPX, que ya venció y desapareció).
    const backtestNow = new Date(`${BACKTEST_DAY}T16:00:00Z`);
    const exps = await fetchNestedOptionChain("TSLA");
    const allExpirations = exps.map((e: any) => e["expiration-date"]);
    const nearExpirations = selectWeeklyExpirations(allExpirations, backtestNow);
    log(`TSLA vencimientos usados (selectWeeklyExpirations, como el día ${BACKTEST_DAY}): ${nearExpirations.join(", ")}`);
    const nearExpirationSet = new Set(nearExpirations);
    const nearChains = exps.filter((e: any) => nearExpirationSet.has(e["expiration-date"]));

    const tslaLo = tslaMin - 50, tslaHi = tslaMax + 50;
    // symbolsByStrikeType: strike|tipo -> TODOS los símbolos reales de ese
    // strike a través de los vencimientos cercanos combinados (puede ser más
    // de uno) — igual que `symbolsByStrikeType` en grandes-empresas/route.ts.
    const symbolsByStrikeType = new Map<string, string[]>();
    const strikeSet = new Set<number>();
    for (const chain of nearChains) {
      for (const s of chain.strikes ?? []) {
        const strike = parseFloat(s["strike-price"]);
        if (!(strike >= tslaLo && strike <= tslaHi)) continue;
        strikeSet.add(strike);
        if (s.call) {
          const key = `${strike}|call`;
          const arr = symbolsByStrikeType.get(key);
          const sym = s.call.replace(/\s+/g, "");
          if (arr) arr.push(sym); else symbolsByStrikeType.set(key, [sym]);
        }
        if (s.put) {
          const key = `${strike}|put`;
          const arr = symbolsByStrikeType.get(key);
          const sym = s.put.replace(/\s+/g, "");
          if (arr) arr.push(sym); else symbolsByStrikeType.set(key, [sym]);
        }
      }
    }
    const tslaStrikesNum = [...strikeSet];
    const tslaSymbols = [...symbolsByStrikeType.values()].flat();
    const tslaRawBuckets = await fetchStrikeBuckets(tslaSymbols, "1w");

    // Concatenar los buckets crudos de TODOS los símbolos de un strike|tipo
    // ANTES de sumarizar — mismo criterio que `fetchContractActivitySummariesGrouped`
    // (sumar resúmenes ya hechos por separado calcularía mal la `trend`).
    const tslaCallBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    const tslaPutBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    for (const strike of tslaStrikesNum) {
      const callSyms = symbolsByStrikeType.get(`${strike}|call`) ?? [];
      const putSyms = symbolsByStrikeType.get(`${strike}|put`) ?? [];
      const callBuckets = callSyms.flatMap((sym) => tslaRawBuckets.get(sym) ?? []).filter((b) => b.t.startsWith(BACKTEST_DAY));
      const putBuckets = putSyms.flatMap((sym) => tslaRawBuckets.get(sym) ?? []).filter((b) => b.t.startsWith(BACKTEST_DAY));
      tslaCallBucketsByStrike.set(strike, callBuckets);
      tslaPutBucketsByStrike.set(strike, putBuckets);
    }
    tslaResult = runReplay("TSLA", tslaClock, tslaStrikesNum, tslaCallBucketsByStrike, tslaPutBucketsByStrike);
  } else {
    log("TSLA: sin barras de Massive para este día todavía — se omite.");
  }
  log(`TSLA: ${tslaResult.episodes.length} episodios, ${tslaResult.confirmedReadings}/${tslaResult.totalReadings} lecturas confirmadas.`);

  // ─────────────────────────── Guardar + avisar ───────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${BACKTEST_DAY}.json`);
  writeFileSync(outPath, JSON.stringify({ backtestDay: BACKTEST_DAY, spx: spxResult, tsla: tslaResult }, null, 2), "utf8");
  log(`Guardado en ${outPath}`);

  function summarize(ticker: string, r: ReturnType<typeof runReplay>) {
    // `totalReadings === 0` = no hubo reloj (Massive todavía no publicó las
    // barras de hoy, ~1 día de atraso conocido) — distinto de "0 episodios"
    // reales, que sí significa que el motor corrió pero no confirmó ninguna
    // señal. Mezclarlos hace parecer un día sin actividad cuando en realidad
    // falta el dato — avisar la diferencia explícita en vez de mostrar 0W/0L.
    if (r.totalReadings === 0) {
      return { header: `${ticker}: sin datos todavía (la fuente de precio no publicó el día completo aún) — no es que no hubo señales, es que no se pudo correr.`, lines: [] };
    }
    const wins = r.episodes.filter((e) => e.outcome.startsWith("GANADORA")).length;
    const losses = r.episodes.filter((e) => e.outcome.startsWith("PERDEDORA")).length;
    const flat = r.episodes.length - wins - losses;
    const pct = r.episodes.length > 0 ? Math.round((wins / r.episodes.length) * 100) : 0;
    const lines = r.episodes.map((e) =>
      `${etTime(e.entryTime)} ${e.type.toUpperCase()} @${e.entrySpot.toFixed(2)} → target ${e.target1} · ${e.outcome}`);
    return { header: `${ticker}: ${r.episodes.length} episodios, ${wins}W/${losses}L/${flat} sin tocar (${pct}%)`, lines };
  }
  const spxSum = summarize("SPX", spxResult);
  const tslaSum = summarize("TSLA", tslaResult);
  const text = [
    `📊 Backtest Contratos vecinos 3.0 — ${BACKTEST_DAY}`,
    "",
    spxSum.header, ...spxSum.lines,
    "",
    tslaSum.header, ...tslaSum.lines,
  ].join("\n");
  log(text);
  await sendTelegram(text).catch((err) => log(`Error enviando Telegram: ${err}`));
}

main().catch((err) => {
  const msg = `ERROR: ${err?.stack ?? err}`;
  process.stderr.write(msg + "\n");
  try { appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`, "utf8"); } catch {}
  process.exit(1);
});
