#!/usr/bin/env node
// Streamer de velas en vivo de tastytrade (DXLink) — respaldo de "Grandes
// empresas" cuando el chart de MarketSnack (lib/marketsnack.ts
// `fetchAssetPriceChart`) queda atrasado (visto en vivo 2026-08-20: su feed
// de "hoy" no arrancaba aunque ya fueran las 9am ET). tastytrade NO tiene
// REST de velas (solo snapshot puntual vía market-data/by-type, ver
// lib/tastytrade.ts) — el único dato con historial+tiempo real es su
// streaming DXLink (WebSocket), que este proyecto no usaba hasta ahora.
//
// Standalone a propósito (mismo patrón que scripts/marketsnack-keepalive/):
// corre con `node` puro, sin pasar por Next ni TypeScript, así puede vivir
// como proceso de fondo separado del `next dev`. A diferencia del keepalive
// (toque puntual cada 25 min), este proceso queda VIVO indefinidamente — el
// propio DXLinkWebSocketClient reconecta solo (reintentos ilimitados por
// default).
//
// Qué hace: autentica con tastytrade (mismo OAuth de lib/tastytrade.ts),
// pide un token de streaming (`GET /api-quote-tokens`), abre DXLink, y se
// suscribe a velas de 15 min (`{TICKER}{=15m}`, SIN `tho=true` — por default
// dxFeed incluye TODAS las sesiones, pre-market y after-hours incluidos, que
// es justo lo que hace falta) de las 13 empresas de Grandes Empresas. Cada
// vela que llega se acumula en memoria y se vuelca a
// data/tastytrade-candles/{TICKER}.json cada ~10s — mismo shape `TfBar[]`
// (time en SEGUNDOS) que ya espera app/api/grandes-empresas/route.ts.
//
// Uso: node scripts/tastytrade-candles/candle-streamer.mjs
//      (o "npm run candles:stream" desde web/)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { DXLinkWebSocketClient } from "@dxfeed/dxlink-websocket-client";
import { DXLinkFeed, FeedContract } from "@dxfeed/dxlink-feed";

// El cliente DXLink usa el WebSocket GLOBAL (pensado para navegador) — en
// Node hace falta polyfillearlo antes de instanciar nada.
globalThis.WebSocket = WebSocket;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(WEB_DIR, ".env.local");
const OUT_DIR = path.join(WEB_DIR, "data", "tastytrade-candles");

const TICKERS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
  "PLTR", "IREN", "NFLX", "SPCX", "INTC", "ORCL",
];

const CANDLE_PERIOD = "15m";
// Cuántos días atrás pedir de arranque — suficiente para cubrir el
// pre-market de HOY aunque el script se arranque a media mañana, sin pedir
// tanto historial que la primera carga sea lenta.
const BACKFILL_DAYS = 2;
const FLUSH_INTERVAL_MS = 10_000;
// tastytrade refresca el access_token OAuth cada ~15 min — se reconecta a
// DXLink un poco antes para no quedarse con un token vencido a mitad de
// sesión (el token de streaming en sí puede durar menos que eso).
const RECONNECT_INTERVAL_MS = 10 * 60 * 1000;

function log(line) {
  console.log(`${new Date().toISOString()} ${line}`);
}

async function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  try {
    const raw = await readFile(ENV_FILE, "utf8");
    const m = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function getAccessToken() {
  const clientSecret = await loadEnvVar("TASTYTRADE_CLIENT_SECRET");
  const refreshToken = await loadEnvVar("TASTYTRADE_REFRESH_TOKEN");
  if (!clientSecret || !refreshToken) {
    throw new Error("Faltan TASTYTRADE_CLIENT_SECRET / TASTYTRADE_REFRESH_TOKEN en .env.local.");
  }
  const res = await fetch("https://api.tastyworks.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "visionary-trades/1.0" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`No se pudo autenticar con tastytrade (HTTP ${res.status}).`);
  const body = await res.json();
  return body.access_token;
}

async function getQuoteToken(accessToken) {
  const res = await fetch("https://api.tastyworks.com/api-quote-tokens", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "visionary-trades/1.0" },
  });
  if (!res.ok) throw new Error(`No se pudo pedir el quote token (HTTP ${res.status}).`);
  const body = await res.json();
  const token = body.data?.token;
  const dxlinkUrl = body.data?.["dxlink-url"];
  if (!token || !dxlinkUrl) throw new Error("Respuesta de /api-quote-tokens sin token o dxlink-url.");
  return { token, dxlinkUrl };
}

