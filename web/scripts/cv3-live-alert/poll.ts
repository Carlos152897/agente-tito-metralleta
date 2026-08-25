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

const INDEX_TICKERS = new Set(["SPX", "SPY", "QQQ"]);

async function main() {
  const { isMarketOpen } = await import("../../lib/marketHours");
  const now = new Date();
  if (!isMarketOpen(now)) {
    log("Mercado cerrado — no se consulta.");
    return;
  }

  const { contratosVecinos3Signal, orderBookSentiment, applyPersistence, NEIGHBOR_COUNT } = await import("../../lib/contratosVecinos3");
  type ActivityLevel = import("../../lib/contratosVecinos3").ActivityLevel;
  type ContratosVecinos3Signal = import("../../lib/contratosVecinos3").ContratosVecinos3Signal;

  let spot = 0;
  let aboveLevels: ActivityLevel[] = [];
  let belowLevels: ActivityLevel[] = [];

  if (INDEX_TICKERS.has(TICKER)) {
    // SPX/SPY/QQQ — 0DTE vía tastytrade, misma lógica que
    // app/api/contratos-vecinos-3/route.ts.
    const { fetchZeroDteChain } = await import("../../lib/tastytradeChain");
    const { fetchAssetPrice, fetchContractActivitySummaries } = await import("../../lib/marketsnack");
    const { etDate } = await import("../../lib/zerodte");

    const day = etDate(now);
    const { rows, underlyingPrice } = await fetchZeroDteChain(TICKER, day);
    if (rows.length === 0) {
      log(`Sin cadena 0DTE de ${TICKER} disponible ahora mismo.`);
      return;
    }
    const msPrice = await fetchAssetPrice(TICKER).catch(() => null);
    spot = msPrice ?? underlyingPrice ?? 0;
    if (!(spot > 0)) {
      log(`Sin precio en vivo de ${TICKER} ahora mismo.`);
      return;
    }

    const strikes = [...new Set(rows.map((r) => r.strike))];
    const above = strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, NEIGHBOR_COUNT);
    const below = strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, NEIGHBOR_COUNT);

    const bySymbolKey = new Map<string, string>();
    for (const r of rows) bySymbolKey.set(`${r.strike}|${r.contractType}`, r.optionTicker);
    const callSymbol = (s: number) => bySymbolKey.get(`${s}|call`) ?? null;
    const putSymbol = (s: number) => bySymbolKey.get(`${s}|put`) ?? null;
    const occSymbols = [
      ...above.flatMap((s) => [callSymbol(s), putSymbol(s)]).filter((s): s is string => s != null),
      ...below.flatMap((s) => [putSymbol(s), callSymbol(s)]).filter((s): s is string => s != null),
    ];
    const activityBySymbol = await fetchContractActivitySummaries(occSymbols);

    aboveLevels = above
      .map((strike): ActivityLevel | null => {
        const symbol = callSymbol(strike);
        const activity = symbol ? activityBySymbol.get(symbol) : undefined;
        if (!activity) return null;
        const otherSymbol = putSymbol(strike);
        const otherActivity = otherSymbol ? (activityBySymbol.get(otherSymbol) ?? null) : null;
        return { strike, type: "call", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);
    belowLevels = below
      .map((strike): ActivityLevel | null => {
        const symbol = putSymbol(strike);
        const activity = symbol ? activityBySymbol.get(symbol) : undefined;
        if (!activity) return null;
        const otherSymbol = callSymbol(strike);
        const otherActivity = otherSymbol ? (activityBySymbol.get(otherSymbol) ?? null) : null;
        return { strike, type: "put", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);
  } else {
    // Equities (TSLA y el resto de "Grandes empresas") — vencimientos
    // semanales reales vía Massive, misma lógica que
    // app/api/grandes-empresas/route.ts (sin el resto de esa ruta: acá solo
    // hace falta la señal de Contratos 3.0, no imán/pre-market/spreads).
    const { fetchNearTermChain } = await import("../../lib/massive");
    const { fetchAssetPrice, fetchContractActivitySummariesGrouped } = await import("../../lib/marketsnack");
    const { selectWeeklyExpirations, NEAR_TERM_DTE_MAX } = await import("../../lib/grandesEmpresas");

    const chain = await fetchNearTermChain(TICKER, { dteMax: NEAR_TERM_DTE_MAX, now });
    const msPrice = await fetchAssetPrice(TICKER).catch(() => null);
    spot = msPrice ?? chain.spot ?? 0;
    if (!(spot > 0)) {
      log(`Sin precio en vivo de ${TICKER} ahora mismo.`);
      return;
    }

    const allExpirations = [...new Set(chain.contracts.map((c) => c.expiration))];
    const nearExpirations = selectWeeklyExpirations(allExpirations, now);
    if (nearExpirations.length === 0) {
      log(`Sin vencimientos de ${TICKER} disponibles ahora mismo.`);
      return;
    }
    const nearExpirationSet = new Set(nearExpirations);
    const nearRows = chain.contracts.filter((c) => nearExpirationSet.has(c.expiration));
    const strikeSet = new Set<number>();
    const symbolsByStrikeType = new Map<string, string[]>();
    for (const c of nearRows) {
      strikeSet.add(c.strike);
      const cleanSymbol = c.optionTicker.startsWith("O:") ? c.optionTicker.slice(2) : c.optionTicker;
      const key = `${c.strike}|${c.contractType}`;
      const arr = symbolsByStrikeType.get(key);
      if (arr) arr.push(cleanSymbol); else symbolsByStrikeType.set(key, [cleanSymbol]);
    }
    const strikes = [...strikeSet];
    const above = strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, NEIGHBOR_COUNT);
    const below = strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, NEIGHBOR_COUNT);
    const callSymbols = (s: number) => symbolsByStrikeType.get(`${s}|call`) ?? [];
    const putSymbols = (s: number) => symbolsByStrikeType.get(`${s}|put`) ?? [];
    const activityGroups = new Map<string, string[]>();
    for (const s of [...above, ...below]) {
      const cs = callSymbols(s);
      const ps = putSymbols(s);
      if (cs.length > 0) activityGroups.set(`${s}|call`, cs);
      if (ps.length > 0) activityGroups.set(`${s}|put`, ps);
    }
    const activityByKey = await fetchContractActivitySummariesGrouped(activityGroups);

    aboveLevels = above
      .map((strike): ActivityLevel | null => {
        const activity = activityByKey.get(`${strike}|call`);
        if (!activity) return null;
        const otherActivity = activityByKey.get(`${strike}|put`) ?? null;
        return { strike, type: "call", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);
    belowLevels = below
      .map((strike): ActivityLevel | null => {
        const activity = activityByKey.get(`${strike}|put`);
        if (!activity) return null;
        const otherActivity = activityByKey.get(`${strike}|call`) ?? null;
        return { strike, type: "put", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);
  }

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
