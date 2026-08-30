// Streamer de FLUJO para índices/ETF de Tastytrade (DXLink/DXFeed).
// Generaliza el streamer de SPX (tastytrade-stream.mjs) a varios tickers
// (default SPY, QQQ) — mismo motor, misma FUENTE PRIMARIA para Agente ODTE.
// NO toca el streamer de SPX, que corre aparte.
//
//   Escribe el acumulador VIVO en data/0dte/<TICKER>-<fecha>.json (mismo
//   formato FlowAccumulator), que /api/0dte/flow y lib/zerodte.ts leen.
//   Una conexión WebSocket por ticker (≤ ~1000 feeds c/u, techo estable).
//
//   TICKERS="SPY,QQQ" (env) · Node 22+ (WebSocket global).
//   "C:\Program Files\nodejs\node.exe" streamer/tastytrade-index-stream.mjs

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTopTrades, cfgFor } from "./lib/top-trades.mjs";

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const l of readFileSync(path.join(WEB, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const API = "https://api.tastytrade.com";
const HDRS = { "Content-Type": "application/json", "User-Agent": "visionary-0dte-idxstream/1.0", Accept: "application/json" };
const TICKERS = (process.env.TICKERS || env.STREAM_TICKERS || "SPY,QQQ").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const WINDOW = Number(process.env.STREAM_WINDOW || env.STREAM_WINDOW || 100); // strikes ATM por ticker (1 conexión c/u)
const OUT_DIR = path.join(WEB, "data", "0dte"); // fuente VIVA que lee el agente
const nowT = () => new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
const log = (...a) => console.log(`[${nowT()}]`, ...a);
const nf = (n) => Number(n).toLocaleString("en-US");
const etDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// --- REST ----------------------------------------------------------------
async function accessToken() {
  const r = await fetch(`${API}/oauth/token`, { method: "POST", headers: HDRS,
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: env.TASTYTRADE_REFRESH_TOKEN, client_secret: env.TASTYTRADE_CLIENT_SECRET }) });
  const j = await r.json(); if (!r.ok) throw new Error(`/oauth/token ${r.status}`); return j.access_token;
}
async function quoteToken(bearer) {
  const r = await fetch(`${API}/api-quote-tokens`, { headers: { ...HDRS, Authorization: `Bearer ${bearer}` } });
  const j = await r.json(); if (!r.ok) throw new Error(`/api-quote-tokens ${r.status}`); return { token: j.data.token, url: j.data["dxlink-url"] };
}
// Cadena de opciones del vencimiento más cercano (>= hoy). Símbolos de streamer por strike.
async function nearChain(bearer, ticker) {
  const r = await fetch(`${API}/option-chains/${ticker}/nested`, { headers: { ...HDRS, Authorization: `Bearer ${bearer}` } });
  const j = await r.json(); if (!r.ok) throw new Error(`/option-chains ${ticker} ${r.status}`);
  const today = etDate();
  const exps = (j.data?.items || []).flatMap((it) => it.expirations || [])
    .filter((e) => e["expiration-date"] && e["expiration-date"] >= today)
    .sort((a, b) => String(a["expiration-date"]).localeCompare(String(b["expiration-date"])));
  const near = exps[0];
  if (!near) throw new Error(`sin vencimientos para ${ticker}`);
  const strikes = (near.strikes || []).map((s) => ({ strike: Number(s["strike-price"]), call: s["call-streamer-symbol"], put: s["put-streamer-symbol"] }))
    .filter((s) => (s.call || s.put) && Number.isFinite(s.strike)).sort((a, b) => a.strike - b.strike);
  return { strikes, exp: near["expiration-date"] };
}

// --- acumulador (formato FlowAccumulator, uno por ticker) -----------------
const books = Object.fromEntries(TICKERS.map((t) => [t, new Map()]));
const lastTrade = Object.fromEntries(TICKERS.map((t) => [t, 0]));
const lastSpot = Object.fromEntries(TICKERS.map((t) => [t, null]));
const lastExp = Object.fromEntries(TICKERS.map((t) => [t, null]));
const topTrades = Object.fromEntries(TICKERS.map((t) => [t, createTopTrades(cfgFor(t))]));
const seen = new Set();
let cycles = 0;
let booksDay = null;

