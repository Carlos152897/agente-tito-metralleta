// Streamer de FUTUROS NATIVOS de Tastytrade (DXLink/DXFeed) — /ES y /NQ (CME).
// Acumula el flujo del 0DTE de las OPCIONES DE FUTURO nativas en el MISMO
// formato que el FlowAccumulator del agente (buckets con ask/bid/mid del
// AGRESOR + volumen + OI + griegos + quotes). El subyacente es el futuro real
// (/ESU26, /NQU26) y sus opciones, que cotizan ~23h → da señal real de noche,
// cuando SPX/NDX (índice cash) ya cerró.
//
// Escribe data/tastytrade-fut/{ES,NQ}-<fecha>.json — archivo propio, no toca
// data/0dte/ ni data/0dte-stream/ (los otros streamers de este proyecto).
//
//   "C:\Program Files\nodejs\node.exe" streamer/tastytrade-futures-stream.mjs
//
// Credenciales OAuth en web/.env.local (TASTYTRADE_CLIENT_SECRET/REFRESH_TOKEN,
// las mismas que ya usa lib/tastytrade.ts). Node 22+ (WebSocket global).

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
const HDRS = { "Content-Type": "application/json", "User-Agent": "visionary-0dte-futstream/1.0", Accept: "application/json" };
const PRODUCTS = ["ES", "NQ"];
// Strikes ATM por producto (call+put c/u). Cada producto va en SU PROPIA conexión
// (ver connectProduct): 100 strikes × 2 símbolos × 5 eventos = ~1000 feeds por
// conexión — 2 productos juntos en una sola conexión tumbaba el WebSocket.
const WINDOW = Number(process.env.STREAM_WINDOW || env.STREAM_WINDOW || 100);
const OUT_DIR = path.join(WEB, "data", "tastytrade-fut");
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
// Futuro front-month activo del producto (con su streamer-symbol de DXFeed).
async function activeFuture(bearer, code) {
  const r = await fetch(`${API}/instruments/futures?product-code=${code}`, { headers: { ...HDRS, Authorization: `Bearer ${bearer}` } });
  const j = await r.json(); if (!r.ok) throw new Error(`/instruments/futures ${code} ${r.status}`);
  const items = j.data?.items || [];
  const fut = items.find((x) => x["active-month"]) || items.sort((a, b) => String(a["expiration-date"]).localeCompare(String(b["expiration-date"])))[0];
  if (!fut) throw new Error(`sin futuros para ${code}`);
  return { symbol: fut.symbol, streamer: fut["streamer-symbol"] };
}
// Extrae los "expirations" (cada uno con days-to-expiration + strikes) de forma robusta.
function findExpirations(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) { for (const x of obj) findExpirations(x, out); return out; }
  if (Array.isArray(obj.strikes) && (obj["expiration-date"] || obj["days-to-expiration"] != null)) {
    const strikes = obj.strikes.map((s) => ({ strike: Number(s["strike-price"]), call: s["call-streamer-symbol"], put: s["put-streamer-symbol"] })).filter((s) => (s.call || s.put) && Number.isFinite(s.strike));
    out.push({ date: obj["expiration-date"], dte: Number(obj["days-to-expiration"] ?? 999), strikes });
  }
  for (const k of Object.keys(obj)) if (typeof obj[k] === "object") findExpirations(obj[k], out);
  return out;
}
// Ladder de strikes del vencimiento más cercano (>= hoy) de las opciones del futuro.
async function nearChain(bearer, code) {
  const r = await fetch(`${API}/futures-option-chains/${code}/nested`, { headers: { ...HDRS, Authorization: `Bearer ${bearer}` } });
  const j = await r.json(); if (!r.ok) throw new Error(`/futures-option-chains ${code} ${r.status}`);
  const exps = findExpirations(j.data).filter((e) => e.strikes.length).sort((a, b) => a.dte - b.dte);
  const near = exps.find((e) => e.dte >= 0) || exps[0];
  if (!near) throw new Error(`sin vencimientos para ${code}`);
  return { strikes: near.strikes.sort((a, b) => a.strike - b.strike), exp: near.date, dte: near.dte };
}

// --- acumulador (formato FlowAccumulator del agente, uno por producto) ----
const books = Object.fromEntries(PRODUCTS.map((c) => [c, new Map()])); // code -> ("call:7735" -> AggBucket)
const lastTrade = Object.fromEntries(PRODUCTS.map((c) => [c, 0]));
const lastSpot = Object.fromEntries(PRODUCTS.map((c) => [c, null])); // precio vivo del futuro (para el archivo)
const topTrades = Object.fromEntries(PRODUCTS.map((c) => [c, createTopTrades(cfgFor(c))]));
const seen = new Set(); // dedup TimeAndSale por índice (evita doble conteo al reconectar)
let booksDay = null; // día ET al que pertenece el acumulado (para resetear al cambiar de día)

