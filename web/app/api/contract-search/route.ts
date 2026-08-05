// GET /api/contract-search — "Búsqueda de contratos": los 3-5 contratos más
// agresivos de TODO el mercado (no solo TSLA/SPX), por SSE.
//
// Calco de app/api/ideas/route.ts hasta el escaneo de flujo; la capa 1 de calidad
// de ese screener (isTradeableIdea/passesQualityFilter, lib/risk.ts) NO se reusa
// acá a propósito — exige MIN_DTE=7 y penaliza el theta alto, ambas pensadas para
// ideas de swing/LEAPS, justo lo CONTRARIO de lo que necesita el day-trading
// (0-5 DTE, donde un theta diario alto es normal y esperable). Lo que cambia
// entonces es el filtro de calidad completo (isNearMoney + isNearExpiration en
// vez de la capa 1), el orden final (agresividad en vez de premium) y el corte a
// FAVORITES_COUNT, con fetchCompany solo para los finalistas (no por candidato).

import { cachedDailyBars } from "@/lib/barsStore";
import { toRow } from "@/lib/compute";
import { classifyFlow, dedupeByContract } from "@/lib/flow";
import {
  estimateTarget,
  EXCLUDED_TICKERS,
  FAVORITES_COUNT,
  isNearExpiration,
  isNearMoney,
  MIN_CONVICTION_PCT,
  rankByAggression,
} from "@/lib/contractSearch";
import { gexAnalysis, type TradeLite } from "@/lib/gex";
import { candidateStrikesForSide } from "@/lib/backtest";
import { fetchContractPremiumSummaries, fetchMarketFlow, MarketSnackError } from "@/lib/marketsnack";
import { fetchCompany, fetchOptionChain, MassiveError } from "@/lib/massive";
import { marketDateStr } from "@/lib/occ";
import {
  NEIGHBOR_WALK_COUNT,
  neighborContractsWalk,
  profitSideOf,
  resolveStrikeContracts,
  toStrikePremiums,
} from "@/lib/neighborContracts";
import type { ContractSearchSseEvent, FavoriteContract, GexReference, NeighborReference } from "@/app/prueba-de-fuego/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PREMIUM = 500_000;
const MAX_PAGES = 8;
const PERIOD = "1d";

// Solo estos tres usan GEX como referencia (pedido de Carlos, 2026-07-28) — el
// resto del mercado sigue con el modelo de movimiento esperado, sin GEX.
// "SPXW" es la raíz OCC real de las semanales de SPX en el flujo (ver
// lib/occ.ts parseOcc) — el índice mismo se pide como "SPX" en Massive.
const GEX_REFERENCE_TICKERS = new Set(["SPY", "SPX", "SPXW", "QQQ"]);
function gexQueryTicker(underlying: string): string {
  return underlying === "SPXW" ? "SPX" : underlying;
}

// EXCLUDED_TICKERS (lib/contractSearch.ts): SPX ya tiene su botón dedicado —
// mostrarlo acá además traía valores mal calculados, `fetchCompany` se llama
// con `r.underlying` tal cual ("SPXW"), que no es un ticker real en Massive
// (a diferencia de `gexQueryTicker`, que sí normaliza SPXW→SPX pero solo para
// el bloque de GEX) — el spot en vivo de esos candidatos quedaba `null`.

