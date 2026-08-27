// Experimento (no toca producción, no manda Telegram, no escribe data/):
// prueba distintos valores de PERSISTENCE_REQUIRED SOLO para TSLA contra los
// días ya reales que tiene la bitácora, para ver si sube el % de episodios
// que llegan al objetivo real de Carlos (≥5 puntos de movimiento real,
// MFE — ver run.ts) sin perder los que ya funcionan. Pedido explícito
// 2026-08-25/26, tras encontrar que con PERSISTENCE_REQUIRED=3 (el valor de
// producción, igual para índice y acciones) TSLA solo llegó a 5+ puntos en
// 1 de 12 episodios reales (8%) entre el 24 y 25-ago.
//
// Uso: node_modules/.bin/tsx scripts/backtest-cv3/experiment-persistence.ts

import { readFileSync } from "fs";
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

const MIN_MOVE_POINTS = 4; // ver run.ts — Carlos confirmó 4pts como objetivo real el 2026-08-26
const CANDIDATE_PERSISTENCE = [3, 4, 5, 6, 7, 8];
const DAYS = ["2026-08-24", "2026-08-25"];

async function main() {
  const {
    fetchContractTradeSummary, fetchAssetPriceChart,
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
    type: "call" | "put"; entryTime: string; entrySpot: number;
    target1: number;
    outcome: string;
    maxFavorableMove: number;
    reachedMinMove: boolean;
  }
  interface DayData {
    clock: ClockPoint[];
    strikes: number[];
    callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>;
    putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>;
  }

  function inRegularHours(iso: string): boolean {
    const d = new Date(iso);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
    return mins >= 13 * 60 + 30 && mins <= 20 * 60; // 9:30-16:00 ET (horario de verano)
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

  // Réplica exacta de la sección TSLA de run.ts — mismo motor de datos
  // (MarketSnack primero, Massive de respaldo, vencimientos semanales reales
  // vía selectWeeklyExpirations), solo que acá se fetchea UNA vez por día y
  // se reusa para todos los valores de persistencia que se prueben.
  async function fetchTslaDayData(day: string): Promise<DayData> {
    const msChart = await fetchAssetPriceChart("TSLA");
    let dayPoints: { t: string; spot: number }[] = msChart
      .filter((p) => p.t.startsWith(day) && inRegularHours(p.t))
      .map((p) => ({ t: p.t, spot: p.v }));
    if (dayPoints.length === 0) {
      const bars = await fetchBars("TSLA", 5, "minute", 10);
      dayPoints = bars
        .filter((b) => new Date(b.time * 1000).toISOString().startsWith(day) && inRegularHours(new Date(b.time * 1000).toISOString()))
        .map((b) => ({ t: new Date(b.time * 1000).toISOString(), spot: b.close }));
    }
    if (dayPoints.length === 0) return { clock: [], strikes: [], callBucketsByStrike: new Map(), putBucketsByStrike: new Map() };

    const prices = dayPoints.map((p) => p.spot);
    const lo = Math.min(...prices) - 50, hi = Math.max(...prices) + 50;

    const backtestNow = new Date(`${day}T16:00:00Z`);
    const exps = await fetchNestedOptionChain("TSLA");
    const allExpirations = exps.map((e: any) => e["expiration-date"]);
    const nearExpirations = selectWeeklyExpirations(allExpirations, backtestNow);
    const nearExpirationSet = new Set(nearExpirations);
    const nearChains = exps.filter((e: any) => nearExpirationSet.has(e["expiration-date"]));

    const symbolsByStrikeType = new Map<string, string[]>();
    const strikeSet = new Set<number>();
    for (const chain of nearChains) {
      for (const s of chain.strikes ?? []) {
        const strike = parseFloat(s["strike-price"]);
        if (!(strike >= lo && strike <= hi)) continue;
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
    const strikesNum = [...strikeSet];
    const symbols = [...symbolsByStrikeType.values()].flat();
    const rawBuckets = await fetchStrikeBuckets(symbols, "1w");

    const callBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    const putBucketsByStrike = new Map<number, TradeSummaryBucketLike[]>();
    for (const strike of strikesNum) {
      const callSyms = symbolsByStrikeType.get(`${strike}|call`) ?? [];
      const putSyms = symbolsByStrikeType.get(`${strike}|put`) ?? [];
      callBucketsByStrike.set(strike, callSyms.flatMap((sym) => rawBuckets.get(sym) ?? []).filter((b) => b.t.startsWith(day)));
      putBucketsByStrike.set(strike, putSyms.flatMap((sym) => rawBuckets.get(sym) ?? []).filter((b) => b.t.startsWith(day)));
    }
    return { clock: dayPoints, strikes: strikesNum, callBucketsByStrike, putBucketsByStrike };
  }

  function activityUpTo(buckets: TradeSummaryBucketLike[], tIso: string) {
    return summarizeActivity(buckets.filter((b) => Date.parse(b.t) <= Date.parse(tIso)));
  }

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

  // Misma lógica de episodios que run.ts, parametrizada por
  // `persistenceRequired` (en vez de leer la constante fija del módulo).
  function runReplay(clock: ClockPoint[], strikes: number[],
    callBucketsByStrike: Map<number, TradeSummaryBucketLike[]>, putBucketsByStrike: Map<number, TradeSummaryBucketLike[]>,
    persistenceRequired: number,
  ) {
    const history: ContratosVecinos3Signal[] = [];
    const readings: { t: string; spot: number; signal: ContratosVecinos3Signal; confirmed: boolean }[] = [];
    for (const point of clock) {
      const above = buildLevels(strikes, point.spot, "above", callBucketsByStrike, putBucketsByStrike, point.t);
      const below = buildLevels(strikes, point.spot, "below", callBucketsByStrike, putBucketsByStrike, point.t);
      const signal = contratosVecinos3Signal({ spot: point.spot, above, below });
      history.push(signal);
      const persistent = applyPersistence(history, persistenceRequired);
      readings.push({ t: point.t, spot: point.spot, signal: persistent, confirmed: persistent.confirmed });
    }

    const episodes: Episode[] = [];
    let current: Episode | null = null;

    function closeEpisode(ep: Episode, exitTime: string) {
      const windowPoints = clock.filter((p) => Date.parse(p.t) >= Date.parse(ep.entryTime) && Date.parse(p.t) <= Date.parse(exitTime));
      let target1Hit = false;
      for (const p of windowPoints) {
        const favorable = ep.type === "call" ? p.spot - ep.entrySpot : ep.entrySpot - p.spot;
        if (favorable > ep.maxFavorableMove) ep.maxFavorableMove = favorable;
        if (!target1Hit) {
          const hit = ep.type === "call" ? p.spot >= ep.target1 : p.spot <= ep.target1;
          if (hit) target1Hit = true;
        }
      }
      ep.outcome = target1Hit ? "GANADORA" : "SIN TOCAR";
      ep.reachedMinMove = ep.maxFavorableMove >= MIN_MOVE_POINTS;
      episodes.push(ep);
    }

    for (const r of readings) {
      if (r.confirmed && r.signal.type != null && r.signal.target1 != null) {
        if (current == null || current.type !== r.signal.type) {
          if (current) closeEpisode(current, r.t);
          current = {
            type: r.signal.type, entryTime: r.t, entrySpot: r.spot,
            target1: r.signal.target1.strike,
            outcome: "", maxFavorableMove: 0, reachedMinMove: false,
          };
        }
      }
    }
    if (current) closeEpisode(current, clock[clock.length - 1].t);
    return episodes;
  }

  console.log("Descargando datos reales de TSLA (24-ago y 25-ago) una sola vez...");
  const dayData = new Map<string, DayData>();
  for (const day of DAYS) {
    const d = await fetchTslaDayData(day);
    dayData.set(day, d);
    console.log(`  ${day}: ${d.clock.length} puntos de reloj, ${d.strikes.length} strikes.`);
  }

  console.log("\nPERSISTENCE_REQUIRED | episodios | ganadoras (tocó target1) | llegaron a ≥5pts reales");
  console.log("-".repeat(80));
  for (const p of CANDIDATE_PERSISTENCE) {
    let totalEpisodes = 0, wins = 0, minMoveCount = 0;
    const detail: string[] = [];
    for (const day of DAYS) {
      const d = dayData.get(day)!;
      if (d.clock.length === 0) continue;
      const episodes = runReplay(d.clock, d.strikes, d.callBucketsByStrike, d.putBucketsByStrike, p);
      totalEpisodes += episodes.length;
      wins += episodes.filter((e) => e.outcome === "GANADORA").length;
      minMoveCount += episodes.filter((e) => e.reachedMinMove).length;
      detail.push(`${day}: ${episodes.length} ep (${episodes.filter((e) => e.reachedMinMove).length} ≥5pts)`);
    }
    const minMovePct = totalEpisodes > 0 ? Math.round((minMoveCount / totalEpisodes) * 100) : 0;
    const winPct = totalEpisodes > 0 ? Math.round((wins / totalEpisodes) * 100) : 0;
    console.log(
      `${String(p).padStart(20)} | ${String(totalEpisodes).padStart(9)} | ${wins}/${totalEpisodes} (${winPct}%)`.padEnd(60) +
      `| ${minMoveCount}/${totalEpisodes} (${minMovePct}%)   [${detail.join(" · ")}]`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err?.stack ?? err}\n`);
  process.exit(1);
});