// Acumulador en memoria: por ticker, mapa time(seg) -> vela. Un Map conserva
// orden de inserción, pero igual se ordena al volcar por si llegan velas
// fuera de orden (backfill + vivo pueden solaparse).
const candlesByTicker = new Map(TICKERS.map((t) => [t, new Map()]));
let dirty = new Set();

function upsertCandle(ticker, ev) {
  const timeMs = Number(ev.time);
  const open = Number(ev.open);
  const high = Number(ev.high);
  const low = Number(ev.low);
  const close = Number(ev.close);
  if (![timeMs, open, high, low, close].every(Number.isFinite)) return;
  const bar = { time: Math.floor(timeMs / 1000), open, high, low, close };
  candlesByTicker.get(ticker)?.set(bar.time, bar);
  dirty.add(ticker);
}

async function flush() {
  if (dirty.size === 0) return;
  const toFlush = [...dirty];
  dirty = new Set();
  await mkdir(OUT_DIR, { recursive: true });
  for (const ticker of toFlush) {
    const bars = [...(candlesByTicker.get(ticker)?.values() ?? [])].sort((a, b) => a.time - b.time);
    await writeFile(path.join(OUT_DIR, `${ticker}.json`), JSON.stringify(bars), "utf8").catch((err) => {
      log(`ERROR escribiendo ${ticker}.json: ${err.message}`);
    });
  }
  log(`Volcado: ${toFlush.join(", ")}`);
}

function candleSymbol(ticker) {
  return `${ticker}{=${CANDLE_PERIOD}}`; // sin tho=true → incluye pre-market/after-hours (default de dxFeed)
}

async function connectOnce() {
  const accessToken = await getAccessToken();
  const { token, dxlinkUrl } = await getQuoteToken(accessToken);
  log(`Conectando a ${dxlinkUrl}…`);

  const client = new DXLinkWebSocketClient();
  let feed = null;

  client.addConnectionStateChangeListener((state) => log(`Conexión: ${state}`));
  client.addErrorListener((err) => log(`ERROR DXLink: ${err.type} — ${err.message}`));
  client.addAuthStateChangeListener((state) => {
    log(`Auth: ${state}`);
    if (state === "AUTHORIZED" && !feed) {
      feed = new DXLinkFeed(client, FeedContract.HISTORY);
      feed.configure({ acceptEventFields: { Candle: ["eventSymbol", "time", "open", "high", "low", "close", "volume"] } });
      feed.addEventListener((events) => {
        for (const ev of events) {
          const sym = String(ev.eventSymbol ?? "");
          const ticker = sym.split("{")[0];
          if (candlesByTicker.has(ticker)) upsertCandle(ticker, ev);
        }
      });
      const fromTime = Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
      const subs = TICKERS.map((t) => ({ type: "Candle", symbol: candleSymbol(t), fromTime }));
      feed.addSubscriptions(subs);
      log(`Suscripto a ${TICKERS.length} tickers (velas de ${CANDLE_PERIOD}, backfill ${BACKFILL_DAYS}d).`);
    }
  });

  client.connect(dxlinkUrl);
  client.setAuthToken(token);

  return client;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const flushTimer = setInterval(() => { flush().catch((err) => log(`ERROR flush: ${err.message}`)); }, FLUSH_INTERVAL_MS);

  let client = await connectOnce().catch((err) => {
    log(`ERROR conectando: ${err.message}`);
    return null;
  });

  // Reconexión periódica completa (token nuevo) — no solo confiar en el
  // reconnect automático del cliente DXLink, que reusa el mismo token viejo.
  setInterval(async () => {
    log("Reconectando con token fresco…");
    client?.close();
    client = await connectOnce().catch((err) => {
      log(`ERROR reconectando: ${err.message}`);
      return null;
    });
  }, RECONNECT_INTERVAL_MS);

  process.on("SIGINT", async () => {
    log("Cerrando…");
    clearInterval(flushTimer);
    await flush();
    client?.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log(`ERROR FATAL: ${err.message}`);
  process.exit(1);
});
