// Datos y guardado del pre-mercado de VisionFutura (motor puro en visionFuturaPremarket.ts).
//
// Precio implícito antes de la apertura:
//   SPX/NQ: cierre anterior del índice + (futuro ahora − futuro a las 4 pm del día anterior),
//           con /ES y /NQ de tastytrade y sus velas de 5 min (DXLink).
//   TSLA:   precio extendido de MarketSnack (ya resuelve el pre-market).
// Movimiento esperado (1σ de la sesión):
//   SPX: straddle ATM real del 0DTE (las SPXW cotizan de noche, sesión GTH) ÷ 0.8.
//   Resto / sin straddle: IV ATM de la cadena × √(tiempo al vencimiento ÷ sesiones que faltan).
// OI por strike: cadena extendida de MarketSnack del vencimiento del día.
// "Posiciones nuevas": se guardan versiones del OI por vencimiento (cambian una vez al día,
// cuando OCC publica el OI de la sesión anterior) y se compara contra la versión anterior.
//
// Disco: data/vision-futura/premarket/{inst}-{fecha}.json (pronóstico, recorrido del
// pre-mercado, pronóstico congelado antes de la apertura y calificación al cierre) y
// data/vision-futura/premarket/oi-{inst}.json (versiones de OI). Imports relativos (lo usa
// también scripts/vision-futura-replay/run.ts con tsx).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { fetchAssetPrice, fetchAssetPriceChart, fetchOptionChainExtended } from "./marketsnack";
import { fetchFuturesOptionQuotesByType, fetchLiveQuotes, fetchNestedFuturesOptionChain, type FuturesOptionExpiration } from "./tastytrade";
import { fetchFutureCandles } from "./futuresCandles";
import { instrumentOf } from "./visionFuturaInstruments";
import { activeFutureInfo } from "./visionFuturaNight";
import { nestedFor, spreadQuotes } from "./visionFuturaData";
import { replayFileName } from "./visionFuturaReplay";
import {
  buildPremarket, gradePremarket, nyTimeMs, premarketTarget, prevWeekday,
  type PremarketGrade, type PremarketInput, type PremarketReport, type PremarketStrike,
} from "./visionFuturaPremarket";

const BASE = join(process.cwd(), "data", "vision-futura");
const DIR = join(BASE, "premarket");

export const PREMARKET_INSTRUMENTS = ["SPX", "NQ", "TSLA"] as const;

export interface PremarketSnapshot {
  t: string;
  spot: number;
  sigma: number;
  low: number;
  high: number;
  magnet: number | null;
  flip: number | null;
  regime: "positivo" | "negativo" | null;
  confidence: PremarketReport["confidence"];
  futLast: number | null;
}

export interface PremarketDayFile {
  inst: string;
  date: string;
  report: PremarketReport;
  snapshots: PremarketSnapshot[];
  /** Pronóstico congelado: el último calculado antes de las 9:30 NY. */
  frozen: PremarketReport | null;
  grade: PremarketGrade | null;
}

export interface PremarketHistoryRow {
  date: string;
  low: number;
  high: number;
  sigma: number;
  grade: PremarketGrade;
}

export interface PremarketPayload {
  inst: string;
  phase: "pre" | "sesion";
  date: string;
  day: PremarketDayFile | null;
  history: PremarketHistoryRow[];
  error: string | null;
}

const fileOf = (inst: string, date: string) => join(DIR, `${inst}-${date}.json`);
const readJson = <T>(f: string): T | null => { try { return JSON.parse(readFileSync(f, "utf8")) as T; } catch { return null; } };
const writeJson = (f: string, v: unknown) => { mkdirSync(DIR, { recursive: true }); writeFileSync(f, JSON.stringify(v), "utf8"); };

// ── Versiones de OI por vencimiento ──

interface OiVersion { capturedAt: string; hash: string; byStrike: Record<string, [number, number]> }
type OiStore = Record<string, OiVersion[]>;

const oiFile = (inst: string) => join(DIR, `oi-${inst}.json`);

function oiByStrike(chain: { strike: number; type: string; open_interest: number }[]): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const c of chain) {
    const k = String(c.strike);
    const cur = out[k] ?? [0, 0];
    if (c.type === "call") cur[0] += c.open_interest || 0; else cur[1] += c.open_interest || 0;
    out[k] = cur;
  }
  return out;
}

