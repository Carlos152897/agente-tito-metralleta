// Streamer de Tastytrade (DXLink/DXFeed) — FUENTE PRIMARIA de SPX para Agente
// ODTE (porte fiel del motor del proyecto standalone Agente 0DTE). Escribe el
// acumulador VIVO en data/0dte/SPX-<fecha>.json (cadena + agresor/CVD +
// contratos entrantes, todo en un solo archivo) — REEMPLAZA a MarketSnack
// como fuente para esta pestaña (pedido explícito de Carlos, ago 2026):
// /api/0dte/flow y lib/zerodte.ts ya no pollean MarketSnack para SPX/SPY/QQQ,
// solo LEEN lo que este streamer (y tastytrade-index-stream.mjs para SPY/QQQ)
// ya escribió. MarketSnack sigue viva sin cambios en el resto de la app.
//
//   "C:\Program Files\nodejs\node.exe" streamer/tastytrade-stream.mjs
//
// Credenciales OAuth en web/.env.local (TASTYTRADE_CLIENT_SECRET/REFRESH_TOKEN,
// ya usadas por lib/tastytrade.ts para la cadena 0DTE). Node 22+ (WebSocket global).
// Requiere `npm run dev` (o el server) corriendo en :3000 para leer el spot
// (SPX no tiene streamer-symbol propio en DXFeed; se deriva por paridad put-call
// desde la cadena que ya calcula la app).

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
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
const HDRS = { "Content-Type": "application/json", "User-Agent": "visionary-0dte-stream/1.0", Accept: "application/json" };
const WINDOW = Number(process.env.STREAM_WINDOW || env.STREAM_WINDOW || 110); // strikes ATM (call+put c/u)
const LOCAL_APP = process.env.STREAM_LOCAL_APP || env.STREAM_LOCAL_APP || "http://localhost:3000";
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
async function chainWindow(bearer) {
  const spot = await localSpot();
  const r = await fetch(`${API}/option-chains/SPX/nested`, { headers: { ...HDRS, Authorization: `Bearer ${bearer}` } });
  const j = await r.json();
  const exps = (j.data.items || []).flatMap((it) => it.expirations || []);
  exps.sort((a, b) => String(a["expiration-date"]).localeCompare(String(b["expiration-date"])));
  // El 0DTE del SPX que TRADEA hoy es el PM-settled (.SPXW). En el 3er viernes (OpEx
  // mensual) hay TAMBIÉN un contrato AM-settled (.SPX) con la MISMA fecha, pero ese
  // deja de cotizar el jueves previo. Preferimos SIEMPRE el PM-settled.
  const pick0 = exps.find((e) => e["settlement-type"] === "PM") ?? exps[0];
  const strikes = (pick0?.strikes || []).slice().sort((a, b) => Number(a["strike-price"]) - Number(b["strike-price"]));
  const near = spot > 0
    ? strikes.slice().sort((a, b) => Math.abs(Number(a["strike-price"]) - spot) - Math.abs(Number(b["strike-price"]) - spot)).slice(0, WINDOW)
    : strikes.slice(Math.max(0, strikes.length / 2 - WINDOW / 2) | 0, (strikes.length / 2 + WINDOW / 2) | 0);
  const syms = [];
  const meta = new Map();
  for (const s of near) {
    for (const [k, type] of [["call-streamer-symbol", "call"], ["put-streamer-symbol", "put"]]) {
      const sym = s[k]; if (!sym) continue;
      syms.push(sym); meta.set(sym, { type, strike: Number(s["strike-price"]) });
    }
  }
  return { syms, meta, exp: pick0?.["expiration-date"], spot };
}
function localSpot() {
  return new Promise((res) => {
    const req = httpRequest(`${LOCAL_APP}/api/0dte?ticker=SPX`, (r) => {
      let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => { try { res(JSON.parse(b).spot); } catch { res(null); } });
    });
    req.on("error", () => res(null)); req.setTimeout(8000, () => req.destroy()); req.end();
  });
}

