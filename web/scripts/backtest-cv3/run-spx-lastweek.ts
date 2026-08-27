// Backtest de SPX para días viejos usando un reloj EXTERNO (Robinhood
// get_index_historicals, obtenido vía MCP en la sesión de Claude y volcado a
// scripts/backtest-cv3/spx-rh-clock.json) en vez de gex_stats_chart de
// MarketSnack — que solo puede dar el día más reciente, nunca uno a pedido
// (limitación real ya documentada). El flujo de opciones (net premium) SÍ
// sigue viniendo de MarketSnack (trade_summaries, period=1w, retiene ~5 días
// hábiles) — eso nunca fue el problema, solo el reloj de precio lo era.
//
// IMPORTANTE: esto es un método MANUAL para completar huecos puntuales del
// pasado, no reemplaza run.ts. Robinhood solo es accesible vía MCP dentro de
// una sesión de Claude — la tarea automática de Windows (que corre `tsx`
// standalone) no tiene ese acceso, así que esto no se puede "automatizar"
// sin una integración de credenciales propia que hoy no existe.
//
// Uso: node_modules/.bin/tsx scripts/backtest-cv3/run-spx-lastweek.ts

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
const MIN_MOVE_POINTS = 4; // ver run.ts — Carlos confirmó 4pts como objetivo real el 2026-08-26

