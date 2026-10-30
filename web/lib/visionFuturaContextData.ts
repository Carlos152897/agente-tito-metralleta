// Datos del panel derecho de VisionFutura ("VIX · SPY · QQQ" y "Vigía tecnológico") — ver
// lib/visionFuturaContext.ts (puro). GEX por strike = gamma REAL de MarketSnack
// (option_chain_extended) × OI, del vencimiento más próximo que todavía tenga gamma (después del
// cierre el de hoy ya no trae: se usa el siguiente). Precio en vivo = tastytrade; línea del día =
// velas de 1 min de tastytrade. Los imanes no tienen historial en ningún lado: se GRABAN minuto a
// minuto en data/vision-futura/context/{fecha}.json mientras la página o la vigilancia de fondo
// (scripts/vision-futura-live/poll.ts) estén corriendo. Imports relativos (lo usa el poller con tsx).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { fetchOptionChainExtended } from "./marketsnack";
import { fetchLiveQuotes, fetchNestedOptionChain } from "./tastytrade";
import { computeStrikeGex, type ExtendedChainContract } from "./spxLevels";
import { fetchFutureCandles } from "./futuresCandles";
import { isMarketOpen } from "./marketHours";
import {
  CONTEXT_SYMBOLS, TECH_TICKERS, magnetsInBand, techCompany, techReading, upsertMinute,
  type ContextPoint, type ContextSymbol, type StrikeGex, type TechCompany, type TechIndex, type TechPoint,
} from "./visionFuturaContext";

const DIR = join(process.cwd(), "data", "vision-futura", "context");

export interface ContextDayFile {
  date: string;
  series: Record<ContextSymbol, ContextPoint[]>;
  tech: Record<TechIndex, TechPoint[]>;
}

export interface ContextSymbolView {
  sym: ContextSymbol;
  band: number;
  digits: number;
  price: number | null;
  prevClose: number | null;
  pos: number | null;
  neg: number | null;
  expiration: string | null;
  /** Precio por minuto del día (cierre de cada vela de 1 min). */
  line: { t: number; v: number }[];
  /** Imanes grabados por minuto. */
  magnets: ContextPoint[];
}

export interface ContextPayload {
  date: string;
  asOf: string;
  marketOpen: boolean;
  /** true = sesión pasada (sin lectura en vivo de imanes). */
  past: boolean;
  symbols: ContextSymbolView[];
  tech: { companies: TechCompany[]; series: Record<TechIndex, TechPoint[]> };
}

