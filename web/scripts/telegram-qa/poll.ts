// Puente Telegram → señal en vivo de "Contratos vecinos 3.0" — pedido
// explícito de Carlos (2026-08-27): "yo te envío el ticket [ticker] y tu me
// mandas call o put o no hacer nada". Corre cada 1 minuto (tarea de Windows,
// ver Instalar-TelegramQA.ps1): revisa mensajes nuevos del bot, TRATA EL
// TEXTO COMO UN TICKER (sin NLP — Carlos manda el símbolo directo, ej.
// "PLTR"), calcula la señal REAL en vivo con el MISMO motor que "Contratos
// vecinos 3.0"/"Grandes empresas" (lib/liveTickerActivity.ts +
// lib/contratosVecinos3.ts, sin duplicar lógica) y contesta por Telegram.
//
// **Reemplaza la versión anterior (2026-08-25) que invocaba `claude -p` para
// responder** — esa versión quedó BLOQUEADA porque el CLI de Claude no
// estaba autenticado (`claude /login` pendiente, acción manual que Carlos
// nunca llegó a hacer) y además solo podía LEER archivos viejos (Read/Glob/
// Grep), no calcular una señal en vivo. Esta versión no depende de `claude`
// para nada — es 100% determinística (mismas funciones puras/IO que ya usan
// las rutas en producción), así que no tiene ningún bloqueo de login.
//
// **Ojo — esto es una LECTURA PUNTUAL, no la señal "confirmada" de la alerta
// en vivo** (`scripts/cv3-live-alert/`, que exige 3 lecturas seguidas
// sosteniendo la misma dirección antes de avisar). Una pregunta puntual por
// Telegram no tiene ese historial — se avisa explícito en la respuesta.

import { readFileSync } from "node:fs";
import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "..");
const ENV_FILE = path.join(WEB_DIR, ".env.local");
const STATE_FILE = path.join(WEB_DIR, "data", "telegram-qa-state.json");
const LOG_FILE = path.join(WEB_DIR, "data", "telegram-qa.log");

// Lectura SÍNCRONA (no top-level await) — tsx transforma este script a CJS,
// que no soporta top-level await (mismo criterio que el resto de scripts/*
// del proyecto, todos con este mismo bloque via readFileSync).
for (const rawLine of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

async function log(line: string) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  await mkdir(path.join(WEB_DIR, "data"), { recursive: true }).catch(() => {});
  await appendFile(LOG_FILE, stamped, "utf8").catch(() => {});
}

interface QaState { lastUpdateId: number; }

async function loadState(): Promise<QaState> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { lastUpdateId: 0 };
  }
}

async function saveState(state: QaState) {
  await mkdir(path.join(WEB_DIR, "data"), { recursive: true }).catch(() => {});
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function sendTelegram(token: string, chatId: string | number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ chat_id: String(chatId), text }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram sendMessage falló: ${JSON.stringify(json)}`);
}

async function getUpdates(token: string, offset: number): Promise<any[]> {
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`;
  const res = await fetch(url);
  const json: any = await res.json();
  if (!json.ok) throw new Error(`getUpdates falló: ${JSON.stringify(json)}`);
  return json.result ?? [];
}

const money0 = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Ticker válido: 1-5 letras (permite un punto tipo BRK.B). Nada de frases. */
const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

