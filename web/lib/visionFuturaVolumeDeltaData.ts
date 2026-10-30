// Datos del volumen DELTA minuto a minuto (ver lib/visionFuturaVolumeDelta.ts, puro).
// Velas de 1 min de cada call y put del rango visible, con volumen al bid y al ask, del streaming
// DXLink de tastytrade: UNA sola conexión corta para todos los contratos. La primera vez se pide
// la sesión completa; después solo los últimos minutos de cada contrato (se guardan en memoria).
// Solo servidor.

import { DXLinkWebSocketClient } from "@dxfeed/dxlink-websocket-client";
import { DXLinkFeed, FeedContract } from "@dxfeed/dxlink-feed";
import { fetchQuoteToken, type NestedChainStrike } from "./tastytrade";
import { nestedFor } from "./visionFuturaData";
import { instrumentOf } from "./visionFuturaInstruments";
import { bareSymbol, strikeMinutes, type OptBar, type StrikeMinute } from "./visionFuturaVolumeDelta";

/** Velas en memoria por símbolo de DXLink (".SPXW261029C7720"), por minuto. */
const store = new Map<string, { bars: Map<number, OptBar>; pulledAt: number }>();
const REPULL_MS = 15_000;

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
      const feed = new DXLinkFeed(client, FeedContract.HISTORY);
      feed.configure({ acceptEventFields: { Candle: ["eventSymbol", "time", "close", "volume", "bidVolume", "askVolume"] } });
      feed.addEventListener((events) => {
        for (const ev of events as unknown as Record<string, unknown>[]) {
          const t = Number(ev.time);
          if (!Number.isFinite(t) || t <= 0) continue;
          const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
          const sym = bareSymbol(String(ev.eventSymbol));
          const arr = out.get(sym) ?? [];
          arr.push({ t: Math.floor(t / 1000), v: num(ev.volume), b: num(ev.bidVolume), a: num(ev.askVolume) });
          out.set(sym, arr);
        }
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(finish, 1500);
      });
      feed.addSubscriptions(reqs.map((r) => ({ type: "Candle", symbol: `${r.sym}{=1m}`, fromTime: r.fromMs })));
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
    .map((s) => ({ k: Number(s["strike-price"]), call: streamerOf(s, "call"), put: streamerOf(s, "put") }))
    .filter((s) => Number.isFinite(s.k) && Math.abs(s.k - spot) <= radius && s.call && s.put);

  // Pide lo que falta: lo nunca pedido desde la apertura, el resto solo los últimos 3 min.
  const reqs: { sym: string; fromMs: number }[] = [];
  for (const s of strikes) {
    for (const sym of [s.call!, s.put!]) {
      const st = store.get(sym);
      if (!st || st.bars.size === 0) reqs.push({ sym, fromMs: open });
      else if (now - st.pulledAt > REPULL_MS) reqs.push({ sym, fromMs: Math.max(open, (Math.max(...st.bars.keys()) - 180) * 1000) });
    }
  }
  const key = `${cfg.id}|${expiration}`;
  if (reqs.length > 0) {
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
      }).finally(() => inflight.delete(key));
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
  return { inst: cfg.id, expiration, sessionOpen: open / 1000, asOfT: Math.floor(now / 60_000) * 60, strikes: out };
}