/** Registra el OI de un vencimiento (solo si cambió) y devuelve la versión ANTERIOR a la actual. */
function recordOi(inst: string, exp: string, byStrike: Record<string, [number, number]>, nowIso: string): OiVersion | null {
  const store = readJson<OiStore>(oiFile(inst)) ?? {};
  const total = Object.values(byStrike).reduce((a, [c, p]) => a + c + p, 0);
  const list = store[exp] ?? [];
  if (total > 0) {
    const hash = createHash("sha1").update(JSON.stringify(Object.entries(byStrike).sort())).digest("hex");
    if (list.at(-1)?.hash !== hash) list.push({ capturedAt: nowIso, hash, byStrike });
    store[exp] = list.slice(-3);
    // Fuera vencimientos de hace más de 10 días.
    const cut = new Date(Date.parse(nowIso) - 10 * 86_400_000).toISOString().slice(0, 10);
    for (const k of Object.keys(store)) if (k < cut) delete store[k];
    try { writeJson(oiFile(inst), store); } catch { /* no crítico */ }
  }
  const cur = store[exp] ?? [];
  return cur.length >= 2 ? cur[cur.length - 2] : null;
}

// Vencimientos siguientes: se copian como mucho cada 2 h (para tener "posiciones nuevas" mañana).
const nextCaptureAt = new Map<string, number>();
async function captureNextExps(inst: string, msTicker: string, exps: string[], nowMs: number) {
  for (const exp of exps) {
    const key = `${inst}|${exp}`;
    if ((nextCaptureAt.get(key) ?? 0) > nowMs) continue;
    nextCaptureAt.set(key, nowMs + 2 * 3_600_000);
    const chain = await fetchOptionChainExtended(msTicker, exp).catch(() => []);
    if (chain.length) recordOi(inst, exp, oiByStrike(chain), new Date(nowMs).toISOString());
  }
}

// ── Precio del día anterior ──

interface DayBars { open: number; high: number; low: number; close: number }

function rthOf(points: { ms: number; v: number }[], date: string): DayBars | null {
  const o = nyTimeMs(date, "09:30"), c = nyTimeMs(date, "16:00");
  const pts = points.filter((p) => p.ms >= o && p.ms <= c && p.v > 0).sort((a, b) => a.ms - b.ms);
  if (pts.length < 3) return null;
  return { open: pts[0].v, high: Math.max(...pts.map((p) => p.v)), low: Math.min(...pts.map((p) => p.v)), close: pts[pts.length - 1].v };
}

async function chartBars(ticker: string, date: string): Promise<DayBars | null> {
  const chart = await fetchAssetPriceChart(ticker).catch(() => []);
  return rthOf(chart.map((p) => ({ ms: Date.parse(p.t), v: p.v })), date);
}

/** Sesión de un día: la repetición guardada (ya convertida a NDX en NQ) o la gráfica de MarketSnack. */
async function sessionBars(inst: string, date: string): Promise<DayBars | null> {
  const rep = readJson<{ priceSeries: { time: number; value: number }[] }>(join(BASE, replayFileName(inst, date)));
  const fromReplay = rep ? rthOf(rep.priceSeries.map((p) => ({ ms: p.time * 1000, v: p.value })), date) : null;
  if (fromReplay) return fromReplay;
  const cfg = instrumentOf(inst);
  if (cfg.chartFromEtf) return null; // NDX sin gráfica propia: sin repetición no hay máx/mín confiable
  const chart = await fetchAssetPriceChart(cfg.msTicker).catch(() => []);
  return rthOf(chart.map((p) => ({ ms: Date.parse(p.t), v: p.v })), date);
}

// ── Eventos del día ──

function eventsOn(date: string): string[] {
  const ev = readJson<{ fecha: string; tipo: string }[]>(join(BASE, "amiga", "eventos.json")) ?? [];
  return ev.filter((e) => e.fecha === date).map((e) => e.tipo);
}

// ── Pronóstico ──

const HOUR = 3_600_000;
const YEAR_MS = 365 * 24 * HOUR;

