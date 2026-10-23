// Backtest AD-HOC (no productivo, se puede borrar): "cuántas entradas me hubiese
// dado el motor 0DTE hoy en SPX" — pedido de Carlos, 2026-09-02.
//
// Reconstruye la sesión REAL de hoy con datos reales de MarketSnack:
//  - fetchGexStats("SPX"): serie de 5 min YA calculada por MarketSnack (net_gex,
//    call_wall, put_wall, magnet, gamma_flip, asset_price) — no hace falta
//    reconstruir GEX a mano, MarketSnack la da hecha.
//  - fetchContractTradeSummary por strike (ask/bid premium de 5 min) sobre un
//    puñado de strikes cerca del dinero, para aproximar el flujo agresivo
//    (burstBull/burstBear) que usa momentumEntry/gateEntry en vivo.
//
// Corre EXACTAMENTE las mismas funciones puras que usa la app en producción
// (evaluateEntry/gateEntry/dynamicParams de zerodteStrategy.ts, momentumEntry
// de zerodteAlt.ts) — no son una reimplementación paralela.
//
// LIMITACIONES DECLARADAS (no se ocultan en el reporte):
//  1. El GEX es el de MarketSnack (real, de su propia cadena), NO el de Schwab
//     que usa la pestaña 0DTE en vivo — pueden diferir en el margen.
//  2. La IV es REALIZADA (de la propia serie de precio de hoy), no implícita —
//     no había snapshot de greeks históricos de hoy guardado en ningún lado.
//  3. burstBull/burstBear/velocity son una aproximación por bucket de 5 min
//     (ask/bid premium de ese bucket en unos pocos strikes cerca del spot), no
//     la ventana rodante en vivo que arma zerodteFlow.ts en el navegador.
//  4. Sin captura en vivo de hoy (nadie tuvo la pestaña abierta), esta es la
//     única reconstrucción posible — Schwab no tiene API de cadena histórica.
//  5. La comparación "momentum crudo vs. con persistencia" usa buckets de 5
//     min (lo único que da gex_stats_chart), así que MOMENTUM_PERSISTENCE_
//     REQUIRED=3 acá equivale a 15 min sostenidos, NO a los ~3 min reales de
//     producción (que samplea ~1/min, ver OdteStandaloneTab.tsx). Sirve para
//     ver la FORMA del filtro (cuántos parpadeos corta), no para medir el
//     tiempo real que tarda en confirmar en vivo.
//
// Uso: npx tsx scripts/backtest-spx-0dte-today.ts

import { readFileSync } from "fs";
import { join } from "path";
import type { EntryDecision, FlowCtx } from "../lib/odteStandalone/zerodteStrategy";
import type { AltFlowCtx } from "../lib/odteStandalone/zerodteAlt";