async function answerTicker(rawText: string): Promise<string> {
  const ticker = rawText.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return `No reconocí "${rawText.trim()}" como ticker. Mandame solo el símbolo (ej: PLTR, SPX, TSLA).`;
  }

  const { contratosVecinos3Signal, orderBookSentiment } = await import("../../lib/contratosVecinos3");
  const { fetchLiveActivityLevels, fetchGexContext, formatGexNote, INDEX_TICKERS } = await import("../../lib/liveTickerActivity");
  const { isMarketOpen } = await import("../../lib/marketHours");

  const now = new Date();
  const marketOpen = isMarketOpen(now);

  let result;
  try {
    result = await fetchLiveActivityLevels(ticker, now);
  } catch (err: any) {
    await log(`ERROR calculando ${ticker}: ${err?.stack ?? err}`);
    return `⚠️ Tuve un error real buscando datos de ${ticker} (${err?.message ?? "error desconocido"}). Probá de nuevo en un rato.`;
  }
  if (!result) {
    const universo = INDEX_TICKERS.has(ticker) ? "" : " (¿tiene opciones semanales reales con volumen? no toda acción entra en el universo de Grandes Empresas)";
    return `No encontré datos en vivo de ${ticker} ahora mismo${universo}.`;
  }

  const { spot, above, below } = result;
  const signal = contratosVecinos3Signal({ spot, above, below });
  const orderBook = orderBookSentiment({ spot, above, below });

  const lines: string[] = [];
  if (!marketOpen) lines.push("⚠️ Mercado cerrado — este es el último dato real disponible, no en vivo.");

  if (!signal.type || !signal.target1) {
    lines.push(`🟡 ${ticker} — NO OPERAR AHORA`);
    lines.push(`Spot: $${spot.toFixed(2)}`);
    lines.push("", signal.reason);
  } else {
    const dirWord = signal.type === "call" ? "CALL 🟢" : "PUT 🔴";
    lines.push(`${signal.type === "call" ? "🟢" : "🔴"} ${ticker} — ${dirWord}`);
    lines.push(`Spot: $${spot.toFixed(2)}`);
    lines.push(`Target 1: $${signal.target1.strike} (${money0(signal.target1.totalPremium)} Premium Traded${signal.target1.unusual ? " · actividad inusual" : ""})`);
    if (signal.target2) lines.push(`Target 2: $${signal.target2.strike} (${money0(signal.target2.totalPremium)})`);
    if (signal.wallStrike) lines.push(`Pared real (freno): $${signal.wallStrike}`);
    if (signal.stopLoss) lines.push(`Stop-loss de referencia: $${signal.stopLoss.strike}`);
    if (signal.supportingWall) lines.push(`Refuerzo (${signal.supportingWall.label}): $${signal.supportingWall.strike}`);
    if (signal.capCandidate) {
      lines.push(signal.capCandidate.confirmed
        ? `⚠️ Candidato CONFIRMADO a punto máximo: $${signal.capCandidate.strike}`
        : `Candidato a punto máximo (sin confirmar del todo): $${signal.capCandidate.strike}`);
    }
    lines.push(`Order book: ${orderBook.message}`);
    const gex = await fetchGexContext(ticker).catch(() => null);
    if (gex) lines.push(formatGexNote(gex, signal.type, spot, signal.target1.strike));
    lines.push("", signal.reason);
  }

  lines.push("", "(lectura puntual de este momento — no confirmada con varias lecturas seguidas, distinto de la alerta automática que sí exige eso).");
  return lines.join("\n");
}

/**
 * `<TICKER> OI` — pedido explícito de Carlos (2026-08-27): "buscame un
 * contrato en call o puts que el volumen sea 3x el OI en la cadena de
 * opciones". Escanea la cadena COMPLETA (todos los strikes/vencimientos) de
 * Massive (`fetchOptionChain` + `findVolumeOiCandidates`) — Carlos pidió la
 * cadena de Robinhood, pero el MCP de Robinhood solo funciona dentro de una
 * sesión de Claude activa, no en este script standalone (mismo límite real
 * ya documentado para Schwab/Robinhood); Massive da el mismo dato real
 * (volumen + Open Interest por contrato) sin esa limitación — se avisa en la
 * respuesta, nunca se finge que es Robinhood.
 */
