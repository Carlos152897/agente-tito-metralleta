// GET /api/backtest?days=20&riskPct=20&takeProfitPct=60&stopLossPct=50
//
// "Prueba de Fuego" — backtest de day-trading de opciones ATM de TSLA por SSE.
//
// Por cada día hábil pasado: reconstruye una cadena aproximada del día con los
// trades reales de MarketSnack de ESE día (dateGte/dateLte), corre el MISMO
// `gexAnalysis` que usa el dashboard en vivo para decidir CALL/PUT (nodo imán
// arriba/abajo del spot), elige el contrato ATM de vencimiento más próximo, y
// simula comprar al open y salir por take-profit/stop-loss/cierre contra el
// rango real (open/high/low/close) de ESE contrato ESE día.
//
// Dinero 100% simulado — esta ruta nunca coloca una orden ni toca ninguna cuenta.
// Ver la nota de reconstrucción de cadena en lib/backtest.ts (limitación declarada).

import { gexAnalysis, type TradeLite } from "@/lib/gex";
import { parseOcc } from "@/lib/occ";
import { fetchDailyBars, fetchOptionContractsList, fetchOptionDayBar, MassiveError } from "@/lib/massive";
import { fetchFlow, MarketSnackError } from "@/lib/marketsnack";
import {
  nearestStrikes, pickAtmContract, reconstructRowsFromTrades, resolveDirection, runBacktestDay,
  sentimentDirection, summarizeBacktest, isTrade,
  type BacktestTrade, type BacktestSkip, type ContractCandidate, type FlowExitConfig,
  type NeighborZoneTrade, type RawDayTrade, type TrailingStopConfig,
} from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER = "TSLA";
const STARTING_BALANCE = 1000;
const MIN_DTE = 0;
const MAX_DTE = 7;
const IV_WINDOW = 22; // barras previas para estimateIV, igual que el dashboard en vivo

interface BacktestSseEvent {
  type: "step" | "done" | "error";
  label?: string;
  message?: string;
  trades?: BacktestTrade[];
  skipped?: BacktestSkip[];
  equityCurve?: { date: string; balance: number }[];
  summary?: ReturnType<typeof summarizeBacktest>;
  meta?: {
    ticker: string; days: number; riskPct: number; takeProfitPct: number; stopLossPct: number;
    maxStrikeDistance: number; takeProfitUsd: number | null; requireSentimentConfirm: boolean;
    useFlowExit: boolean; volumeMultiple: number; emergencyStopPct: number; allowMinimumOne: boolean;
    useTrailingStop: boolean; armPct: number; trailPct: number; hardStopPct: number;
  };
}