async function computeReport(inst: string, date: string, nowMs: number): Promise<PremarketReport> {
  const cfg = instrumentOf(inst);
  const prevDate = prevWeekday(date);
  const isIndex = !!cfg.tastyMain.index;

  const [futInfo, nested, prevBars] = await Promise.all([
    cfg.future ? activeFutureInfo(cfg.future).catch(() => null) : Promise.resolve(null),
    nestedFor(cfg.tastyChain).catch(() => []),
    sessionBars(inst, prevDate),
  ]);
  const quotes = await fetchLiveQuotes({
    index: [...new Set([cfg.tastyMain.index, "VIX"].filter((x): x is string => !!x))],
    equity: cfg.tastyMain.equity ? [cfg.tastyMain.equity] : [],
    future: futInfo ? [futInfo.symbol] : [],
  });
  const mainQ = quotes.get(cfg.main);

  // Cierre anterior: el índice no se mueve fuera de horario (su "last" ES el cierre);
  // la acción sí (pre/post-market): su cierre sale de la sesión anterior.
  const prevClose = isIndex ? mainQ?.price ?? prevBars?.close ?? null : prevBars?.close ?? mainQ?.prevClose ?? null;
  if (!prevClose) throw new Error(`Sin cierre anterior de ${cfg.main}.`);

  // Futuro: precio ahora, al cierre de las 4 pm y máx/mín de la noche (velas de 5 min).
  let future: PremarketInput["future"] = null;
  const futLast = futInfo ? quotes.get(futInfo.symbol)?.price ?? null : null;
  if (futInfo && futLast) {
    const candles = futInfo.streamer ? await fetchFutureCandles(futInfo.streamer, nyTimeMs(prevDate, "15:00"), "5m", 10_000) : [];
    const close16 = nyTimeMs(prevDate, "16:00") / 1000;
    const atPrev = candles.filter((b) => b.time < close16).at(-1)?.close ?? null;
    const night = candles.filter((b) => b.time * 1000 >= nyTimeMs(prevDate, "18:00"));
    future = {
      symbol: futInfo.symbol, last: futLast, atPrevClose: atPrev,
      onHigh: night.length ? Math.max(...night.map((b) => b.high), futLast) : null,
      onLow: night.length ? Math.min(...night.map((b) => b.low), futLast) : null,
    };
  }

  let spot: number;
  let spotSource: string;
  if (isIndex && future?.atPrevClose != null) {
    spot = prevClose + (future.last - future.atPrevClose);
    spotSource = `${future.symbol} ${future.last.toFixed(2)} vs ${future.atPrevClose.toFixed(2)} al cierre`;
  } else if (!isIndex) {
    const ext = await fetchAssetPrice(cfg.msTicker).catch(() => null);
    spot = ext ?? mainQ?.price ?? prevClose;
    spotSource = ext ? "pre-market de MarketSnack" : "último precio de tastytrade";
  } else {
    spot = prevClose;
    spotSource = "sin futuro: cierre anterior";
  }

  // NQ: las NDXP casi no tienen OI → se usan las opciones de QQQ con los strikes pasados a NDX
  // (× NDX ÷ QQQ al cierre anterior).
  const optTicker = inst === "NQ" ? "QQQ" : cfg.msTicker;
  let ratio = 1;
  if (inst === "NQ") {
    const qqq = await chartBars("QQQ", prevDate);
    if (!qqq) throw new Error("Sin cierre de QQQ para convertir sus opciones a NDX.");
    ratio = prevClose / qqq.close;
  }
  const conv = (k: number) => Math.round(k * ratio * 100) / 100;
  const optNested = inst === "NQ" ? await nestedFor("QQQ").catch(() => []) : nested;

  // Vencimiento: el del día si existe; si no, el siguiente.
  const exps = optNested.map((e) => e["expiration-date"]).filter((d) => d >= date).sort();
  const expiration = exps[0] ?? date;
  const chainRaw = await fetchOptionChainExtended(optTicker, expiration).catch(() => []);
  const chain = chainRaw.map((c) => ({ ...c, strike: conv(c.strike) }));
  const byStrike = new Map<number, PremarketStrike>();
  for (const c of chain) {
    const s = byStrike.get(c.strike) ?? { strike: c.strike, callOi: 0, putOi: 0, callIv: null, putIv: null };
    if (c.type === "call") { s.callOi += c.open_interest || 0; s.callIv = c.implied_volatility; }
    else { s.putOi += c.open_interest || 0; s.putIv = c.implied_volatility; }
    byStrike.set(c.strike, s);
  }
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const nowIso = new Date(nowMs).toISOString();
  // El OI se guarda con los strikes ORIGINALES (en NQ el factor cambia cada día) y se convierte al leer.
  const prevOiRaw = recordOi(inst, expiration, oiByStrike(chainRaw), nowIso);
  const prevOi = prevOiRaw && {
    capturedAt: prevOiRaw.capturedAt,
    byStrike: Object.fromEntries(Object.entries(prevOiRaw.byStrike).map(([k, v]) => [String(conv(Number(k))), v])),
  };
  void captureNextExps(inst, optTicker, exps.slice(1, 3), nowMs).catch(() => {});

  // Tiempo al vencimiento y sesiones que faltan (incluida la del día).
  const expMs = nyTimeMs(expiration, "16:00");
  const T = Math.max((expMs - nowMs) / YEAR_MS, 0.25 / (365 * 24));
  let sessions = 0;
  for (let d = date; d <= expiration; d = nextDay(d)) if (isWeekday(d)) sessions++;
  sessions = Math.max(1, sessions);

  // IV ATM (promedio de calls/puts de los 2 strikes más cercanos).
  const atm = [...strikes].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, 2);
  const ivs = atm.flatMap((s) => [s.callIv, s.putIv]).filter((v): v is number => v != null && v > 0.02 && v < 3);
  const atmIv = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const vix = quotes.get("VIX")?.price ?? null;

  let sigma: { points: number; source: string } | null = null;
  // NQ: straddle EN VIVO de las opciones de /NQ (CME cotiza de noche) que vencen ese día.
  if (inst === "NQ" && future) {
    const st = await futuresStraddle(cfg.future!, future.symbol, future.last, date).catch(() => null);
    if (st) sigma = { points: st.price / 0.8, source: `straddle ${future.symbol} ${st.strike} ${st.price.toFixed(2)} pts (en vivo)` };
  }
  // Straddle ATM real del vencimiento del día (≈ 0.8σ). SPX: las SPXW cotizan de noche (en vivo).
  // QQQ/TSLA no tienen pre-mercado de opciones: sus cotizaciones del cierre anterior ya traen el
  // movimiento esperado de UNA sesión (cierre → cierre), centrado en el cierre de ese momento.
  if (!sigma && expiration === date) {
    const chainSym = inst === "NQ" ? "QQQ" : cfg.tastyChain;
    const center = inst === "SPX" ? spot : inst === "NQ" ? prevClose / ratio : prevClose;
    const rows = await spreadQuotes(chainSym, expiration, center, center * 0.01).catch(() => []);
    const ks = [...new Set(rows.map((r) => r.strike))].sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    for (const k of ks.slice(0, 3)) {
      const c = rows.find((r) => r.strike === k && r.type === "call");
      const p = rows.find((r) => r.strike === k && r.type === "put");
      if (!c?.bid || !c.ask || !p?.bid || !p.ask) continue;
      const mid = (c.bid + c.ask) / 2 + (p.bid + p.ask) / 2;
      const live = inst === "SPX";
      sigma = {
        points: (mid / 0.8) * ratio,
        source: `straddle ${inst === "NQ" ? "QQQ " : ""}${k} $${mid.toFixed(2)}${live ? "" : " (cotización al cierre anterior)"}`,
      };
      break;
    }
  }
  if (!sigma && atmIv) sigma = { points: spot * atmIv * Math.sqrt(T / sessions), source: `IV ATM ${(atmIv * 100).toFixed(1)}%` };
  if (!sigma && vix) sigma = { points: spot * (vix / 100) / Math.sqrt(252), source: `VIX ${vix.toFixed(2)}` };
  if (!sigma) throw new Error(`Sin volatilidad para ${cfg.main}.`);

  return buildPremarket({
    inst, targetDate: date, expiration, now: nowMs, prevClose, spot, spotSource, future,
    prevDay: prevBars ? { high: prevBars.high, low: prevBars.low, close: prevBars.close } : null,
    sigma, strikes, yearsToExpiry: T, fallbackIv: atmIv ?? (vix ? vix / 100 : 0.18),
    oiPrev: prevOi || null,
    events: eventsOn(date),
    optionsNote: inst === "NQ" ? `niveles de las opciones de QQQ × ${ratio.toFixed(2)} (las de NDX casi no tienen OI)` : undefined,
  });
}