async function answerVolumeOi(ticker: string): Promise<string> {
  const { fetchOptionChain } = await import("../../lib/massive");
  const { findVolumeOiCandidates, findTopVolumeContract, VOLUME_OI_RATIO_THRESHOLD } = await import("../../lib/volumeOiScan");
  const { selectWeeklyExpirations } = await import("../../lib/grandesEmpresas");

  let chain;
  try {
    chain = await fetchOptionChain(ticker);
  } catch (err: any) {
    await log(`ERROR trayendo cadena de ${ticker}: ${err?.stack ?? err}`);
    return `⚠️ Tuve un error real trayendo la cadena de ${ticker} (${err?.message ?? "error desconocido"}). Probá de nuevo en un rato.`;
  }
  if (chain.contracts.length === 0) {
    return `No encontré cadena de opciones de ${ticker} en Massive ahora mismo.`;
  }

  const candidates = findVolumeOiCandidates(chain.contracts);
  const lines: string[] = [
    `${ticker} — contratos con volumen ≥ ${VOLUME_OI_RATIO_THRESHOLD}x el Open Interest (cadena completa, vía Massive — no Robinhood, ver nota abajo):`,
  ];
  if (candidates.length === 0) {
    lines.push("Ninguno ahora mismo.");
  } else {
    for (const c of candidates.slice(0, 5)) {
      lines.push(`${c.type.toUpperCase()} $${c.strike} venc. ${c.expiration} — volumen ${c.volume.toLocaleString("en-US")} / OI ${c.openInterest.toLocaleString("en-US")} (${c.ratio.toFixed(1)}x)`);
    }
    if (candidates.length > 5) lines.push(`… y ${candidates.length - 5} más.`);
  }

  // Además del ratio, pedido explícito de Carlos (mismo día): "dime que
  // contrato es el que tiene mas volumen" — acotado al vencimiento OBJETIVO
  // real de hoy (regla semanal corregida, lib/grandesEmpresas.ts), sin
  // exigir ningún ratio contra el OI.
  const now = new Date();
  const allExpirations = [...new Set(chain.contracts.map((c) => c.details?.expiration_date).filter((e): e is string => e != null))];
  const targetExpirations = new Set(selectWeeklyExpirations(allExpirations, now));
  const topVolume = findTopVolumeContract(chain.contracts, targetExpirations);
  lines.push("");
  if (topVolume) {
    lines.push(`Mayor volumen del vencimiento objetivo de hoy (${[...targetExpirations].join(", ")}): ${topVolume.type.toUpperCase()} $${topVolume.strike} — volumen ${topVolume.volume.toLocaleString("en-US")} (OI ${topVolume.openInterest.toLocaleString("en-US")}).`);
  } else {
    lines.push(`Sin volumen real todavía en el vencimiento objetivo de hoy (${[...targetExpirations].join(", ") || "ninguno disponible"}).`);
  }

  lines.push("", "(dato real de Massive, no de Robinhood — el MCP de Robinhood solo funciona dentro de una sesión de Claude activa, no en este bot automático).");
  return lines.join("\n");
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const expectedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !expectedChatId) {
    await log("SIN TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID en .env.local — no se puede correr.");
    return;
  }

  const state = await loadState();
  const updates = await getUpdates(token, state.lastUpdateId + 1);
  if (updates.length === 0) return;

  let maxId = state.lastUpdateId;
  for (const u of updates) {
    if (u.update_id > maxId) maxId = u.update_id;
    const msg = u.message;
    const text = msg?.text;
    const chatId = msg?.chat?.id;
    if (!text || chatId == null) continue;
    // Solo respondemos al chat de Carlos — mismo criterio de seguridad de
    // siempre (nadie más puede gastar invocaciones ni ver datos).
    if (String(chatId) !== String(expectedChatId)) {
      await log(`Ignorado: mensaje de chat_id=${chatId} (no es el esperado).`);
      continue;
    }
    if (text.startsWith("/")) {
      await log(`Ignorado comando: ${text}`);
      continue;
    }

    await log(`Pregunta recibida: ${text}`);
    try {
      // "<TICKER> OI" (ej. "HOOD OI") -> escaneo de volumen/OI en la cadena
      // completa; solo el ticker -> señal call/put/no operar (default).
      const oiMatch = text.trim().match(/^([A-Za-z.]{1,6})\s+OI$/i);
      const answer = oiMatch ? await answerVolumeOi(oiMatch[1].toUpperCase()) : await answerTicker(text);
      await sendTelegram(token, chatId, answer);
      await log(`Respondido (${answer.length} chars).`);
    } catch (err: any) {
      await log(`ERROR respondiendo: ${err?.message || err}`);
      await sendTelegram(token, chatId, "⚠️ Tuve un error interno respondiendo esa pregunta. Probá de nuevo en un rato.").catch(() => {});
    }
  }

  await saveState({ lastUpdateId: maxId });
}

main().catch(async (err) => {
  await log(`ERROR FATAL: ${err?.stack || err}`);
  process.exitCode = 1;
});
