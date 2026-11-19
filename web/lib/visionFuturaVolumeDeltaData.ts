// Datos del volumen DELTA minuto a minuto (ver lib/visionFuturaVolumeDelta.ts, puro).
// Velas de 1 min de cada call y put del rango visible, con volumen al bid y al ask, del streaming
// DXLink de tastytrade: UNA sola conexión corta para todos los contratos. La primera vez se pide
// la sesión completa; después solo los últimos minutos de cada contrato (se guardan en memoria).
// Solo servidor.

import { DXLinkWebSocketClient } from "@dxfeed/dxlink-websocket-client";
import { DXLinkFeed, FeedContract } from "@dxfeed/dxlink-feed";
import { fetchLiveQuotes, fetchQuoteToken, type NestedChainStrike } from "./tastytrade";
import { fetchContractTradeSummary } from "./marketsnack";
import { nestedFor } from "./visionFuturaData";
import { instrumentOf } from "./visionFuturaInstruments";
import { bareSymbol, strikeMinutes, type OptBar, type StrikeMinute } from "./visionFuturaVolumeDelta";

/** Velas en memoria por símbolo de DXLink (".SPXW261029C7720"), por minuto. */
const store = new Map<string, { bars: Map<number, OptBar>; pulledAt: number }>();
const REPULL_MS = 15_000;
/** Si DXLink no dio nada, no se le vuelve a esperar hasta esta hora (mientras, respaldo de MarketSnack). */
let dxDownUntil = 0;
const DX_RETRY_MS = 2 * 60_000;
/** Más viejas que esto (s), las velas de tastytrade se consideran trabadas. */
const STALE_SEC = 180;

/**
 * RESPALDO (Carlos, 2-nov-2026: "se supone que debe haber respaldo"): volumen al ask / bid por
 * contrato de MarketSnack (`trade_summaries`), en tramos de 5 min. Cache 60 s por contrato.
 */
const MS_BUCKET_SEC = 300;
const MS_CACHE_MS = 60_000;
const msStore = new Map<string, { at: number; bars: OptBar[] }>();
async function msBars(occ: string, open: number): Promise<OptBar[]> {
  const c = msStore.get(occ);
  if (c && Date.now() - c.at < MS_CACHE_MS) return c.bars;
  const buckets = await fetchContractTradeSummary(occ);
  const bars = buckets
    .map((b) => ({ t: Math.floor(Date.parse(b.t) / 1000), a: b.ask_volume ?? 0, b: b.bid_volume ?? 0, v: (b.ask_volume ?? 0) + (b.bid_volume ?? 0) + (b.mid_volume ?? 0) }))
    .filter((b) => Number.isFinite(b.t) && b.t * 1000 >= open);
  msStore.set(occ, { at: Date.now(), bars });
  return bars;
}
async function msStrikes(strikes: { k: number; callOcc: string; putOcc: string }[], open: number, fromT: number): Promise<Record<string, number[][]>> {
  const out: Record<string, number[][]> = {};
  const CONC = 8;
  for (let i = 0; i < strikes.length; i += CONC) {
    await Promise.all(strikes.slice(i, i + CONC).map(async (s) => {
      const [c, p] = await Promise.all([msBars(s.callOcc, open).catch(() => []), msBars(s.putOcc, open).catch(() => [])]);
      const mins = strikeMinutes(c.filter((b) => b.t >= fromT), p.filter((b) => b.t >= fromT));
      if (mins.length) out[String(s.k)] = mins.map((m) => [m.t, m.cA, m.cB, m.cV, m.pA, m.pB, m.pV]);
    }));
  }
  return out;
}
const occOf = (s: string | undefined | null) => (s ? s.replace(/\s+/g, "") : "");