function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(stamped);
  try {
    mkdirSync(join(WEB_DIR, "data"), { recursive: true });
    appendFileSync(LOG_FILE, stamped, "utf8");
  } catch {}
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) { log("SIN TELEGRAM — no se avisa."); return; }
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
  return new Intl.DateTimeFormat("es-AR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

async function main() {
  const { fetchContractTradeSummary } = await import("../../lib/marketsnack");
  const { contratosVecinos3Signal, applyPersistence, summarizeActivity } = await import("../../lib/contratosVecinos3");
  type ContratosVecinos3Signal = import("../../lib/contratosVecinos3").ContratosVecinos3Signal;
  type ActivityLevel = import("../../lib/contratosVecinos3").ActivityLevel;
  type TradeSummaryBucketLike = import("../../lib/contratosVecinos3").TradeSummaryBucketLike;

  interface ClockPoint { t: string; spot: number; }
  interface Episode {
    type: "call" | "put"; entryTime: string; entrySpot: number; target1: number; target2: number | null;
    exitTime: string; exitReason: string; exitSpot: number;
    target1Hit: { time: string; spot: number } | null;
    outcome: string; maxFavorableMove: number; reachedMinMove: boolean;
  }

  async function fetchStrikeBuckets(symbols: string[], period: string, concurrency = 10): Promise<Map<string, TradeSummaryBucketLike[]>> {
    const out = new Map<string, TradeSummaryBucketLike[]>();
    for (let i = 0; i < symbols.length; i += concurrency) {
      const chunk = symbols.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(async (sym) => [sym, await fetchContractTradeSummary(sym, { period })] as const));
      for (const [sym, buckets] of results) out.set(sym, buckets);
    }
    return out;
  }

  function activityUpTo(buckets: TradeSummaryBucketLike[], tIso: string) {
    return summarizeActivity(buckets.filter((b) => Date.parse(b.t) <= Date.parse(tIso)));
  }

  function buildLevels(
    strikes: number[], spot: number, side: "above" | "below",
    callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, tIso: string,
  ): ActivityLevel[] {
    const sel = side === "above"
      ? strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, 10)
      : strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, 10);
    const primaryType: "call" | "put" = side === "above" ? "call" : "put";
    return sel.map((strike) => {
      const primaryBuckets = primaryType === "call" ? callBucketsByStrike.get(strike) ?? [] : putBucketsByStrike.get(strike) ?? [];
      const otherBuckets = primaryType === "call" ? putBucketsByStrike.get(strike) ?? [] : callBucketsByStrike.get(strike) ?? [];
      return { strike, type: primaryType, activity: activityUpTo(primaryBuckets, tIso), otherActivity: activityUpTo(otherBuckets, tIso) };
    });
  }

  function runReplay(clock: ClockPoint[], strikes: number[], callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>) {
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
      let target1Hit: { time: string; spot: number } | null = null;
      for (const p of windowPoints) {
        const favorable = ep.type === "call" ? p.spot - ep.entrySpot : ep.entrySpot - p.spot;
        if (favorable > ep.maxFavorableMove) ep.maxFavorableMove = favorable;
        if (!target1Hit) {
          const hit = ep.type === "call" ? p.spot >= ep.target1 : p.spot <= ep.target1;
          if (hit) target1Hit = { time: p.t, spot: p.spot };
        }
      }
      ep.target1Hit = target1Hit;
      ep.outcome = target1Hit ? "GANADORA (tocó target1)" : "SIN TOCAR (ni target1 ni stop-loss)";
      ep.reachedMinMove = ep.maxFavorableMove >= MIN_MOVE_POINTS;
      episodes.push(ep);
    }
    for (const r of readings) {
      if (r.confirmed && r.signal.type != null && r.signal.target1 != null) {
        if (current == null || current.type !== r.signal.type) {
          if (current) closeEpisode(current, r.t, "reversal_confirmada", r.spot);
          current = {
            type: r.signal.type, entryTime: r.t, entrySpot: r.spot,
            target1: r.signal.target1.strike, target2: r.signal.target2?.strike ?? null,
            exitTime: "", exitReason: "", exitSpot: 0, target1Hit: null, outcome: "", maxFavorableMove: 0, reachedMinMove: false,
          };
        }
      }
    }
    if (current) closeEpisode(current, clock[clock.length - 1].t, "cierre_de_mercado", clock[clock.length - 1].spot);
    return { episodes, totalReadings: readings.length, confirmedReadings: readings.filter((r) => r.confirmed).length };
  }

  const clockByDay: Record<string, ClockPoint[]> = JSON.parse(readFileSync(join(WEB_DIR, "scripts/backtest-cv3/spx-rh-clock.json"), "utf8"));

  for (const day of Object.keys(clockByDay).sort()) {
    const spxClock = clockByDay[day];
    const spxPrices = spxClock.map((p) => p.spot);
    const lo = round5(Math.min(...spxPrices) - 50), hi = round5(Math.max(...spxPrices) + 50);
    const strikes: number[] = [];
    for (let s = lo; s <= hi; s += 5) strikes.push(s);

    const [y, m, d] = day.split("-");
    const occDate = `${y.slice(2)}${m}${d}`;
    const callSym = (s: number) => `SPXW${occDate}C${String(Math.round(s * 1000)).padStart(8, "0")}`;
    const putSym = (s: number) => `SPXW${occDate}P${String(Math.round(s * 1000)).padStart(8, "0")}`;
    const symbols = strikes.flatMap((s) => [callSym(s), putSym(s)]);
    const allBuckets = await fetchStrikeBuckets(symbols, "1w");
    const callBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    const putBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    for (const s of strikes) {
      callBucketsByStrike.set(s, (allBuckets.get(callSym(s)) ?? []).filter((b) => b.t.startsWith(day)));
      putBucketsByStrike.set(s, (allBuckets.get(putSym(s)) ?? []).filter((b) => b.t.startsWith(day)));
    }

    const result = runReplay(spxClock, strikes, callBucketsByStrike, putBucketsByStrike);
    mkdirSync(OUT_DIR, { recursive: true });
    const outPath = join(OUT_DIR, `${day}.json`);
    let existing: any = {};
    try { existing = JSON.parse(readFileSync(outPath, "utf8")); } catch {}
    existing.backtestDay = day;
    existing.spx = result;
    writeFileSync(outPath, JSON.stringify(existing, null, 2), "utf8");
    log(`Guardado SPX (reloj Robinhood) en ${outPath}`);

    const wins = result.episodes.filter((e) => e.outcome.startsWith("GANADORA")).length;
    const minMoveCount = result.episodes.filter((e) => e.reachedMinMove).length;
    const pct = result.episodes.length > 0 ? Math.round((wins / result.episodes.length) * 100) : 0;
    const minMovePct = result.episodes.length > 0 ? Math.round((minMoveCount / result.episodes.length) * 100) : 0;
    const lines = result.episodes.map((e) =>
      `${etTime(e.entryTime)} ${e.type.toUpperCase()} @${e.entrySpot.toFixed(2)} → target ${e.target1} · ${e.outcome} · máx a favor ${e.maxFavorableMove.toFixed(2)}pts${e.reachedMinMove ? ` ✅≥${MIN_MOVE_POINTS}` : ""}`);
    const header = `SPX: ${result.episodes.length} episodios, ${wins}W/${result.episodes.length - wins}L·sin tocar (${pct}%) · ${minMoveCount}/${result.episodes.length} llegaron a ≥${MIN_MOVE_POINTS}pts reales (${minMovePct}%)`;
    const text = [`📊 Backtest CV3 SPX (reloj Robinhood) — ${day}`, "", header, ...lines].join("\n");
    log(text);
    await sendTelegram(text).catch((err) => log(`Error Telegram: ${err}`));
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err?.stack ?? err}\n`);
  process.exit(1);
});