// --- acumulador propio (solo para topTrades; buckets van igual por si sirven) ---
let buckets = new Map();
let meta = new Map();
const seen = new Set();
let cycles = 0, lastTradeMs = 0, exp = null;
const topTrades = createTopTrades(cfgFor("SPX"));
let accDay = null;

const OUT_DIR = path.join(WEB, "data", "0dte");

function loadExisting() {
  try {
    const date = etDate();
    const prev = JSON.parse(readFileSync(path.join(OUT_DIR, `SPX-${date}.json`), "utf8"));
    if (prev.date === date && prev.buckets) {
      const newest = Math.max(0, ...Object.values(prev.buckets).map((b) => Number(b?.ts) || 0));
      if (newest > 0 && Date.now() - newest <= 8 * 3600 * 1000) {
        buckets = new Map(Object.entries(prev.buckets)); accDay = date;
        log(`continuando acumulado del día (${buckets.size} strikes)`);
      } else {
        log(`archivo de hoy con data vieja → arranco limpio`);
      }
    }
  } catch { /* no había */ }
}
function bucket(type, strike) {
  const key = `${type}:${strike}`;
  let b = buckets.get(key);
  if (!b) { b = { strike, type, ask: 0, bid: 0, mid: 0, trades: 0, volume: 0, oi: 0, gamma: null, delta: null, iv: null, bidPrice: null, askPrice: null, ts: 0 }; buckets.set(key, b); }
  return b;
}
function onEvent(e) {
  const t = e.eventType; const info = meta.get(e.eventSymbol); if (!info) return;
  if (t === "TimeAndSale") {
    const key = e.index != null ? `${e.eventSymbol}:${e.index}` : `${e.eventSymbol}:${e.time}:${e.size}`;
    if (seen.has(key)) return;
    if (seen.size > 800000) seen.clear();
    seen.add(key);
  }
  const b = bucket(info.type, info.strike);
  const tm = Number(e.time) || 0; if (tm > b.ts) b.ts = tm;
  if (t === "TimeAndSale") {
    const size = Number(e.size) || 0;
    const side = String(e.aggressorSide ?? "").trim().toLowerCase();
    if (side.startsWith("b")) b.ask += size; else if (side.startsWith("s")) b.bid += size; else b.mid += size;
    b.trades += 1; if (tm > lastTradeMs) lastTradeMs = tm;
    topTrades.consider(e, info, b);
  } else if (t === "Trade") { if (Number.isFinite(e.dayVolume)) b.volume = Math.max(b.volume, Number(e.dayVolume)); }
  else if (t === "Summary") { if (Number.isFinite(e.openInterest)) b.oi = Math.max(b.oi, Number(e.openInterest)); }
  else if (t === "Greeks") { if (Number.isFinite(e.gamma)) b.gamma = e.gamma; if (Number.isFinite(e.delta)) b.delta = e.delta; if (Number.isFinite(e.volatility)) b.iv = e.volatility; }
  else if (t === "Quote") { if (Number.isFinite(e.bidPrice)) b.bidPrice = e.bidPrice; if (Number.isFinite(e.askPrice)) b.askPrice = e.askPrice; }
}

function writeAcc() {
  cycles += 1;
  const date = etDate();
  if (accDay && accDay !== date) {
    buckets = new Map();
    topTrades.reset();
    seen.clear();
    lastTradeMs = 0;
    log(`nuevo día ${date}: acumulador intradía reseteado`);
  }
  accDay = date;
  const obj = { ticker: "SPX", date, exp: exp || null, updatedAt: new Date().toISOString(), cycles, source: "tastytrade", buckets: Object.fromEntries(buckets), topTrades: topTrades.list, seenIds: [] };
  const file = path.join(OUT_DIR, `SPX-${date}.json`);
  try { mkdirSync(OUT_DIR, { recursive: true }); const tmp = file + ".tmp"; writeFileSync(tmp, JSON.stringify(obj)); renameSync(tmp, file); } catch (e) { log("write err:", e.message); }
  return file;
}
function report(file) {
  let buy = 0, sell = 0, vol = 0, withGreeks = 0;
  for (const b of buckets.values()) { buy += b.ask; sell += b.bid; vol += b.volume; if (b.gamma != null) withGreeks++; }
  const cvd = buy - sell; const ageS = lastTradeMs ? Math.round((Date.now() - lastTradeMs) / 1000) : "—";
  log(`CVD ${cvd >= 0 ? "+" : ""}${nf(cvd)} · vol ${nf(vol)} · strikes ${buckets.size} (${withGreeks} c/griegos) · contratos entrantes ${topTrades.list.length} · trade hace ${ageS}s`);
  log(`   → ${path.relative(WEB, file)}`);
}