// El acumulado es INTRADÍA: al cruzar la medianoche ET hay que vaciarlo, o los
// buckets de ayer (que siguen en memoria) se escribirían en el archivo de hoy.
function ensureDay() {
  const d = etDate();
  if (booksDay === d) return;
  if (booksDay !== null) log(`nuevo día ET (${booksDay} → ${d}): reseteando acumulado`);
  for (const code of PRODUCTS) { books[code] = new Map(); lastTrade[code] = 0; lastSpot[code] = null; topTrades[code].reset(); }
  seen.clear();
  booksDay = d;
}

function loadExisting() {
  const date = etDate();
  for (const code of PRODUCTS) {
    try {
      const prev = JSON.parse(readFileSync(path.join(OUT_DIR, `${code}-${date}.json`), "utf8"));
      if (prev.date === date && prev.buckets) { books[code] = new Map(Object.entries(prev.buckets)); log(`[${code}] continuando acumulado del día (${books[code].size} strikes)`); }
    } catch { /* no había */ }
  }
  booksDay = date; // el acumulado cargado pertenece a HOY
}
function bucket(code, type, strike) {
  const key = `${type}:${strike}`;
  let b = books[code].get(key);
  if (!b) { b = { strike, type, ask: 0, bid: 0, mid: 0, trades: 0, volume: 0, oi: 0, gamma: null, delta: null, iv: null, bidPrice: null, askPrice: null, ts: 0 }; books[code].set(key, b); }
  return b;
}
function onOption(e, info) {
  const t = e.eventType, code = info.product;
  if (t === "TimeAndSale") {
    const key = e.index != null ? `${e.eventSymbol}:${e.index}` : `${e.eventSymbol}:${e.time}:${e.size}`;
    if (seen.has(key)) return;
    if (seen.size > 800000) seen.clear();
    seen.add(key);
  }
  const b = bucket(code, info.type, info.strike);
  const tm = Number(e.time) || 0; if (tm > b.ts) b.ts = tm;
  if (t === "TimeAndSale") {
    const size = Number(e.size) || 0;
    const side = String(e.aggressorSide ?? "").trim().toLowerCase();
    if (side.startsWith("b")) b.ask += size; else if (side.startsWith("s")) b.bid += size; else b.mid += size;
    b.trades += 1; if (tm > lastTrade[code]) lastTrade[code] = tm;
    topTrades[code].consider(e, info, b); // ¿bloque grande que califica?
  } else if (t === "Trade") { if (Number.isFinite(e.dayVolume)) b.volume = Math.max(b.volume, Number(e.dayVolume)); }
  else if (t === "Summary") { if (Number.isFinite(e.openInterest)) b.oi = Math.max(b.oi, Number(e.openInterest)); }
  else if (t === "Greeks") { if (Number.isFinite(e.gamma)) b.gamma = e.gamma; if (Number.isFinite(e.delta)) b.delta = e.delta; if (Number.isFinite(e.volatility)) b.iv = e.volatility; }
  else if (t === "Quote") { if (Number.isFinite(e.bidPrice)) b.bidPrice = e.bidPrice; if (Number.isFinite(e.askPrice)) b.askPrice = e.askPrice; }
}

// Escribe el archivo de UN producto (cada conexión escribe el suyo).
function writeOne(code, exp) {
  ensureDay(); // vacía el acumulado si cruzamos a un nuevo día ET
  const date = etDate();
  try { mkdirSync(OUT_DIR, { recursive: true }); } catch { /* */ }
  const obj = { ticker: code, date, exp: exp || null, spot: lastSpot[code], updatedAt: new Date().toISOString(), source: "tastytrade-futures", buckets: Object.fromEntries(books[code]), topTrades: topTrades[code].list };
  const file = path.join(OUT_DIR, `${code}-${date}.json`);
  try { const tmp = file + ".tmp"; writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, file); } catch (e) { log(`[${code}] write err:`, e.message); }
}
function reportOne(code) {
  let buy = 0, sell = 0, vol = 0, withGreeks = 0;
  for (const b of books[code].values()) { buy += b.ask; sell += b.bid; vol += b.volume; if (b.gamma != null) withGreeks++; }
  const cvd = buy - sell; const ageS = lastTrade[code] ? Math.round((Date.now() - lastTrade[code]) / 1000) : "—";
  log(`[${code}] CVD ${cvd >= 0 ? "+" : ""}${nf(cvd)} · vol ${nf(vol)} · strikes ${books[code].size} (${withGreeks} c/griegos) · spot ${lastSpot[code] ?? "—"} · trade hace ${ageS}s`);
}