function nyParts(ms: number): { date: string; min: number; dow: number } {
  const d = new Date(ms);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute), dow };
}
function openMs(date: string): number {
  const guess = Date.parse(`${date}T13:30:00Z`);
  return nyParts(guess).min === 9 * 60 + 30 ? guess : guess + 3_600_000;
}
/** Sesión a mostrar: hoy si ya abrió; si no, el día hábil anterior. */
function sessionOpenMs(now: number): number {
  let ms = now;
  for (let i = 0; i < 6; i++) {
    const { date, dow } = nyParts(ms);
    const o = openMs(date);
    if (dow >= 1 && dow <= 5 && o <= now) return o;
    ms -= 24 * 3_600_000;
  }
  return openMs(nyParts(now).date);
}

/** Pide velas de 1 min de varios símbolos en una sola conexión, cada uno desde su `fromMs`. */
const PULL_CHUNK = 40;
/** Velas con hora más allá de ahora + esto son basura de DXLink. */
const FUTURE_TOL_MS = 2 * 60_000;
async function pullMany(reqs: { sym: string; fromMs: number }[], timeoutMs = 15_000): Promise<Map<string, OptBar[]>> {
  const out = new Map<string, OptBar[]>();
  if (reqs.length === 0 || typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") return out;
  const { token, dxlinkUrl } = await fetchQuoteToken();
  const client = new DXLinkWebSocketClient();
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (quiet) clearTimeout(quiet);
      clearTimeout(hard);
      try { client.close(); } catch { /* ya cerrado */ }
      resolve(out);
    };
    const hard = setTimeout(finish, timeoutMs);
    client.addAuthStateChangeListener((state) => {
      if (state !== "AUTHORIZED") return;
      // DXLink rechaza canales con muchas velas ("subscription size for event type 'Candle' is too big"):
      // con NQ a ±400 pts (~130 contratos) se caía la mitad del agresor. Un canal por cada 40 contratos,
      // misma conexión (varias conexiones chocan con el límite de sesiones de tastytrade).
      for (let i = 0; i < reqs.length; i += PULL_CHUNK) {
      const chunk = reqs.slice(i, i + PULL_CHUNK);
      const feed = new DXLinkFeed(client, FeedContract.HISTORY);
      feed.configure({ acceptEventFields: { Candle: ["eventSymbol", "time", "close", "volume", "bidVolume", "askVolume"] } });
      feed.addEventListener((events) => {
        for (const ev of events as unknown as Record<string, unknown>[]) {
          const t = Number(ev.time);
          // DXLink a veces manda velas vacías con hora FUTURA (19-nov: 10:11:08 pm con el mercado abierto).
          // Con ellas el repull pedía "desde 10 pm" y el agresor se congelaba → se descartan.
          if (!Number.isFinite(t) || t <= 0 || t > Date.now() + FUTURE_TOL_MS) continue;
          const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
          const sym = bareSymbol(String(ev.eventSymbol));
          const arr = out.get(sym) ?? [];
          arr.push({ t: Math.floor(t / 1000), v: num(ev.volume), b: num(ev.bidVolume), a: num(ev.askVolume) });
          out.set(sym, arr);
        }
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, 1500);
      });
      feed.addSubscriptions(chunk.map((r) => ({ type: "Candle", symbol: `${r.sym}{=1m}`, fromTime: r.fromMs })));
      }
    });
    client.connect(dxlinkUrl);
    client.setAuthToken(token);
  });
}

const streamerOf = (s: NestedChainStrike, side: "call" | "put"): string | null => {
  const raw = (s as unknown as Record<string, string>)[`${side}-streamer-symbol`];
  return raw || null;
};

export interface VolumeDeltaPayload {
  inst: string;
  expiration: string;
  /** Apertura de la sesión mostrada (segundos). */
  sessionOpen: number;
  /** Inicio del minuto en curso (segundos): los minutos < asOfT ya están cerrados. */
  asOfT: number;
  /** Minutos por strike: [t, cA, cB, cV, pA, pB, pV] desde `since` (incremental). */
  strikes: Record<string, number[][]>;
  /** De dónde salió: tastytrade (velas de 1 min) o MarketSnack (respaldo, tramos de 5 min). */
  source?: "tastytrade" | "marketsnack";
  /** Segundos que cubre cada fila de `strikes` (60 tastytrade, 300 MarketSnack). */
  resolutionSec?: number;
  /** NQ: ETF sumado (QQQ) y su ratio índice ÷ ETF; las cifras van en contratos equivalentes del índice. */
  etf?: { symbol: string; ratio: number };
}