// --- una conexión --------------------------------------------------------
async function connectOnce() {
  const bearer = await accessToken();
  const { token, url } = await quoteToken(bearer);
  const w = await chainWindow(bearer);
  meta = w.meta; exp = w.exp;
  log(`conectando · vto ${exp} · spot ${w.spot} · ${w.syms.length} símbolos`);

  return new Promise((resolve) => {
    const ws = new WebSocket(url); const send = (o) => ws.send(JSON.stringify(o));
    let ka, rep;
    const done = () => { clearInterval(ka); clearInterval(rep); try { ws.close(); } catch {} resolve(); };
    ws.addEventListener("open", () => send({ type: "SETUP", channel: 0, version: "0.1-agente/1.0", keepaliveTimeout: 60, acceptKeepaliveTimeout: 60 }));
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "AUTH_STATE" && m.state === "UNAUTHORIZED") return send({ type: "AUTH", channel: 0, token });
      if (m.type === "AUTH_STATE" && m.state === "AUTHORIZED") { ka = setInterval(() => send({ type: "KEEPALIVE", channel: 0 }), 25000); return send({ type: "CHANNEL_REQUEST", channel: 1, service: "FEED", parameters: { contract: "AUTO" } }); }
      if (m.type === "CHANNEL_OPENED") {
        send({ type: "FEED_SETUP", channel: 1, acceptAggregationPeriod: 0.5, acceptDataFormat: "FULL",
          acceptEventFields: {
            TimeAndSale: ["eventType", "eventSymbol", "price", "size", "aggressorSide", "spreadLeg", "exchangeSaleConditions", "time", "index"],
            Trade: ["eventType", "eventSymbol", "dayVolume", "time"],
            Summary: ["eventType", "eventSymbol", "openInterest", "time"],
            Greeks: ["eventType", "eventSymbol", "gamma", "delta", "volatility", "time"],
            Quote: ["eventType", "eventSymbol", "bidPrice", "askPrice"],
          } });
        const add = [];
        for (const s of w.syms) for (const ty of ["TimeAndSale", "Trade", "Summary", "Greeks", "Quote"]) add.push({ type: ty, symbol: s });
        send({ type: "FEED_SUBSCRIPTION", channel: 1, add });
        log(`suscrito (${add.length} feeds). acumulando…`);
        rep = setInterval(() => report(writeAcc()), 10000);
        return;
      }
      if (m.type === "FEED_DATA") for (const e of (m.data || [])) if (e && e.eventType) onEvent(e);
    });
    ws.addEventListener("close", () => { log("WS cerrado"); done(); });
    ws.addEventListener("error", (er) => { log("WS error:", er.message || er.type); done(); });
    setTimeout(() => { log("reciclando conexión (token/strikes)…"); done(); }, 12 * 60 * 1000);
  });
}

async function main() {
  if (!env.TASTYTRADE_REFRESH_TOKEN || !env.TASTYTRADE_CLIENT_SECRET) throw new Error("Faltan credenciales OAuth de Tastytrade en .env.local");
  log(`Streamer Tastytrade (0DTE Live, SPX) — escribe ${path.relative(WEB, OUT_DIR)}/ · Ctrl+C para parar`);
  loadExisting();
  for (;;) { try { await connectOnce(); } catch (e) { log("error:", e.message); } await new Promise((r) => setTimeout(r, 5000)); }
}
main().catch((e) => { console.error("STREAM FATAL:", e.message); process.exitCode = 1; });