// Mismo patrón que scripts/backtest-cv3/*.ts: cargar .env.local a mano porque
// tsx no pasa por el bootstrap de Next.
try {
  for (const rawLine of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
} catch { /* .env.local ausente: la cookie puede venir igual de data/marketsnack-cookie.json */ }

async function main() {
  const { fetchGexStats, fetchContractTradeSummary } = await import("../lib/marketsnack");
  const { buildOccSymbol } = await import("../lib/occ");
  const { expectedMove } = await import("../lib/odteStandalone/expectedMove");
  const { evaluateEntry, gateEntry, dynamicParams } = await import("../lib/odteStandalone/zerodteStrategy");
  const { momentumEntry, MOMENTUM_DEFAULTS, confirmMomentum, MOMENTUM_PERSISTENCE_REQUIRED } = await import("../lib/odteStandalone/zerodteAlt");

  const TICKER = "SPX";
  const OCC_ROOT = "SPXW"; // ver memoria: SPX cotiza bajo SPXW en OCC

  console.log("Descargando gex_stats_chart (real, MarketSnack) para SPX...");
  const raw = await fetchGexStats(TICKER, { period: "1d" });
  if (raw.length === 0) {
    console.log("Sin datos de gex_stats_chart hoy (cookie inválida o sin datos). Abortando.");
    return;
  }

  const etParts = (iso: string) => {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return { date: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`, h: get("hour") === 24 ? 0 : get("hour"), m: get("minute") };
  };

  // La sesión objetivo es la del bucket MÁS RECIENTE, no la fecha del reloj —
  // pasada la medianoche ET el reloj ya dice "mañana" aunque gex_stats_chart
  // (period=1d) siga devolviendo la última sesión real (hoy en el sentido de
  // Carlos: la que acaba de cerrar).
  const todayEt = etParts(raw[raw.length - 1].t).date;

  // Solo sesión regular de esa fecha (9:30-16:00 ET) — pre/after-market no
  // aplica al motor 0DTE intradía.
  const session = raw
    .map((b) => ({ ...b, _et: etParts(b.t), sec: Math.floor(new Date(b.t).getTime() / 1000) }))
    .filter((b) => b._et.date === todayEt && (b._et.h > 9 || (b._et.h === 9 && b._et.m >= 30)) && b._et.h < 16)
    .sort((a, b) => a.sec - b.sec);

  if (session.length === 0) {
    console.log(`Sin buckets de la sesión regular de hoy (${todayEt}) en gex_stats_chart. ¿Ya rotó al día siguiente? Abortando.`);
    return;
  }

  console.log(`Sesión de hoy (${todayEt}): ${session.length} buckets de 5 min, spot ${session[0].asset_price} -> ${session[session.length - 1].asset_price}.`);

  // ---- IV realizada de HOY (no hay implícita histórica guardada) ----
  const rets: number[] = [];
  for (let i = 1; i < session.length; i++) {
    rets.push(Math.log(session[i].asset_price / session[i - 1].asset_price));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
  const BARS_PER_YEAR = 78 * 252; // 78 barras de 5 min por sesión regular (6.5h) x 252 días
  const iv = Math.max(0.03, Math.sqrt(Math.max(variance, 0)) * Math.sqrt(BARS_PER_YEAR));
  console.log(`IV realizada estimada de hoy: ${(iv * 100).toFixed(1)}%`);

  // ---- Flujo agresivo aproximado: strikes cerca del rango real del día ----
  const spots = session.map((s) => s.asset_price);
  const lo5 = Math.floor(Math.min(...spots) / 5) * 5;
  const hi5 = Math.ceil(Math.max(...spots) / 5) * 5;
  const strikes: number[] = [];
  for (let k = lo5 - 20; k <= hi5 + 20; k += 5) strikes.push(k);
  console.log(`Descargando trade_summaries de ${strikes.length * 2} contratos (${strikes[0]}-${strikes[strikes.length - 1]}, calls+puts)...`);

  type Bucket = { ask_premium: number; bid_premium: number };
  const callBuckets = new Map<number, Map<number, Bucket>>(); // strike -> sec -> bucket
  const putBuckets = new Map<number, Map<number, Bucket>>();

  async function fetchSide(strike: number, type: "call" | "put") {
    const sym = buildOccSymbol({ underlying: OCC_ROOT, expiration: todayEt, type, strike });
    try {
      const buckets = await fetchContractTradeSummary(sym, { period: "1d" });
      const m = new Map<number, Bucket>();
      for (const b of buckets) {
        const sec = Math.floor(new Date(b.t).getTime() / 1000);
        m.set(sec, { ask_premium: b.ask_premium, bid_premium: b.bid_premium });
      }
      (type === "call" ? callBuckets : putBuckets).set(strike, m);
    } catch (e) {
      console.log(`  aviso: ${sym} falló (${(e as Error).message}) — se ignora ese strike.`);
    }
  }

  const CONCURRENCY = 6;
  const jobs: Array<() => Promise<void>> = [];
  for (const k of strikes) { jobs.push(() => fetchSide(k, "call")); jobs.push(() => fetchSide(k, "put")); }
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(jobs.slice(i, i + CONCURRENCY).map((j) => j()));
  }

  // Ventana "cerca del dinero" para sumar flujo agresivo en cada bucket.
  const NEAR_PCT = 0.006; // ±0.6% del spot de ese momento

  function flowAt(sec: number, spot: number): { burstBull: number; burstBear: number; total: number } {
    let burstBull = 0, burstBear = 0, total = 0;
    const near = (k: number) => Math.abs(k - spot) <= spot * NEAR_PCT;
    for (const [k, m] of callBuckets) {
      if (!near(k)) continue;
      const b = m.get(sec);
      if (!b) continue;
      burstBull += b.ask_premium; burstBear += b.bid_premium; total += b.ask_premium + b.bid_premium;
    }
    for (const [k, m] of putBuckets) {
      if (!near(k)) continue;
      const b = m.get(sec);
      if (!b) continue;
      burstBear += b.ask_premium; burstBull += b.bid_premium; total += b.ask_premium + b.bid_premium;
    }
    return { burstBull, burstBear, total };
  }

  // ---- Recorre la sesión bucket a bucket, calculando regime/entry/momentum ----
  interface Row {
    sec: number; spot: number; regime: "positive" | "negative";
    magnet: number | null; flip: number | null; callWall: number | null; putWall: number | null;
    sigma: number; burstBull: number; burstBear: number; velocity: number;
  }
  const rows: Row[] = [];
  const totals: number[] = [];
  for (const b of session) {
    const et = etParts(b.t);
    const minutesLeft = Math.max(0, (16 * 60 - (et.h * 60 + et.m)));
    const days = minutesLeft / 1440;
    const em = expectedMove(b.asset_price, iv, days);
    const flip = b.gamma_flip;
    const regime: "positive" | "negative" = flip != null
      ? (b.asset_price >= flip ? "positive" : "negative")
      : (b.net_gex >= 0 ? "positive" : "negative");
    const f = flowAt(b.sec, b.asset_price);
    totals.push(f.total);
    const recentAvg = totals.length > 6
      ? totals.slice(-7, -1).reduce((a, x) => a + x, 0) / 6
      : null;
    const velocity = recentAvg && recentAvg > 0 ? Math.min(5, f.total / recentAvg) : 1;
    rows.push({
      sec: b.sec, spot: b.asset_price, regime, magnet: b.magnet, flip,
      callWall: b.call_wall, putWall: b.put_wall, sigma: em.sigma,
      burstBull: f.burstBull, burstBear: f.burstBear, velocity,
    });
  }

  // ---- FADE (γ+) — evaluateEntry + gateEntry, mismas funciones que produccion ----
  type Sig = { d: "long" | "short"; tgt: number; stop: number };
  const sameSig = (a: Sig | null, b: Sig | null) => !!a && !!b && a.d === b.d && Math.abs(a.tgt - b.tgt) <= 1;
  const resolve = (open: { sec: number } & Sig, series: { sec: number; spot: number }[]) => {
    for (const s of series) {
      if (s.sec <= open.sec) continue;
      if (open.d === "long") { if (s.spot >= open.tgt) return "win" as const; if (s.spot <= open.stop) return "loss" as const; }
      else { if (s.spot <= open.tgt) return "win" as const; if (s.spot >= open.stop) return "loss" as const; }
    }
    return "open" as const;
  };

  const params = dynamicParams(rows[0].spot, rows[0].sigma, "SPX");
  type FadeSignal = { sec: number; entry: EntryDecision; status: "ready" | "wait"; rr: number; reason: string };
  const fadeAll: FadeSignal[] = [];
  let prevFade: EntryDecision | null = null;
  for (const r of rows) {
    const entry = evaluateEntry(r.spot, r.regime, r.magnet, r.flip, params);
    if (entry && !sameSig(prevFade ? { d: prevFade.direction, tgt: prevFade.target, stop: prevFade.stop } : null, { d: entry.direction, tgt: entry.target, stop: entry.stop })) {
      const ctx: FlowCtx = { cvd: null, velocity: r.velocity, burstBull: r.burstBull, burstBear: r.burstBear, netGex: null };
      const verdict = gateEntry(entry, ctx, r.flip, params);
      fadeAll.push({ sec: r.sec, entry, status: verdict.status, rr: verdict.rr, reason: verdict.reason });
    }
    prevFade = entry;
  }
  const fadeReady = fadeAll.filter((f) => f.status === "ready");
  const fadeResults = fadeReady.map((f) => resolve({ sec: f.sec, d: f.entry.direction, tgt: f.entry.target, stop: f.entry.stop }, rows));

  // ---- MOMENTUM (γ−) — momentumEntry, misma función que produccion ----
  // Se calcula la lectura CRUDA de cada minuto y, además, la versión con el
  // gate de PERSISTENCIA (confirmMomentum, agregado en esta sesión — ver
  // [[visionary_trades_odte_standalone_engine]]): la misma señal debe
  // sostenerse MOMENTUM_PERSISTENCE_REQUIRED lecturas seguidas antes de
  // contar como trade. Se reportan ambas para comparar "como estaba" vs.
  // "con persistencia" sobre el mismo día real.
  type MomSignal = { sec: number; entry: EntryDecision };
  const momAll: MomSignal[] = [];
  const momAllPersisted: MomSignal[] = [];
  let prevMom: EntryDecision | null = null;
  let prevMomPersisted: EntryDecision | null = null;
  const rawHistory: (EntryDecision | null)[] = [];
  for (const r of rows) {
    if (r.regime !== "negative") { prevMom = null; prevMomPersisted = null; rawHistory.length = 0; continue; }
    const ctx: AltFlowCtx = {
      regime: r.regime, cvd: null, cvdDom: null, velocity: r.velocity,
      burstBull: r.burstBull, burstBear: r.burstBear, netGex: null,
      spot: r.spot, magnet: r.magnet, sigma: r.sigma,
    };
    const entry = momentumEntry(ctx, r.callWall, r.putWall, r.flip, MOMENTUM_DEFAULTS);
    if (entry && !sameSig(prevMom ? { d: prevMom.direction, tgt: prevMom.target, stop: prevMom.stop } : null, { d: entry.direction, tgt: entry.target, stop: entry.stop })) {
      momAll.push({ sec: r.sec, entry });
    }
    prevMom = entry;

    rawHistory.push(entry);
    const confirmed = confirmMomentum(rawHistory, MOMENTUM_PERSISTENCE_REQUIRED);
    if (confirmed && !sameSig(prevMomPersisted ? { d: prevMomPersisted.direction, tgt: prevMomPersisted.target, stop: prevMomPersisted.stop } : null, { d: confirmed.direction, tgt: confirmed.target, stop: confirmed.stop })) {
      momAllPersisted.push({ sec: r.sec, entry: confirmed });
    }
    prevMomPersisted = confirmed;
  }
  const momResults = momAll.map((m) => resolve({ sec: m.sec, d: m.entry.direction, tgt: m.entry.target, stop: m.entry.stop }, rows));
  const momResultsPersisted = momAllPersisted.map((m) => resolve({ sec: m.sec, d: m.entry.direction, tgt: m.entry.target, stop: m.entry.stop }, rows));

  // ---- Reporte ----
  const fmtT = (sec: number) => new Date(sec * 1000).toLocaleTimeString("es-AR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
  const negMinutes = rows.filter((r) => r.regime === "negative").length * 5;
  const posMinutes = rows.filter((r) => r.regime === "positive").length * 5;

  console.log("\n================ RESULTADO ================");
  console.log(`Régimen hoy: ${posMinutes} min en γ+ / ${negMinutes} min en γ− (de ~390 min de sesión regular).`);

  console.log(`\n--- GEX Trade (fade γ+): ${fadeAll.length} setups detectados, ${fadeReady.length} habrían pasado el gate ("listos") ---`);
  fadeReady.forEach((f, i) => {
    console.log(`  ${i + 1}. ${fmtT(f.sec)} ET  ${f.entry.direction.toUpperCase()}  entry ${f.entry.entry.toFixed(0)} -> target ${f.entry.target.toFixed(0)} / stop ${f.entry.stop.toFixed(0)}  R:B ${f.rr.toFixed(2)}  => ${fadeResults[i].toUpperCase()}`);
  });
  if (fadeAll.length > fadeReady.length) {
    console.log(`  (${fadeAll.length - fadeReady.length} setup(s) adicionales quedaron en "esperar" por el gate — R:B bajo, flip en medio o flujo en contra.)`);
  }

  console.log(`\n--- GEX Trade Alternate (momentum γ−, CRUDO — como estaba antes de esta sesión): ${momAll.length} entradas ---`);
  momAll.forEach((m, i) => {
    console.log(`  ${i + 1}. ${fmtT(m.sec)} ET  ${m.entry.direction.toUpperCase()}  entry ${m.entry.entry.toFixed(0)} -> target ${m.entry.target.toFixed(0)} / stop ${m.entry.stop.toFixed(0)}  => ${momResults[i].toUpperCase()}`);
  });

  console.log(`\n--- GEX Trade Alternate (momentum γ−, CON PERSISTENCIA — ${MOMENTUM_PERSISTENCE_REQUIRED} lecturas seguidas): ${momAllPersisted.length} entradas ---`);
  momAllPersisted.forEach((m, i) => {
    console.log(`  ${i + 1}. ${fmtT(m.sec)} ET  ${m.entry.direction.toUpperCase()}  entry ${m.entry.entry.toFixed(0)} -> target ${m.entry.target.toFixed(0)} / stop ${m.entry.stop.toFixed(0)}  => ${momResultsPersisted[i].toUpperCase()}`);
  });
  if (momAll.length > 0 && momAllPersisted.length === 0) {
    console.log("  (la persistencia filtró TODAS las entradas crudas de hoy — o fueron parpadeos de <3 min, o el día no acumuló suficientes lecturas γ− todavía.)");
  }

  const wins = (rs: ("win" | "loss" | "open")[]) => rs.filter((r) => r === "win").length;
  const resolved = (rs: ("win" | "loss" | "open")[]) => rs.filter((r) => r !== "open").length;
  console.log(`\nResumen: fade ${wins(fadeResults)}/${resolved(fadeResults)} ganadas (resueltas) · momentum crudo ${wins(momResults)}/${resolved(momResults)} ganadas (resueltas) · momentum con persistencia ${wins(momResultsPersisted)}/${resolved(momResultsPersisted)} ganadas (resueltas).`);
  console.log("\nOJO — limitaciones de esta reconstrucción (ver cabecera del script): GEX de MarketSnack (no Schwab),");
  console.log("IV realizada (no implícita), y flujo agresivo aproximado por bucket de 5 min en strikes cercanos —");
  console.log("no es un replay exacto de lo que la pestaña en vivo habría mostrado minuto a minuto.");
}

main().catch((e) => { console.error(e); process.exit(1); });