function ensureDay() {
  const d = etDate();
  if (booksDay === d) return;
  if (booksDay !== null) log(`nuevo día ET (${booksDay} → ${d}): reseteando acumulado`);
  for (const t of TICKERS) { books[t] = new Map(); lastTrade[t] = 0; lastSpot[t] = null; topTrades[t].reset(); }
  seen.clear();
  booksDay = d;
}
function loadExisting() {
  const date = etDate();
  for (const t of TICKERS) {
    try {
      const prev = JSON.parse(readFileSync(path.join(OUT_DIR, `${t}-${date}.json`), "utf8"));
      if (prev.date === date && prev.buckets && prev.source === "tastytrade") { books[t] = new Map(Object.entries(prev.buckets)); log(`[${t}] continuando acumulado del día (${books[t].size} strikes)`); }
    } catch { /* no había */ }
  }
  booksDay = date;
}
function bucket(ticker, type, strike) {
  const key = `${type}:${strike}`;
  let b = books[ticker].get(key);
  if (!b) { b = { strike, type, ask: 0, bid: 0, mid: 0, trades: 0, volume: 0, oi: 0, gamma: null, delta: null, iv: null, bidPrice: null, askPrice: null, ts: 0 }; books[ticker].set(key, b); }
  return b;
}
function onOption(e, info) {
  const t = e.eventType, ticker = info.ticker;
  if (t === "TimeAndSale") {
    const key = e.index != null ? `${e.eventSymbol}:${e.index}` : `${e.eventSymbol}:${e.time}:${e.size}`;
    if (seen.has(key)) return;
    if (seen.size > 800000) seen.clear();
    seen.add(key);
  }
  const b = bucket(ticker, info.type, info.strike);
  const tm = Number(e.time) || 0; if (tm > b.ts) b.ts = tm;
  if (t === "TimeAndSale") {
    const size = Number(e.size) || 0;
    const side = String(e.aggressorSide ?? "").trim().toLowerCase();
    if (side.startsWith("b")) b.ask += size; else if (side.startsWith("s")) b.bid += size; else b.mid += size;
    b.trades += 1; if (tm > lastTrade[ticker]) lastTrade[ticker] = tm;
    topTrades[ticker].consider(e, info, b); // ¿bloque grande que califica?
  } else if (t === "Trade") { if (Number.isFinite(e.dayVolume)) b.volume = Math.max(b.volume, Number(e.dayVolume)); }
  else if (t === "Summary") { if (Number.isFinite(e.openInterest)) b.oi = Math.max(b.oi, Number(e.openInterest)); }
  else if (t === "Greeks") { if (Number.isFinite(e.gamma)) b.gamma = e.gamma; if (Number.isFinite(e.delta)) b.delta = e.delta; if (Number.isFinite(e.volatility)) b.iv = e.volatility; }
  else if (t === "Quote") { if (Number.isFinite(e.bidPrice)) b.bidPrice = e.bidPrice; if (Number.isFinite(e.askPrice)) b.askPrice = e.askPrice; }
}
function writeOne(ticker) {
  ensureDay();
  cycles += 1;
  const date = etDate();
  try { mkdirSync(OUT_DIR, { recursive: true }); } catch { /* */ }
  const obj = { ticker, date, exp: lastExp[ticker] || null, updatedAt: new Date().toISOString(), cycles, source: "tastytrade", spot: lastSpot[ticker], buckets: Object.fromEntries(books[ticker]), topTrades: topTrades[ticker].list, seenIds: [] };
  const file = path.join(OUT_DIR, `${ticker}-${date}.json`);
  try { const tmp = file + ".tmp"; writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, file); } catch (e) { log(`[${ticker}] write err:`, e.message); }
}
function reportOne(ticker) {
  let buy = 0, sell = 0, vol = 0, withGreeks = 0;
  for (const b of books[ticker].values()) { buy += b.ask; sell += b.bid; vol += b.volume; if (b.gamma != null) withGreeks++; }
  const cvd = buy - sell; const ageS = lastTrade[ticker] ? Math.round((Date.now() - lastTrade[ticker]) / 1000) : "—";
  log(`[${ticker}] CVD ${cvd >= 0 ? "+" : ""}${nf(cvd)} · vol ${nf(vol)} · strikes ${books[ticker].size} (${withGreeks} c/griegos) · trade hace ${ageS}s`);
}