function sse(event: ContractSearchSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  const now = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ContractSearchSseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        send({ type: "step", label: "Escaneando el flujo de todo el mercado…" });

        const { trades, pages, truncated } = await fetchMarketFlow({
          period: PERIOD,
          minPremium: MIN_PREMIUM,
          maxPages: MAX_PAGES,
          onPage: (page, accumulated) => {
            send({ type: "step", label: `Página ${page} — ${accumulated} operaciones grandes` });
          },
        });

        send({ type: "step", label: `Clasificando ${trades.length} operaciones…` });
        const { rows } = classifyFlow(trades, now);

        // Mismo filtro que lib/dayTrade.ts: MarketSnack con period="1d" es una
        // ventana rolling, no el día de mercado calendario — antes de la apertura
        // (o si hoy todavía no operó nadie) seguía devolviendo trades de ayer.
        const sinceIso = `${marketDateStr(now)}T00:00:00Z`;
        const sinceMs = Date.parse(sinceIso);
        const todaysRows = rows
          .filter((r) => Date.parse(r.timestamp) >= sinceMs)
          .filter((r) => !EXCLUDED_TICKERS.has(r.underlying));

        const nearMoney = dedupeByContract(todaysRows)
          .filter((r) => isNearExpiration(r))
          .filter((r) => isNearMoney(r));

        // Convicción con el precio del subyacente AL MOMENTO DEL TRADE (barato, sin
        // pedir spot en vivo todavía) — solo para decidir qué candidatos sobreviven.
        send({ type: "step", label: "Calculando target real y convicción…" });
        const tradeable = nearMoney.filter((r) => {
          const { convictionPct } = estimateTarget(r, null);
          return convictionPct != null && convictionPct > MIN_CONVICTION_PCT;
        });

        send({ type: "step", label: "Ordenando por agresividad (compra al ask)…" });
        const top = rankByAggression(tradeable).slice(0, FAVORITES_COUNT);

        send({ type: "step", label: `Buscando precio en vivo de ${top.length} tickers…` });
        const spots = new Map<string, number | null>();
        await Promise.all(
          [...new Set(top.map((r) => r.underlying))].map(async (ticker) => {
            try {
              const company = await fetchCompany(ticker);
              spots.set(ticker, company.price);
            } catch {
              spots.set(ticker, null);
            }
          }),
        );

        // GEX de referencia SOLO para SPY/SPX/QQQ entre los finalistas — nunca para
        // acciones. Se calcula una vez por ticker (no por candidato) y best-effort:
        // si falla, ese candidato simplemente queda sin referencia, no rompe el escaneo.
        const gexCandidates = top.filter((r) => GEX_REFERENCE_TICKERS.has(r.underlying));
        const gexRefs = new Map<string, GexReference>();
        if (gexCandidates.length > 0) {
          const queryTickers = [...new Set(gexCandidates.map((r) => gexQueryTicker(r.underlying)))];
          send({ type: "step", label: `Calculando GEX de referencia (${queryTickers.join(", ")})…` });
          await Promise.all(
            queryTickers.map(async (qTicker) => {
              try {
                const sample = gexCandidates.find((r) => gexQueryTicker(r.underlying) === qTicker);
                const spot = sample ? spots.get(sample.underlying) ?? sample.assetPrice : null;
                if (!spot) return;
                const [{ contracts }, bars] = await Promise.all([
                  fetchOptionChain(qTicker),
                  cachedDailyBars(qTicker, 60, now),
                ]);
                const tradeLites: TradeLite[] = todaysRows
                  .filter((r) => gexQueryTicker(r.underlying) === qTicker && r.strike != null && r.type !== "unknown")
                  .map((r) => ({ strike: r.strike as number, type: r.type as "call" | "put", premium: r.premium, gamma: r.gamma }));
                const gex = gexAnalysis({
                  rows: contracts.map(toRow), closes: bars.map((b) => b.close), spot, trades: tradeLites, now,
                });
                gexRefs.set(qTicker, {
                  direction: gex.direction, kingStrike: gex.kingStrike, confidence: gex.confidence, regime: gex.regime,
                });
              } catch {
                // best-effort — sin referencia de GEX para este ticker, nada más.
              }
            }),
          );
        }

        // Contratos vecinos de referencia — a diferencia del GEX, esto aplica a
        // CUALQUIER ticker (MarketSnack siempre es la fuente de flujo, pedido de
        // Carlos 2026-07-30). Best-effort por finalista, igual que gexRefs: un
        // candidato lento/fallido queda sin referencia, no rompe el escaneo.
        send({ type: "step", label: "Leyendo contratos vecinos de los finalistas…" });
        const neighborRefs = new Map<string, NeighborReference>();
        await Promise.all(
          top.map(async (r) => {
            if (r.strike == null || r.expiration == null || r.type === "unknown") return;
            try {
              const { contracts } = await fetchOptionChain(r.underlying);
              const sameExpiryRows = contracts.map(toRow).filter((row) => row.expiration === r.expiration);
              const chainStrikes = sameExpiryRows.map((row) => row.strike);
              const neighborStrikes = candidateStrikesForSide(
                chainStrikes, r.strike as number, profitSideOf(r.type as "call" | "put"), NEIGHBOR_WALK_COUNT,
              );
              const strikeContracts = resolveStrikeContracts(neighborStrikes, sameExpiryRows, now, r.underlying);
              const occSymbols = [...strikeContracts.values()].flatMap((c) => [c.call, c.put]).filter((s): s is string => s != null);
              const premiumsBySymbol = await fetchContractPremiumSummaries(occSymbols);
              const strikePremiums = toStrikePremiums(strikeContracts, premiumsBySymbol);
              const walk = neighborContractsWalk({
                centerStrike: r.strike as number, type: r.type as "call" | "put", chainStrikes, strikePremiums,
              });
              if (walk && walk.levels.length > 0) {
                neighborRefs.set(r.symbol, { confirms: walk.flipStrike !== walk.levels[0].strike, flipStrike: walk.flipStrike });
              }
            } catch {
              // best-effort — sin referencia de contratos vecinos para este candidato, nada más.
            }
          }),
        );

        const favorites: FavoriteContract[] = top.map((r) => {
          const liveSpot = spots.get(r.underlying) ?? r.assetPrice;
          const projection = estimateTarget(r, liveSpot);
          return {
            ticker: r.underlying,
            symbol: r.symbol,
            type: r.type === "unknown" ? "call" : r.type,
            strike: r.strike,
            expiration: r.expiration,
            premium: r.premium,
            size: r.size,
            delta: r.delta,
            assetPrice: liveSpot ?? r.assetPrice,
            target: projection.target,
            convictionPct: projection.convictionPct,
            changePctToTarget: projection.changePctToTarget,
            estUsdGain: projection.estUsdGain,
            timestamp: r.timestamp,
            gexReference: GEX_REFERENCE_TICKERS.has(r.underlying)
              ? gexRefs.get(gexQueryTicker(r.underlying)) ?? null
              : null,
            neighborReference: neighborRefs.get(r.symbol) ?? null,
          };
        });

        send({ type: "done", favorites, meta: { scanned: trades.length, pages, truncated } });
      } catch (err) {
        const message =
          err instanceof MarketSnackError || err instanceof MassiveError
            ? err.message
            : "Error inesperado al buscar contratos.";
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