// --- una conexión para UN producto (2 fases: aprende spot → suscribe ATM) ---
async function connectProduct(code) {
  const bearer = await accessToken();
  const { token, url } = await quoteToken(bearer);
  const fut = await activeFuture(bearer, code);
  const chain = await nearChain(bearer, code);
  const exp = chain.exp;
  const futStreamer = fut.streamer;
  log(`[${code}] futuro ${fut.symbol} (${futStreamer}) · 0DTE ${chain.exp} (DTE ${chain.dte}, ${chain.strikes.length} strikes)`);

  const optMeta = new Map(); // optSymbol -> {product,type,strike}
  let spot = null;

  return new Promise((resolve) => {
    const ws = new WebSocket(url); const send = (o) => ws.send(JSON.stringify(o));
    let ka, rep, phase2;
    const done = () => { clearInterval(ka); clearInterval(rep); clearTimeout(phase2); try { ws.close(); } catch {} resolve(); };
    ws.addEventListener("open", () => send({ type: "SETUP", channel: 0, version: "0.1-fut/1.0", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
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
        // Fase 1: suscribe el futuro para aprender el precio.
        send({ type: "FEED_SUBSCRIPTION", channel: 1, add: [{ type: "Quote", symbol: futStreamer }, { type: "Trade", symbol: futStreamer }] });
        // Fase 2 (5 s después): elige ATM por cercanía al spot y suscribe las opciones.
        phase2 = setTimeout(() => {
          if (!spot || !chain.strikes?.length) { log(`[${code}] sin spot para elegir ATM (¿fuera de horario?)`); }
          else {
            const atm = chain.strikes.map((s) => ({ ...s, d: Math.abs(s.strike - spot) })).sort((a, b) => a.d - b.d).slice(0, WINDOW);
            log(`[${code}] spot ${spot} → ${atm.length} strikes ATM (${Math.min(...atm.map((s) => s.strike))}–${Math.max(...atm.map((s) => s.strike))})`);
            const optSubs = [];
            for (const s of atm) for (const [sym, type] of [[s.call, "call"], [s.put, "put"]]) {
              if (!sym) continue;
              optMeta.set(sym, { product: code, type, strike: s.strike });
              for (const ty of ["TimeAndSale", "Trade", "Summary", "Greeks", "Quote"]) optSubs.push({ type: ty, symbol: sym });
            }
            if (optSubs.length) { send({ type: "FEED_SUBSCRIPTION", channel: 1, add: optSubs }); log(`[${code}] suscrito a ${optSubs.length} feeds de opciones. acumulando…`); }
          }
          rep = setInterval(() => { writeOne(code, exp); reportOne(code); }, 10000);
        }, 5000);
        return;
      }
      if (m.type === "FEED_DATA") for (const e of (m.data || [])) {
        if (!e || !e.eventType) continue;
        if (e.eventSymbol === futStreamer) {
          if (e.eventType === "Trade" && Number.isFinite(e.price)) { spot = e.price; lastSpot[code] = e.price; }
          else if (e.eventType === "Quote" && Number.isFinite(e.bidPrice) && Number.isFinite(e.askPrice)) { const mid = (e.bidPrice + e.askPrice) / 2; if (!spot) spot = mid; lastSpot[code] = mid; }
          continue;
        }
        const info = optMeta.get(e.eventSymbol); if (info) onOption(e, info);
      }
    });
    ws.addEventListener("close", (ev) => { log(`[${code}] WS cerrado`, "code=" + (ev?.code ?? "?"), ev?.reason ? "reason=" + ev.reason : ""); done(); });
    ws.addEventListener("error", (er) => { log(`[${code}] WS error:`, er.message || er.type); done(); });
    setTimeout(() => { log(`[${code}] reciclando conexión (token/strikes/spot)…`); done(); }, 12 * 60 * 1000);
  });
}

// Supervisor por producto: reconecta para siempre, independiente del otro.
async function superviseProduct(code) {
  for (;;) {
    try { await connectProduct(code); } catch (e) { log(`[${code}] error:`, e.message); }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  if (!env.TASTYTRADE_REFRESH_TOKEN || !env.TASTYTRADE_CLIENT_SECRET) throw new Error("Faltan credenciales OAuth de Tastytrade en .env.local");
  log(`Streamer FUTUROS NATIVOS (ES/NQ) — escribe data/tastytrade-fut/ · 1 conexión por producto · Ctrl+C para parar`);
  loadExisting();
  await Promise.all(PRODUCTS.map((code) => superviseProduct(code)));
}
main().catch((e) => { console.error("FUTSTREAM FATAL:", e.message); process.exitCode = 1; });