// --- una conexión por ticker (2 fases: aprende spot del subyacente → ATM) ---
async function connectTicker(ticker) {
  const bearer = await accessToken();
  const { token, url } = await quoteToken(bearer);
  const chain = await nearChain(bearer, ticker);
  const exp = chain.exp;
  lastExp[ticker] = exp;
  log(`[${ticker}] 0DTE ${exp} · ${chain.strikes.length} strikes en la cadena`);

  const optMeta = new Map();
  let spot = null;

  return new Promise((resolve) => {
    const ws = new WebSocket(url); const send = (o) => ws.send(JSON.stringify(o));
    let ka, rep, phase2;
    const done = () => { clearInterval(ka); clearInterval(rep); clearTimeout(phase2); try { ws.close(); } catch {} resolve(); };
    ws.addEventListener("open", () => send({ type: "SETUP", channel: 0, version: "0.1-idx/1.0", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "AUTH_STATE" && m.state === "UNAUTHORIZED") return send({ type: "AUTH", channel: 0, token });
      if (m.type === "AUTH_STATE" && m.state === "AUTHORIZED") { ka = setInterval(() => send({ type: "KEEPALIVE", channel: 0 }), 25000); return send({ type: "CHANNEL_REQUEST", channel: 1, service: "FEED", parameters: { contract: "AUTO" } }); }
      if (m.type === "CHANNEL_OPENED") {
        send({ type: "FEED_SETUP", channel: 1, acceptAggregationPeriod: 0.5, acceptDataFormat: "FULL",
          acceptEventFields: {
            TimeAndSale: ["eventType", "eventSymbol", "price", "size", "aggressorSide", "spreadLeg", "exchangeSaleConditions", "time", "index"],
            Trade: ["eventType", "eventSymbol", "price", "dayVolume", "time"],
            Summary: ["eventType", "eventSymbol", "openInterest", "time"],
            Greeks: ["eventType", "eventSymbol", "gamma", "delta", "volatility", "time"],
            Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice"],
          } });
        // Fase 1: subyacente (SPY/QQQ son equities → símbolo = ticker) para el spot.
        send({ type: "FEED_SUBSCRIPTION", channel: 1, add: [{ type: "Quote", symbol: ticker }, { type: "Trade", symbol: ticker }] });
        phase2 = setTimeout(() => {
          if (!spot || !chain.strikes?.length) { log(`[${ticker}] sin spot para elegir ATM (¿fuera de horario?)`); }
          else {
            const atm = chain.strikes.map((s) => ({ ...s, d: Math.abs(s.strike - spot) })).sort((a, b) => a.d - b.d).slice(0, WINDOW);
            log(`[${ticker}] spot ${spot} → ${atm.length} strikes ATM (${Math.min(...atm.map((s) => s.strike))}–${Math.max(...atm.map((s) => s.strike))})`);
            const optSubs = [];
            for (const s of atm) for (const [sym, type] of [[s.call, "call"], [s.put, "put"]]) {
              if (!sym) continue;
              optMeta.set(sym, { ticker, type, strike: s.strike });
              for (const ty of ["TimeAndSale", "Trade", "Summary", "Greeks", "Quote"]) optSubs.push({ type: ty, symbol: sym });
            }
            if (optSubs.length) { send({ type: "FEED_SUBSCRIPTION", channel: 1, add: optSubs }); log(`[${ticker}] suscrito a ${optSubs.length} feeds. acumulando…`); }
          }
          rep = setInterval(() => { writeOne(ticker); reportOne(ticker); }, 10000);
        }, 5000);
        return;
      }
      if (m.type === "FEED_DATA") for (const e of (m.data || [])) {
        if (!e || !e.eventType) continue;
        if (e.eventSymbol === ticker) {
          if (e.eventType === "Trade" && Number.isFinite(e.price)) { spot = e.price; lastSpot[ticker] = e.price; }
          else if (e.eventType === "Quote" && Number.isFinite(e.bidPrice) && Number.isFinite(e.askPrice)) { const mid = (e.bidPrice + e.askPrice) / 2; if (!spot) spot = mid; lastSpot[ticker] = mid; }
          continue;
        }
        const info = optMeta.get(e.eventSymbol); if (info) onOption(e, info);
      }
    });
    ws.addEventListener("close", (ev) => { log(`[${ticker}] WS cerrado`, "code=" + (ev?.code ?? "?")); done(); });
    ws.addEventListener("error", (er) => { log(`[${ticker}] WS error:`, er.message || er.type); done(); });
    setTimeout(() => { log(`[${ticker}] reciclando conexión…`); done(); }, 12 * 60 * 1000);
  });
}

async function superviseTicker(ticker) {
  for (;;) {
    try { await connectTicker(ticker); } catch (e) { log(`[${ticker}] error:`, e.message); }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  if (!env.TASTYTRADE_REFRESH_TOKEN || !env.TASTYTRADE_CLIENT_SECRET) throw new Error("Faltan credenciales OAuth de Tastytrade en .env.local");
  log(`Streamer ÍNDICE/ETF — tickers ${TICKERS.join(", ")} · 1 conexión c/u · escribe data/0dte · Ctrl+C para parar`);
  loadExisting();
  await Promise.all(TICKERS.map((t) => superviseTicker(t)));
}
main().catch((e) => { console.error("IDXSTREAM FATAL:", e.message); process.exitCode = 1; });