// ── Fechas de Nueva York ──
function nyParts(ms: number): { date: string; min: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
function openMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`);
  return nyParts(guess).min === 9 * 60 + 30 ? guess : guess + 3_600_000;
}
const prevDay = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ── Disco ──
const emptyDay = (date: string): ContextDayFile => ({ date, series: { VIX: [], SPY: [], QQQ: [] }, tech: { SPX: [], NDX: [] } });
const fileOf = (date: string) => join(DIR, `${date}.json`);

export function loadContextDay(date: string): ContextDayFile {
  try {
    const j = JSON.parse(readFileSync(fileOf(date), "utf8")) as ContextDayFile;
    const e = emptyDay(date);
    return { date, series: { ...e.series, ...j.series }, tech: { ...e.tech, ...j.tech } };
  } catch {
    return emptyDay(date);
  }
}

function saveContextDay(d: ContextDayFile) {
  mkdirSync(DIR, { recursive: true });
  const file = fileOf(d.date);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(d), "utf8");
  try { renameSync(tmp, file); } catch { writeFileSync(file, JSON.stringify(d), "utf8"); }
}

// ── GEX por strike (cadena cacheada 5 min; el precio en vivo se aplica en cada lectura) ──
const expCache = new Map<string, { at: number; exps: string[] }>();
async function expirations(sym: string): Promise<string[]> {
  const c = expCache.get(sym);
  if (c && Date.now() - c.at < 30 * 60_000) return c.exps;
  const exps = [...new Set((await fetchNestedOptionChain(sym)).map((e) => e["expiration-date"]))].sort();
  expCache.set(sym, { at: Date.now(), exps });
  return exps;
}

const chainCache = new Map<string, { at: number; exp: string | null; c: ExtendedChainContract[] }>();
/** Cadena del vencimiento más próximo (desde hoy) que todavía tenga gamma > 0. */
async function nearestChain(sym: string, today: string): Promise<{ exp: string | null; c: ExtendedChainContract[] }> {
  const hit = chainCache.get(sym);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit;
  let out: { exp: string | null; c: ExtendedChainContract[] } = { exp: null, c: [] };
  try {
    for (const exp of (await expirations(sym)).filter((e) => e >= today).slice(0, 3)) {
      const c = await fetchOptionChainExtended(sym, exp);
      if (c.some((x) => x.open_interest > 0 && x.greeks?.gamma > 0)) { out = { exp, c }; break; }
    }
  } catch { /* sin cadena: el imán queda vacío */ }
  chainCache.set(sym, { at: Date.now(), ...out });
  return out;
}

const gexOf = (c: ExtendedChainContract[], spot: number): Map<number, StrikeGex> => computeStrikeGex(c, spot);

/** Corre de a pocos para no saturar MarketSnack. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ── Lectura en vivo (máx. cada 30 s) + grabación del minuto ──
interface LiveRead {
  at: number;
  date: string;
  symbols: { sym: ContextSymbol; price: number | null; prevClose: number | null; pos: number | null; neg: number | null; expiration: string | null }[];
  companies: TechCompany[];
}
let lastRead: LiveRead | null = null;
let inFlight: Promise<LiveRead> | null = null;

async function readLive(now: Date): Promise<LiveRead> {
  const date = nyParts(now.getTime()).date;
  const quotes = await fetchLiveQuotes({ index: ["VIX"], equity: ["SPY", "QQQ", ...TECH_TICKERS] });
  const symbols = await pool(CONTEXT_SYMBOLS, 3, async (cfg) => {
    const q = quotes.get(cfg.sym);
    const ch = await nearestChain(cfg.sym, date);
    const m = q && ch.c.length ? magnetsInBand(gexOf(ch.c, q.price), q.price, cfg.band) : null;
    return { sym: cfg.sym, price: q?.price ?? null, prevClose: q?.prevClose ?? null, pos: m?.pos ?? null, neg: m?.neg ?? null, expiration: ch.exp };
  });
  const companies = await pool(TECH_TICKERS, 4, async (t) => {
    const q = quotes.get(t);
    const ch = await nearestChain(t, date);
    return techCompany(t, q?.price ?? null, q?.prevClose ?? null, q && ch.c.length ? gexOf(ch.c, q.price) : null, ch.exp);
  });
  return { at: Date.now(), date, symbols, companies };
}

/**
 * Lee imanes en vivo (caché 30 s) y, con el mercado abierto, graba el minuto en disco.
 * La usan la ruta /api/vision-futura/contexto y la vigilancia de fondo. Nunca lanza si ya hay una lectura previa.
 */
export async function recordContext(now = new Date()): Promise<LiveRead> {
  if (lastRead && Date.now() - lastRead.at < 30_000) return lastRead;
  if (!inFlight) {
    inFlight = readLive(now).finally(() => { inFlight = null; });
  }
  let r: LiveRead;
  try {
    r = await inFlight;
  } catch (e) {
    if (lastRead) return lastRead;
    throw e;
  }
  lastRead = r;
  if (isMarketOpen(now)) {
    const t = Math.floor(now.getTime() / 60_000) * 60;
    const day = loadContextDay(r.date);
    for (const s of r.symbols) {
      if (s.price == null) continue;
      day.series[s.sym] = upsertMinute(day.series[s.sym], { t, price: s.price, pos: s.pos, neg: s.neg });
    }
    for (const idx of ["SPX", "NDX"] as TechIndex[]) {
      const rd = techReading(r.companies, idx);
      if (rd) day.tech[idx] = upsertMinute(day.tech[idx], { t, ...rd });
    }
    try { saveContextDay(day); } catch { /* sin disco: igual se muestra en vivo */ }
  }
  return r;
}

/** Velas de 1 min (cierre) de la sesión `date`. */
async function dayLine(sym: string, date: string): Promise<{ t: number; v: number }[]> {
  const from = openMs(date);
  if (from > Date.now()) return [];
  const bars = await fetchFutureCandles(sym, from, "1m", 10_000, 30_000).catch(() => []);
  return bars.filter((b) => b.time * 1000 < from + 390 * 60_000).map((b) => ({ t: b.time, v: b.close }));
}

/**
 * Panel completo. Sin `date`: hoy (o la última sesión con velas si todavía no abre) + lectura en vivo.
 * Con `date` (repetición): la sesión grabada de ese día, sin lectura en vivo.
 */
export async function loadContext(dateWanted: string | null, now = new Date()): Promise<ContextPayload> {
  const live = dateWanted ? null : await recordContext(now);
  // Sesión a mostrar: la pedida, o la de hoy; si hoy no tiene velas (antes de abrir / fin de semana), la anterior.
  let date = dateWanted ?? nyParts(now.getTime()).date;
  let spyLine: { t: number; v: number }[] = [];
  for (let i = 0; i < (dateWanted ? 1 : 5); i++) {
    spyLine = await dayLine("SPY", date);
    if (spyLine.length > 0) break;
    date = prevDay(date);
  }
  const day = loadContextDay(date);
  const lines = await Promise.all(CONTEXT_SYMBOLS.map((c) => (c.sym === "SPY" ? Promise.resolve(spyLine) : dayLine(c.sym, date))));
  const symbols: ContextSymbolView[] = CONTEXT_SYMBOLS.map((cfg, i) => {
    const l = live?.symbols.find((s) => s.sym === cfg.sym);
    const rec = day.series[cfg.sym];
    const last = rec.at(-1);
    return {
      sym: cfg.sym, band: cfg.band, digits: cfg.digits,
      price: l?.price ?? last?.price ?? lines[i].at(-1)?.v ?? null,
      prevClose: l?.prevClose ?? null,
      pos: l ? l.pos : last?.pos ?? null,
      neg: l ? l.neg : last?.neg ?? null,
      expiration: l?.expiration ?? null,
      line: lines[i].length ? lines[i] : rec.map((p) => ({ t: p.t, v: p.price })),
      magnets: rec,
    };
  });
  return {
    date,
    asOf: new Date(live?.at ?? Date.now()).toISOString(),
    marketOpen: isMarketOpen(now),
    past: !!dateWanted,
    symbols,
    tech: { companies: live?.companies ?? [], series: day.tech },
  };
}