const inflight = new Map<string, Promise<void>>();

/**
 * Volumen por minuto de los strikes a ±`radius` de `spot` del vencimiento `expiration`.
 * `since` (segundos): solo los minutos desde ahí (el navegador junta con lo que ya tenía).
 */
export async function loadVolumeDelta(inst: string, expiration: string, spot: number, radius: number, since: number | null): Promise<VolumeDeltaPayload> {
  const cfg = instrumentOf(inst);
  const exp = (await nestedFor(cfg.tastyChain)).find((e) => e["expiration-date"] === expiration);
  if (!exp) throw new Error(`tastytrade no tiene el vencimiento ${expiration} de ${cfg.tastyChain}.`);
  const now = Date.now();
  const open = sessionOpenMs(now);
  const strikes = exp.strikes
    .map((s) => ({ k: Number(s["strike-price"]), call: streamerOf(s, "call"), put: streamerOf(s, "put"), callOcc: occOf(s.call), putOcc: occOf(s.put) }))
    .filter((s) => Number.isFinite(s.k) && Math.abs(s.k - spot) <= radius && s.call && s.put);

  // NQ: el NDX 0DTE casi no se negocia (17-nov: ~2,900 contratos en la mañana vs ~147,000 del SPX) y el
  // agresor salía casi vacío. Se suman las opciones de QQQ del mismo vencimiento, cada strike × (NDX ÷ QQQ)
  // a la fila del NDX más cercana y en contratos EQUIVALENTES de NDX (contratos QQQ ÷ ratio, por nocional).
  const etf = cfg.chartEtf && cfg.id === "NQ" ? await etfLeg(cfg.chartEtf, expiration, spot, radius).catch(() => null) : null;

  // Pide lo que falta: lo nunca pedido desde la apertura, el resto solo los últimos 3 min.
  const reqs: { sym: string; fromMs: number }[] = [];
  for (const s of [...strikes, ...(etf?.strikes ?? [])]) {
    for (const sym of [s.call!, s.put!]) {
      const st = store.get(sym);
      // Limpia velas futuras que hayan quedado guardadas (ver FUTURE_TOL_MS).
      if (st) for (const t of [...st.bars.keys()]) if (t * 1000 > now + FUTURE_TOL_MS) st.bars.delete(t);
      if (!st || st.bars.size === 0) reqs.push({ sym, fromMs: open });
      else if (now - st.pulledAt > REPULL_MS) reqs.push({ sym, fromMs: Math.max(open, (Math.max(...st.bars.keys()) - 180) * 1000) });
    }
  }
  const key = `${cfg.id}|${expiration}`;
  if (reqs.length > 0 && now >= dxDownUntil) {
    let p = inflight.get(key);
    if (!p) {
      p = pullMany(reqs).then((got) => {
        const at = Date.now();
        for (const r of reqs) {
          const st = store.get(r.sym) ?? { bars: new Map<number, OptBar>(), pulledAt: 0 };
          for (const b of got.get(r.sym) ?? []) if (b.t * 1000 >= open) st.bars.set(b.t, b);
          st.pulledAt = at;
          store.set(r.sym, st);
        }
        if (got.size === 0) dxDownUntil = at + DX_RETRY_MS;
      }).catch(() => { dxDownUntil = Date.now() + DX_RETRY_MS; }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    await p;
  }

  const fromT = since != null && Number.isFinite(since) ? since : open / 1000;
  const out: Record<string, number[][]> = {};
  for (const s of strikes) {
    const bars = (sym: string) => [...(store.get(sym)?.bars.values() ?? [])].filter((b) => b.t >= fromT);
    const mins: StrikeMinute[] = strikeMinutes(bars(s.call!), bars(s.put!));
    if (mins.length) out[String(s.k)] = mins.map((m) => [m.t, m.cA, m.cB, m.cV, m.pA, m.pB, m.pV]);
  }
  if (etf && strikes.length) {
    const ks = strikes.map((s) => s.k).sort((a, b) => a - b);
    const nearest = (px: number) => ks.reduce((b, k) => (Math.abs(k - px) < Math.abs(b - px) ? k : b), ks[0]);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (const s of etf.strikes) {
      const bars = (sym: string) => [...(store.get(sym)?.bars.values() ?? [])].filter((b) => b.t >= fromT);
      const mins = strikeMinutes(bars(s.call!), bars(s.put!));
      if (!mins.length) continue;
      const key = String(nearest(s.k * etf.ratio));
      const byT = new Map((out[key] ?? []).map((row) => [row[0], row]));
      for (const m of mins) {
        const add = [m.cA, m.cB, m.cV, m.pA, m.pB, m.pV].map((v) => v / etf.ratio);
        const row = byT.get(m.t) ?? [m.t, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6; i++) row[i + 1] = r2(row[i + 1] + add[i]);
        byT.set(m.t, row);
      }
      out[key] = [...byT.values()].sort((a, b) => a[0] - b[0]);
    }
  }
  const asOfT = Math.floor(now / 60_000) * 60;
  // Velas viejas: si la última vela de tastytrade tiene > 3 min con la sesión abierta, DXLink se
  // trabó y la ventana de "1 min" saldría vacía (el panel se borraba entero) → respaldo MarketSnack.
  let newest = -Infinity;
  // Incluye QQQ: el NDX pasa minutos sin operaciones y eso no es que DXLink esté trabado.
  for (const s of [...strikes, ...(etf?.strikes ?? [])]) for (const sym of [s.call!, s.put!]) for (const t of store.get(sym)?.bars.keys() ?? []) if (t > newest) newest = t;
  const inSession = now - open > STALE_SEC * 1000 && now - open < 6.5 * 3600_000; // 9:33–16:00 NY
  const stale = inSession && newest > -Infinity && asOfT - newest > STALE_SEC;
  if (stale) dxDownUntil = Math.max(dxDownUntil, now + DX_RETRY_MS);
  // tastytrade no dio nada (DXLink caído) o se quedó atrás: respaldo de MarketSnack.
  if ((Object.keys(out).length === 0 || stale) && now < dxDownUntil) {
    // Siempre el día completo (está en caché 60 s): si el navegador venía de tastytrade, rearma todo.
    const ms = await msStrikes(strikes.filter((s) => s.callOcc && s.putOcc), open, open / 1000).catch(() => ({}));
    if (Object.keys(ms).length > 0) {
      return { inst: cfg.id, expiration, sessionOpen: open / 1000, asOfT, strikes: ms, source: "marketsnack", resolutionSec: MS_BUCKET_SEC };
    }
  }
  return { inst: cfg.id, expiration, sessionOpen: open / 1000, asOfT, strikes: out, source: "tastytrade", resolutionSec: 60, etf: etf ? { symbol: cfg.chartEtf!, ratio: etf.ratio } : undefined };
}

/** Precio del ETF (caché 60 s) y sus strikes del vencimiento dentro del rango del índice. */
const etfPx = new Map<string, { at: number; px: number }>();
async function etfLeg(sym: string, expiration: string, spot: number, radius: number) {
  let c = etfPx.get(sym);
  if (!c || Date.now() - c.at > 60_000) {
    const q = (await fetchLiveQuotes({ equity: [sym] })).get(sym);
    if (!q) return null;
    c = { at: Date.now(), px: q.price };
    etfPx.set(sym, c);
  }
  const ratio = spot / c.px;
  if (!(ratio > 0)) return null;
  const exp = (await nestedFor(sym)).find((e) => e["expiration-date"] === expiration);
  if (!exp) return null;
  const strikes = exp.strikes
    .map((s) => ({ k: Number(s["strike-price"]), call: streamerOf(s, "call"), put: streamerOf(s, "put") }))
    .filter((s) => Number.isFinite(s.k) && Math.abs(s.k * ratio - spot) <= radius && s.call && s.put);
  return { ratio, strikes };
}
