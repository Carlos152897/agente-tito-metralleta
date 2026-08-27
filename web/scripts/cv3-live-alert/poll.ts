// Alerta en vivo de "Contratos vecinos 3.0" por Telegram — pedido explícito
// de Carlos (2026-08-25, sobre una captura real de la pestaña): "cada que me
// des una [alerta], mandamela por telegram y si cambia tambien mandamelo,
// actualizalo siempre". Corre cada minuto durante el horario de mercado
// (tarea de Windows, ver Instalar-AlertaCV3Live.ps1), replicando EXACTO lo
// que hace app/api/contratos-vecinos-3/route.ts (mismo motor, misma fuente
// de datos) — no un motor aparte. Solo manda un mensaje nuevo cuando la
// señal CONFIRMADA (después de `applyPersistence`) cambia de verdad; no
// spamea en cada poll si no cambió nada.
//
// Estado persistente entre corridas en data/cv3-live-state.json (historial
// de lecturas crudas para `applyPersistence` + la última señal ya avisada).

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "fs";
import { join } from "path";

const WEB_DIR = process.cwd();
const envPath = join(WEB_DIR, ".env.local");
for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[key] = val;
}

const TICKER = process.argv[2]?.toUpperCase() ?? "SPX";
const STATE_FILE = join(WEB_DIR, "data", `cv3-live-state-${TICKER}.json`);
const LOG_FILE = join(WEB_DIR, "data", "cv3-live-alert.log");
const HISTORY_KEEP = 8; // más que PERSISTENCE_REQUIRED (3), colchón de sobra

function log(line: string) {
  const stamped = `${new Date().toISOString()} [${TICKER}] ${line}\n`;
  process.stdout.write(stamped);
  try {
    mkdirSync(join(WEB_DIR, "data"), { recursive: true });
    appendFileSync(LOG_FILE, stamped, "utf8");
  } catch {
    // no crítico
  }
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log("SIN TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID en .env.local — no se avisa.");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ chat_id: chatId, text }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!json.ok) log(`Telegram sendMessage falló: ${JSON.stringify(json)}`);
}

interface State {
  history: any[]; // ContratosVecinos3Signal[] crudas, más recientes al final
  lastSentKey: string | null;
}

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { history: [], lastSentKey: null };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { history: [], lastSentKey: null };
  }
}

function saveState(s: State) {
  mkdirSync(join(WEB_DIR, "data"), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

async function main() {
  const { isMarketOpen } = await import("../../lib/marketHours");
  const now = new Date();
  if (!isMarketOpen(now)) {
    log("Mercado cerrado — no se consulta.");
    return;
  }

  const { contratosVecinos3Signal, orderBookSentiment, applyPersistence } = await import("../../lib/contratosVecinos3");
  type ContratosVecinos3Signal = import("../../lib/contratosVecinos3").ContratosVecinos3Signal;
  const { fetchLiveActivityLevels, fetchGexContext } = await import("../../lib/liveTickerActivity");

  // Resolución del vecindario (spot + niveles) extraída a
  // lib/liveTickerActivity.ts — reusada también por scripts/telegram-qa/poll.ts.
  const result = await fetchLiveActivityLevels(TICKER, now);
  if (!result) {
    log(`Sin datos en vivo de ${TICKER} ahora mismo (cadena o precio no disponible).`);
    return;
  }
  const { spot, above: aboveLevels, below: belowLevels } = result;
  // GEX real (pedido explícito de Carlos, 2026-08-27: "quiero entradas más
  // grandes... puedes usar el GEX de MarketSnack") — solo informativo, no
  // cambia la señal todavía.
  const gex = await fetchGexContext(TICKER).catch(() => null);

  const signal = contratosVecinos3Signal({ spot, above: aboveLevels, below: belowLevels });
  const orderBook = orderBookSentiment({ spot, above: aboveLevels, below: belowLevels });

  const state = loadState();
  const history: ContratosVecinos3Signal[] = [...state.history, signal].slice(-HISTORY_KEEP);
  const persistent = applyPersistence(history);

  const key = persistent.confirmed && persistent.type != null && persistent.target1 != null
    ? JSON.stringify({
        type: persistent.type,
        t1: persistent.target1.strike,
        t2: persistent.target2?.strike ?? null,
        wall: persistent.wallStrike,
        stop: persistent.stopLoss?.strike ?? null,
        cap: persistent.capCandidate?.confirmed ?? false,
        capStrike: persistent.capCandidate?.strike ?? null,
        support: persistent.supportingWall?.strike ?? null,
      })
    : null;

  log(`spot=${spot.toFixed(2)} confirmed=${persistent.confirmed} type=${persistent.type} target1=${persistent.target1?.strike ?? "-"} key=${key ?? "null"}`);

  if (key !== state.lastSentKey) {
    if (key == null && state.lastSentKey != null) {
      await sendTelegram(`ℹ️ ${TICKER} — la señal confirmada anterior ya no se sostiene (sin dirección clara ahora mismo). Spot: $${spot.toFixed(2)}.`);
    } else if (key != null) {
      const dirWord = persistent.type === "call" ? "CALL 🟢" : "PUT 🔴";
      const lines = [
        `${persistent.type === "call" ? "🟢" : "🔴"} ${TICKER} — ${dirWord} confirmado`,
        `Spot: $${spot.toFixed(2)}`,
        `Target 1: $${persistent.target1!.strike} (Premium Traded $${persistent.target1!.totalPremium.toLocaleString("en-US")}${persistent.target1!.unusual ? " · actividad inusual" : ""})`,
      ];
      if (persistent.target2) lines.push(`Target 2: $${persistent.target2.strike} (Premium Traded $${persistent.target2.totalPremium.toLocaleString("en-US")})`);
      if (persistent.wallStrike) lines.push(`Pared real (freno): $${persistent.wallStrike}`);
      if (persistent.stopLoss) lines.push(`Stop-loss de referencia: $${persistent.stopLoss.strike}`);
      if (persistent.supportingWall) lines.push(`Refuerzo (${persistent.supportingWall.label}): $${persistent.supportingWall.strike}`);
      if (persistent.capCandidate) {
        lines.push(persistent.capCandidate.confirmed
          ? `⚠️ Candidato CONFIRMADO a punto máximo: $${persistent.capCandidate.strike}`
          : `Candidato a punto máximo (sin confirmar del todo): $${persistent.capCandidate.strike}`);
      }
      lines.push(`Order book: ${orderBook.message}`);
      if (gex) {
        const { formatGexNote } = await import("../../lib/liveTickerActivity");
        lines.push(formatGexNote(gex, persistent.type!, spot, persistent.target1!.strike));
      }
      lines.push("", persistent.reason);
      await sendTelegram(lines.join("\n"));
    }
    saveState({ history, lastSentKey: key });
  } else {
    saveState({ history, lastSentKey: state.lastSentKey });
  }
}

main().catch((err) => {
  const msg = `ERROR: ${err?.stack ?? err}`;
  process.stderr.write(msg + "\n");
  try { appendFileSync(LOG_FILE, `${new Date().toISOString()} [${TICKER}] ${msg}\n`, "utf8"); } catch {}
  process.exit(1);
});
