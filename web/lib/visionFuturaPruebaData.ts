// Colector del flujo TRADE POR TRADE para la vista "Prueba" (servidor). Fuente: MarketSnack
// /api/flow_feed (Time & Sales) con la cookie guardada (lib/marketsnackCookie.ts, nunca se escribe en
// logs). Solo SPX 0DTE (filter[dte][lte]=0) con prima ≥ PRUEBA_DATA_TUNING.minPremium: SPX imprime
// cientos de trades por segundo y bajar TODO el día no es viable.
//
// Cómo se llena el día:
//   - Cola en vivo: en cada pedido (cada 15 s) se baja lo nuevo desde el último trade guardado.
//   - Resto del día: en segundo plano, por tramos de 30 min (del más nuevo al más viejo, 3 a la vez).
//     Cada tramo terminado queda en disco: data/vision-futura/prueba/SPX-{fecha}.json.
// La primera vez del día tarda unos minutos en tener todo; mientras, la respuesta dice desde qué
// hora hay datos completos (`coveredFrom`).

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "fs";
import { join } from "path";
import { loadCookie } from "./marketsnackCookie";
import { etTimeToUnix, marketDateStr, parseOcc } from "./occ";
import type { PruebaTrade } from "./visionFuturaPrueba";

const BASE_URL = "https://app.marketsnack.com";
const DIR = join(process.cwd(), "data", "vision-futura", "prueba");

export const PRUEBA_DATA_TUNING = {
  /** Prima mínima por trade ($). Menos = demasiadas páginas en SPX. */
  minPremium: 10_000,
  /** Tramos del relleno en segundo plano. */
  segMin: 30,
  concurrency: 3,
  /** La cola en vivo arranca este tanto antes de "ahora" la primera vez. */
  tailStartMin: 6,
  /** La cola pide desde el último trade recibido menos esto (MarketSnack publica con retraso). */
  tailOverlapMs: 120_000,
  /** Barrido de huecos: cada cuánto y con cuánto retraso respecto al reloj. */
  sweepEveryMs: 5 * 60_000,
  sweepLagMs: 3 * 60_000,
  /** Tope de páginas por pedido de la cola (50 trades c/u). */
  maxTailPages: 60,
  saveEveryMs: 60_000,
};

export class PruebaCookieError extends Error {
  constructor() { super("Cookie de MarketSnack expirada"); this.name = "PruebaCookieError"; }
}

interface Segment { from: number; to: number; done: boolean }

interface DayStore {
  inst: string;
  date: string;
  minPremium: number;
  open: number;
  close: number;
  trades: PruebaTrade[];
  segments: Segment[];
  /** Inicio de la cola en vivo (lo anterior lo cubren los tramos). */
  tailStart: number;
  /** Último instante bajado completo por la cola. */
  tailTo: number;
  /** Hasta dónde ya se re-barrió el día para tapar huecos de la cola (ausente = nunca → barre todo). */
  sweptTo?: number;
  updatedAt: number;
}

interface Live {
  store: DayStore;
  ids: Set<number>;
  sorted: boolean;
  savedAt: number;
  filling: Promise<void> | null;
  /** Versión: sube cada vez que entran trades (para el caché de cálculos de la ruta). */
  version: number;
  lastError: string | null;
  cookieExpired: boolean;
}

const lives = new Map<string, Live>();

function fileOf(inst: string, date: string) {
  return join(DIR, `${inst}-${date}.json`);
}

function save(l: Live) {
  try {
    mkdirSync(DIR, { recursive: true });
    const f = fileOf(l.store.inst, l.store.date);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(l.store));
    renameSync(tmp, f);
    l.savedAt = Date.now();
  } catch { /* disco lleno / bloqueado: se reintenta en el siguiente guardado */ }
}

function loadFromDisk(inst: string, date: string): DayStore | null {
  const f = fileOf(inst, date);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8")) as DayStore;
    return s.minPremium === PRUEBA_DATA_TUNING.minPremium ? s : null;
  } catch { return null; }
}