function sse(event: BacktestSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function clampInt(v: string | null, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = clampInt(searchParams.get("days"), 20, 5, 40);
  const riskPct = clampInt(searchParams.get("riskPct"), 20, 5, 50);
  const takeProfitPct = clampInt(searchParams.get("takeProfitPct"), 60, 10, 300);
  const stopLossPct = clampInt(searchParams.get("stopLossPct"), 50, 10, 90);
  const maxStrikeDistance = clampInt(searchParams.get("maxStrikeDistance"), 5, 1, 50);
  const takeProfitUsdRaw = Number(searchParams.get("takeProfitUsd"));
  const takeProfitUsd = Number.isFinite(takeProfitUsdRaw) && takeProfitUsdRaw > 0
    ? Math.min(2000, takeProfitUsdRaw) : null;
  const requireSentimentConfirm = searchParams.get("requireSentimentConfirm") === "1";
  const useFlowExit = searchParams.get("useFlowExit") === "1";
  const volumeMultiple = clampInt(searchParams.get("volumeMultiple"), 4, 2, 20);
  const emergencyStopPct = clampInt(searchParams.get("emergencyStopPct"), 70, 20, 95);
  const allowMinimumOne = searchParams.get("allowMinimumOne") === "1";
  const useTrailingStop = searchParams.get("useTrailingStop") === "1";
  const armPct = clampInt(searchParams.get("armPct"), 20, 5, 100);
  const trailPct = clampInt(searchParams.get("trailPct"), 25, 5, 90);
  const hardStopPct = clampInt(searchParams.get("hardStopPct"), 70, 20, 95);
  // Necesitamos el precio propio del contrato a lo largo del día para el trailing
  // Y para leer el disparo de reversión — se calcula si cualquiera de los dos está activo.
  const needsHeldTrades = useFlowExit || useTrailingStop;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: BacktestSseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        send({ type: "step", label: `Descargando historial de precio de ${TICKER}…` });
        // Ventana amplia: `days` a simular + colchón para el proxy de IV del primer día.
        const bars = await fetchDailyBars(TICKER, days + IV_WINDOW + 15);
        if (bars.length < IV_WINDOW + 2) {
          send({ type: "error", message: "No hay suficiente historial de precio de TSLA para simular." });
          controller.close();
          return;
        }
        const window = bars.slice(-days); // los últimos `days` días hábiles ya cerrados

        const firstDay = window[0].time;
        const lastDay = window[window.length - 1].time;
        // Colchón de +10 días sobre el último día simulado: para que el último tramo
        // del backtest todavía tenga vencimientos semanales disponibles en la ventana.
        const contractsWindowEnd = new Date(Date.parse(`${lastDay}T00:00:00Z`) + (MAX_DTE + 10) * 86_400_000)
          .toISOString().slice(0, 10);

        send({ type: "step", label: "Listando contratos de TSLA del período (calls y puts)…" });
        const [callContracts, putContracts] = await Promise.all([
          fetchOptionContractsList(TICKER, { contractType: "call", expirationGte: firstDay, expirationLte: contractsWindowEnd }),
          fetchOptionContractsList(TICKER, { contractType: "put", expirationGte: firstDay, expirationLte: contractsWindowEnd }),
        ]);
        send({
          type: "step",
          label: `${callContracts.length} calls y ${putContracts.length} puts de referencia en el período.`,
        });

        const trades: BacktestTrade[] = [];
        const skipped: BacktestSkip[] = [];
        const equityCurve: { date: string; balance: number }[] = [];
        let balance = STARTING_BALANCE;

        for (let i = 0; i < window.length; i++) {
          const day = window[i];
          send({ type: "step", label: `Día ${i + 1}/${window.length} — ${day.time}: leyendo flujo real…` });

          // Closes SOLO de días previos a `day` — sin mirar al futuro.
          const priorCloses = bars
            .filter((b) => b.time < day.time)
            .slice(-IV_WINDOW)
            .map((b) => b.close);

          let dayTrades: RawDayTrade[] = [];
          let sentimentInputs: { premium: number; sentiment: string }[] = [];
          let rawTrades: { symbol: string; price: number; size: number; open_interest: number; timestamp: string; side: string }[] = [];
          try {
            const { trades: raw } = await fetchFlow(TICKER, {
              dateGte: day.time, dateLte: day.time, maxPages: 8, period: "1d",
            });
            rawTrades = raw.map((t) => ({
              symbol: t.symbol, price: t.price, size: t.size,
              open_interest: t.open_interest, timestamp: t.timestamp, side: t.side,
            }));
            dayTrades = rawTrades.filter((t) => t.open_interest >= 0 && t.price > 0);
            sentimentInputs = raw.map((t) => ({ premium: t.premium, sentiment: t.sentiment }));
          } catch {
            // Sin flujo ese día (feriado corto, o MarketSnack sin cobertura) → se trata como sin señal.
          }

          const rows = reconstructRowsFromTrades(dayTrades);

          const tradeLites: TradeLite[] = [];
          for (const t of dayTrades) {
            const info = parseOcc(t.symbol);
            if (!info) continue;
            tradeLites.push({ strike: info.strike, type: info.type, premium: t.price * t.size * 100, gamma: 0 });
          }

          const nowAt = new Date(`${day.time}T15:00:00Z`);
          const analysis = rows.length > 0
            ? gexAnalysis({ rows, closes: priorCloses, spot: day.open, trades: tradeLites, now: nowAt })
            : null;

          const gexDirection = analysis?.direction === "up" ? "call" : analysis?.direction === "down" ? "put" : "flat";
          const sentiment = sentimentDirection(sentimentInputs);
          const resolved = resolveDirection(gexDirection, sentiment, requireSentimentConfirm);

          if (resolved === "contradice") {
            skipped.push({ date: day.time, reason: "sentimiento_contradice", direction: gexDirection === "flat" ? null : gexDirection });
            send({ type: "step", label: `${day.time}: sin operación (GEX decía ${gexDirection.toUpperCase()}, sentimiento de MarketSnack lo contradice)` });
            equityCurve.push({ date: day.time, balance });
            continue;
          }
          const direction = resolved;

          let contract: ContractCandidate | null = null;
          let contractTicker: string | null = null;
          if (direction !== "flat") {
            const pool = direction === "call" ? callContracts : putContracts;
            const candidates: (ContractCandidate & { ticker: string })[] = pool
              .filter((c) => c.expiration >= day.time)
              .map((c) => ({
                ticker: c.ticker, strike: c.strike, expiration: c.expiration,
                dte: Math.round((Date.parse(`${c.expiration}T00:00:00Z`) - Date.parse(`${day.time}T00:00:00Z`)) / 86_400_000),
              }));
            // Con salida por flujo o trailing stop, se evita 0DTE a propósito: un contrato que
            // vence HOY casi nunca tiene cobertura de Time & Sales en MarketSnack para leer su
            // propio precio intradía ni el de sus vecinos (verificado con datos reales).
            const minDte = needsHeldTrades ? Math.max(MIN_DTE, 1) : MIN_DTE;
            const picked = pickAtmContract(candidates, day.open, { minDte, maxDte: MAX_DTE, maxStrikeDistance });
            if (picked) {
              contract = picked;
              contractTicker = candidates.find((c) => c.strike === picked.strike && c.expiration === picked.expiration)?.ticker ?? null;
            }
          }

          let contractBar = null;
          if (contractTicker) {
            try {
              contractBar = await fetchOptionDayBar(contractTicker, day.time);
            } catch {
              contractBar = null;
            }
          }

          // Precio propio del contrato + strikes vecinos a lo largo del día — todo sale del
          // MISMO fetch de MarketSnack de ese día (rawTrades), sin llamadas extra. Los vecinos
          // son 3 de continuación (mismo lado que la posición) + 3 de reversión (lado contrario).
          let flowExit: FlowExitConfig | null = null;
          let trailingStop: TrailingStopConfig | null = null;
          if (needsHeldTrades && contract && direction !== "flat") {
            const sameExpCalls = callContracts.filter((c) => c.expiration === contract!.expiration).map((c) => c.strike);
            const sameExpPuts = putContracts.filter((c) => c.expiration === contract!.expiration).map((c) => c.strike);
            const continuationStrikes = direction === "call"
              ? nearestStrikes(sameExpCalls, contract.strike, "above", 3)
              : nearestStrikes(sameExpPuts, contract.strike, "below", 3);
            const reversalStrikes = direction === "call"
              ? nearestStrikes(sameExpPuts, contract.strike, "below", 3)
              : nearestStrikes(sameExpCalls, contract.strike, "above", 3);
            const continuationType = direction;
            const reversalType = direction === "call" ? "put" : "call";

            const heldTrades: { timestamp: string; price: number }[] = [];
            const neighborTrades: NeighborZoneTrade[] = [];
            for (const t of rawTrades) {
              const info = parseOcc(t.symbol);
              if (!info || info.expiration !== contract.expiration) continue;
              if (info.strike === contract.strike && info.type === direction) {
                heldTrades.push({ timestamp: t.timestamp, price: t.price });
                continue;
              }
              if (!useFlowExit) continue; // los vecinos solo hacen falta para la reversión de flujo
              const inContinuation = info.type === continuationType && continuationStrikes.includes(info.strike);
              const inReversal = info.type === reversalType && reversalStrikes.includes(info.strike);
              if (inContinuation || inReversal) {
                neighborTrades.push({
                  timestamp: t.timestamp, symbol: t.symbol, strike: info.strike, type: info.type,
                  size: t.size, openInterest: t.open_interest, side: t.side,
                });
              }
            }

            const entryTime = `${day.time}T13:30:00Z`; // apertura del mercado (9:30am ET), aproximado
            if (useFlowExit) flowExit = { entryTime, heldTrades, neighborTrades, volumeMultiple, emergencyStopPct };
            if (useTrailingStop) trailingStop = { heldTrades, armPct, trailPct, hardStopPct };
          }

          const result = runBacktestDay({
            date: day.time, direction, spot: day.open,
            candidates: [], contract, contractBar,
            balance, riskPct, allowMinimumOne, takeProfitPct, takeProfitUsd, stopLossPct,
            flowExit, trailingStop,
          });

          if (isTrade(result)) {
            balance = result.balanceAfter;
            trades.push(result);
            send({
              type: "step",
              label: `${day.time}: ${result.direction.toUpperCase()} $${result.strike} → ${result.exitReason} · ${result.pnl >= 0 ? "+" : ""}$${result.pnl.toFixed(0)} · balance $${balance.toFixed(0)}`,
            });
          } else {
            skipped.push(result);
            send({ type: "step", label: `${day.time}: sin operación (${result.reason})` });
          }
          equityCurve.push({ date: day.time, balance });
        }

        const summary = summarizeBacktest(trades, STARTING_BALANCE);
        send({
          type: "done", trades, skipped, equityCurve, summary,
          meta: {
            ticker: TICKER, days: window.length, riskPct, takeProfitPct, stopLossPct,
            maxStrikeDistance, takeProfitUsd, requireSentimentConfirm,
            useFlowExit, volumeMultiple, emergencyStopPct, allowMinimumOne,
            useTrailingStop, armPct, trailPct, hardStopPct,
          },
        });
      } catch (err) {
        const message =
          err instanceof MassiveError || err instanceof MarketSnackError
            ? err.message
            : "Error inesperado corriendo el backtest.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