// Cadena anidada de opciones de futuros (cambia poco: 30 min).
const futNested = new Map<string, { at: number; exps: FuturesOptionExpiration[] }>();
async function futuresStraddle(product: string, futSymbol: string, futLast: number, date: string): Promise<{ strike: number; price: number } | null> {
  let c = futNested.get(product);
  if (!c || Date.now() - c.at > 30 * 60_000) {
    c = { at: Date.now(), exps: await fetchNestedFuturesOptionChain(product) };
    futNested.set(product, c);
  }
  const exp = c.exps.find((e) => e["underlying-symbol"] === futSymbol && e["expiration-date"] === date);
  if (!exp) return null;
  const near = [...exp.strikes].sort((a, b) => Math.abs(Number(a["strike-price"]) - futLast) - Math.abs(Number(b["strike-price"]) - futLast)).slice(0, 3);
  const q = await fetchFuturesOptionQuotesByType(near.flatMap((s) => [s.call, s.put]).filter(Boolean));
  const n = (v: string | number | undefined | null) => (v != null && v !== "" && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  for (const s of near) {
    const cq = q.get(s.call), pq = q.get(s.put);
    const cb = n(cq?.bid), ca = n(cq?.ask), pb = n(pq?.bid), pa = n(pq?.ask);
    if (cb == null || ca == null || pb == null || pa == null) continue;
    return { strike: Number(s["strike-price"]), price: (cb + ca) / 2 + (pb + pa) / 2 };
  }
  return null;
}

const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const isWeekday = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };

// ── Calificación ──

/** Califica un día ya cerrado (con la repetición guardada o la gráfica). Idempotente. */
export async function gradePremarketDay(inst: string, date: string): Promise<PremarketGrade | null> {
  const f = fileOf(inst, date);
  const day = readJson<PremarketDayFile>(f);
  if (!day) return null;
  if (day.grade) return day.grade;
  if (Date.now() < nyTimeMs(date, "16:05")) return null;
  const bars = await sessionBars(inst, date);
  if (!bars) return null;
  const grade = gradePremarket(day.frozen ?? day.report, { date, ...bars });
  day.grade = grade;
  writeJson(f, day);
  return grade;
}

export function premarketHistory(inst: string, limit = 20): PremarketHistoryRow[] {
  let files: string[] = [];
  try { files = readdirSync(DIR).filter((f) => f.startsWith(`${inst}-`) && /\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch { return []; }
  return files.sort().reverse().slice(0, limit * 2)
    .map((f) => readJson<PremarketDayFile>(join(DIR, f)))
    .filter((d): d is PremarketDayFile => !!d?.grade)
    .slice(0, limit)
    .map((d) => { const r = d.frozen ?? d.report; return { date: d.date, low: r.range.low, high: r.range.high, sigma: r.sigma, grade: d.grade! }; });
}

// ── Carga (ruta y tarea) ──

const SNAP_EVERY_MS = 10 * 60_000;
const memo = new Map<string, { at: number; payload: PremarketPayload }>();

/** Pronóstico del día: lo recalcula en pre-mercado (máx. cada 60 s) y lo guarda; en sesión, el guardado. */
export async function loadPremarket(instRaw: string, now = new Date(), opts: { force?: boolean } = {}): Promise<PremarketPayload> {
  const inst = (PREMARKET_INSTRUMENTS as readonly string[]).includes(instRaw) ? instRaw : "SPX";
  const nowMs = now.getTime();
  const m = memo.get(inst);
  if (!opts.force && m && nowMs - m.at < 60_000) return m.payload;

  const { date, phase } = premarketTarget(nowMs);
  // De paso: califica días anteriores que quedaron sin calificar.
  await gradePremarketDay(inst, prevWeekday(date)).catch(() => null);
  const f = fileOf(inst, date);
  let day = readJson<PremarketDayFile>(f);
  let error: string | null = null;

  // Antes de la apertura se recalcula; ya en sesión solo se calcula si nunca se hizo (y se marca).
  if (phase === "pre" || !day) {
    try {
      const report = await computeReport(inst, date, nowMs);
      if (phase === "sesion") report.lecturas.unshift("⚠ Calculado con el mercado ya abierto (no hubo lectura de pre-mercado): no cuenta como pronóstico.");
      const snap: PremarketSnapshot = {
        t: report.asOf, spot: report.spot, sigma: report.sigma, low: report.range.low, high: report.range.high,
        magnet: report.levels.magnet, flip: report.levels.flip, regime: report.regime, confidence: report.confidence,
        futLast: report.futBasis != null ? report.spot + report.futBasis : null,
      };
      const snaps = day?.snapshots ?? [];
      const last = snaps.at(-1);
      const changed = !last || last.low !== snap.low || last.high !== snap.high || last.magnet !== snap.magnet;
      if (!last || nowMs - Date.parse(last.t) >= SNAP_EVERY_MS || changed) snaps.push(snap);
      // Congelado = la última lectura antes de las 9:30 (solo en pre-mercado).
      const frozen = phase === "pre" ? report : day?.frozen ?? null;
      day = { inst, date, report, snapshots: snaps.slice(-200), frozen, grade: day?.grade ?? null };
      writeJson(f, day);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const payload: PremarketPayload = { inst, phase, date, day, history: premarketHistory(inst), error };
  memo.set(inst, { at: nowMs, payload });
  return payload;
}

export const premarketFileExists = (inst: string, date: string) => existsSync(fileOf(inst, date));