// ───────────────────────── MarketSnack ─────────────────────────

interface RawFlow {
  id: number; symbol: string; price: number; size: number; bid_price: number; ask_price: number; premium: number;
  delta: number; implied_volatility: number; open_interest: number; volume: number; timestamp: string; asset_price?: number;
}

async function fetchPage(inst: string, extra: Record<string, string>, token: string | null): Promise<{ list: RawFlow[]; next: string | null }> {
  const cookie = await loadCookie();
  if (!cookie) throw new PruebaCookieError();
  const p = new URLSearchParams({ "filter[scope]": "all", period: "1d", "filter[dte][lte]": "0", "filter[premium][gte]": String(PRUEBA_DATA_TUNING.minPremium), ...extra });
  p.append("filter[symbol][]", inst);
  if (token) p.set("next_page_token", token);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/api/flow_feed?${p}`, {
      headers: { Accept: "application/json", Cookie: cookie }, cache: "no-store", redirect: "manual",
    });
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new PruebaCookieError();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`MarketSnack respondió ${res.status}`);
    const j = (await res.json()) as { list?: RawFlow[]; meta?: { next_page_token?: string } };
    return { list: j.list ?? [], next: j.meta?.next_page_token ?? null };
  }
}

function toTrade(r: RawFlow): PruebaTrade | null {
  const o = parseOcc(r.symbol);
  if (!o) return null;
  const t = Date.parse(r.timestamp);
  if (!Number.isFinite(t)) return null;
  return {
    id: r.id, t, sym: r.symbol, strike: o.strike, cp: o.type === "call" ? "C" : "P", exp: o.expiration,
    price: r.price, bid: r.bid_price, ask: r.ask_price, size: r.size, premium: r.premium,
    spot: r.asset_price ?? 0, delta: r.delta, iv: r.implied_volatility, oi: r.open_interest, vol: r.volume,
  };
}

/** Todas las páginas de [from, to] (ms). */
async function fetchRange(inst: string, from: number, to: number | null, maxPages = 10_000): Promise<PruebaTrade[] & { capped?: boolean }> {
  const extra: Record<string, string> = { "filter[timestamp][gte]": new Date(from).toISOString() };
  if (to != null) extra["filter[timestamp][lte]"] = new Date(to).toISOString();
  const out: PruebaTrade[] & { capped?: boolean } = [];
  let token: string | null = null;
  let pages = 0;
  do {
    const { list, next } = await fetchPage(inst, extra, token);
    pages += 1;
    for (const r of list) { const t = toTrade(r); if (t) out.push(t); }
    token = next;
    if (list.length === 0) break;
  } while (token && pages < maxPages);
  out.capped = !!token && pages >= maxPages;
  return out;
}

// ───────────────────────── Día ─────────────────────────

let dateCache: { inst: string; at: number; date: string } | null = null;

/** Día de la sesión: hoy en horario; si no, el del trade 0DTE más reciente (fin de semana / madrugada). */
async function sessionDate(inst: string, now: number): Promise<string> {
  const today = marketDateStr(new Date(now));
  const openToday = etTimeToUnix(today, 9, 30) * 1000;
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (now >= openToday && dow >= 1 && dow <= 5) return today;
  if (dateCache && dateCache.inst === inst && now - dateCache.at < 10 * 60_000) return dateCache.date;
  const { list } = await fetchPage(inst, {}, null);
  const t = list[0] ? Date.parse(list[0].timestamp) : NaN;
  const date = Number.isFinite(t) ? marketDateStr(new Date(t)) : today;
  dateCache = { inst, at: now, date };
  return date;
}

function newStore(inst: string, date: string, now: number): DayStore {
  const open = etTimeToUnix(date, 9, 30) * 1000;
  const close = etTimeToUnix(date, 16, 0) * 1000;
  const tailStart = Math.max(open, Math.min(close, now - PRUEBA_DATA_TUNING.tailStartMin * 60_000));
  const segments: Segment[] = [];
  const seg = PRUEBA_DATA_TUNING.segMin * 60_000;
  for (let a = open; a < tailStart; a += seg) segments.push({ from: a, to: Math.min(tailStart, a + seg), done: false });
  // Tras el cierre todo lo cubren los tramos: la cola queda vacía.
  return { inst, date, minPremium: PRUEBA_DATA_TUNING.minPremium, open, close, trades: [], segments, tailStart, tailTo: tailStart, updatedAt: now };
}

function liveFor(inst: string, date: string, now: number): Live {
  const key = `${inst}|${date}`;
  let l = lives.get(key);
  if (l) return l;
  const store = loadFromDisk(inst, date) ?? newStore(inst, date, now);
  l = { store, ids: new Set(store.trades.map((t) => t.id)), sorted: true, savedAt: 0, filling: null, version: 1, lastError: null, cookieExpired: false };
  // Solo un día en memoria por instrumento.
  for (const k of [...lives.keys()]) if (k.startsWith(`${inst}|`)) lives.delete(k);
  lives.set(key, l);
  return l;
}

function addTrades(l: Live, list: PruebaTrade[]) {
  let added = 0;
  for (const t of list) {
    if (l.ids.has(t.id)) continue;
    l.ids.add(t.id);
    l.store.trades.push(t);
    added++;
  }
  if (added) { l.sorted = false; l.version++; }
}

function sortTrades(l: Live) {
  if (l.sorted) return;
  l.store.trades.sort((a, b) => a.t - b.t || a.id - b.id);
  l.sorted = true;
}

/** Relleno en segundo plano: tramos pendientes, del más nuevo al más viejo, N a la vez. */
function startFill(l: Live) {
  if (l.filling) return;
  const pending = l.store.segments.filter((s) => !s.done).sort((a, b) => b.from - a.from);
  if (pending.length === 0) return;
  const worker = async () => {
    for (;;) {
      const s = pending.shift();
      if (!s) return;
      try {
        addTrades(l, await fetchRange(l.store.inst, s.from, s.to));
        s.done = true;
        sortTrades(l);
        save(l);
      } catch (e) {
        l.lastError = e instanceof Error ? e.message : String(e);
        if (e instanceof PruebaCookieError) { l.cookieExpired = true; return; }
      }
    }
  };
  l.filling = Promise.all(Array.from({ length: PRUEBA_DATA_TUNING.concurrency }, worker))
    .then(() => undefined)
    .finally(() => { l.filling = null; });
}

export interface PruebaFeed {
  inst: string;
  date: string;
  open: number;
  close: number;
  /** "Ahora" de los cálculos: el reloj en horario; el cierre si ya cerró. */
  asOf: number;
  trades: PruebaTrade[];
  version: number;
  segmentsDone: number;
  segmentsTotal: number;
  /** Desde cuándo hay datos SIN huecos hasta asOf. */
  coveredFrom: number;
  lastTradeT: number | null;
  updatedAt: number;
  cookieExpired: boolean;
  error: string | null;
}

/** Baja lo nuevo (cola en vivo), arranca el relleno y devuelve lo que haya. */
export async function loadPruebaFeed(inst = "SPX", now = Date.now()): Promise<PruebaFeed> {
  const date = await sessionDate(inst, now);
  const l = liveFor(inst, date, now);
  const s = l.store;
  const asOf = Math.min(now, s.close);
  // Cola en vivo (solo con la sesión abierta o recién cerrada sin cubrir).
  if (s.tailTo < asOf - 1000) {
    try {
      // Desde el ÚLTIMO TRADE recibido (no desde el reloj) con traslape: MarketSnack publica los trades
      // con retraso (24-nov: >1 min). Pidiendo "desde tailTo − 3 s" cada consulta llegaba vacía, tailTo
      // avanzaba igual y desde las 10:39 no entró nada — "no se ven los agresores". Los repetidos se
      // descartan por id.
      let lastT = s.tailStart;
      for (const t of s.trades) if (t.t > lastT) lastT = t.t;
      const from = Math.max(s.tailStart, Math.min(s.tailTo, lastT) - PRUEBA_DATA_TUNING.tailOverlapMs);
      const list = await fetchRange(inst, from, null, PRUEBA_DATA_TUNING.maxTailPages);
      addTrades(l, list);
      // Tope de páginas (servidor reiniciado a media sesión): el hueco queda como tramo pendiente.
      if (list.capped && list.length) {
        const oldest = Math.min(...list.map((t) => t.t));
        s.segments.push({ from, to: oldest, done: false });
      }
      s.tailTo = asOf;
      l.cookieExpired = false;
      l.lastError = null;
      s.updatedAt = now;
    } catch (e) {
      l.lastError = e instanceof Error ? e.message : String(e);
      if (e instanceof PruebaCookieError) l.cookieExpired = true;
    }
  }
  // Barrido: vuelve a pedir lo ya pasado (con retraso, por la demora de MarketSnack) para tapar huecos
  // de la cola. 24-nov: faltaban 9:39–9:48, 10:17–10:22, 10:25–10:47 sin que nadie se diera cuenta.
  const tune = PRUEBA_DATA_TUNING;
  const sweepEnd = asOf >= s.close ? s.close : asOf - tune.sweepLagMs;
  const swept = s.sweptTo ?? s.open;
  if (sweepEnd > swept && (s.sweptTo == null || sweepEnd - swept >= tune.sweepEveryMs || asOf >= s.close)) {
    const seg = tune.segMin * 60_000;
    for (let a = Math.max(s.open, swept - tune.tailOverlapMs); a < sweepEnd; a += seg) {
      s.segments.push({ from: a, to: Math.min(sweepEnd, a + seg), done: false });
    }
    s.sweptTo = sweepEnd;
  }
  sortTrades(l);
  if (!l.cookieExpired) startFill(l);
  if (now - l.savedAt > PRUEBA_DATA_TUNING.saveEveryMs) save(l);
  // Cobertura sin huecos hacia atrás desde la cola.
  let coveredFrom = s.tailStart;
  for (const seg of [...s.segments].sort((a, b) => b.from - a.from)) {
    if (seg.done && seg.to >= coveredFrom - 1000) coveredFrom = Math.min(coveredFrom, seg.from);
    else break;
  }
  return {
    inst, date, open: s.open, close: s.close, asOf, trades: s.trades, version: l.version,
    segmentsDone: s.segments.filter((x) => x.done).length, segmentsTotal: s.segments.length,
    coveredFrom, lastTradeT: s.trades.at(-1)?.t ?? null, updatedAt: s.updatedAt,
    cookieExpired: l.cookieExpired, error: l.lastError,
  };
}

// ───────────────────────── Repetición ─────────────────────────

/** Día guardado para "Repetir sesión" (sin red): el de memoria si es el que se está llenando, si no el del disco. */
let replayCache: { key: string; store: DayStore; version: number } | null = null;
export function loadSavedPruebaFeed(inst: string, date: string): PruebaFeed | null {
  const live = lives.get(`${inst}|${date}`);
  let s: DayStore | null = null;
  let version = 1;
  if (live) { sortTrades(live); s = live.store; version = live.version; }
  else {
    const key = `${inst}|${date}`;
    if (replayCache?.key !== key) {
      const d = loadFromDisk(inst, date);
      if (!d) return null;
      d.trades.sort((a, b) => a.t - b.t || a.id - b.id);
      replayCache = { key, store: d, version: 1 };
    }
    s = replayCache.store;
  }
  return {
    inst, date, open: s.open, close: s.close, asOf: s.close, trades: s.trades, version,
    segmentsDone: s.segments.filter((x) => x.done).length, segmentsTotal: s.segments.length,
    coveredFrom: s.open, lastTradeT: s.trades.at(-1)?.t ?? null, updatedAt: s.updatedAt,
    cookieExpired: false, error: null,
  };
}
