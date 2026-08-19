// GET /api/venta-de-primas — Screener de spreads de crédito de riesgo definido
// (21-45 DTE) por SSE.
//
// Orquesta I/O y NADA de criterio: todo lo que decide vive en lib/creditSpreads.ts.
// El saldo NO llega aquí — la ruta devuelve candidatos con métricas; el techo de
// capital y "CABEN" se calculan en el cliente con visionary.ventaPrimas.* de
// localStorage (mismo patrón que Wheel).

import { cachedDailyBars } from "@/lib/barsStore";
import { fetchFilingDates, estimateNextEarnings } from "@/lib/earnings";
import { realizedVolSeries } from "@/lib/ivcontext";
import { fetchCreditSpreadChain, type WheelChainQuote } from "@/lib/massive";
import {
  DTE_MAX, DTE_MIN, REALIZED_VOL_WINDOW,
  biasFromCloses, creditSpreadCandidatesForTicker, earningsWithinExpiration,
  marketVerdict, pickExpiration,
  type CreditSpreadCandidate, type CreditSpreadLeg, type MarketVerdictPair,
} from "@/lib/creditSpreads";
import { WHEEL_UNIVERSE } from "@/lib/wheelUniverse";
import type { VentaPrimasSseEvent } from "@/app/venta-de-primas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONCURRENCY = 6;

/**
 * Retraso declarado de las cotizaciones. Massive no publica un número exacto
 * para este endpoint puntual; 15 min es la convención que ya usa el resto del
 * repo para datos DELAYED de este tipo de plan (ver zerodteFlow.ts,
 * tastytrade.ts) — se declara así en la UI, no como un valor verificado en
 * vivo contra la documentación de Massive para /v3/snapshot/options.
 */
const QUOTE_DELAY_MINUTES = 15;

function sse(event: VentaPrimasSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function toLeg(q: WheelChainQuote): CreditSpreadLeg {
  return {
    strike: q.strike, bid: q.bid, ask: q.ask, openInterest: q.openInterest,
    lastPrice: q.lastTrade ?? q.dayClose ?? null,
    impliedVolatility: q.impliedVolatility ?? null,
  };
}

/** Corre `worker` sobre `items` con como mucho `limit` en vuelo a la vez. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function run(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

export async function GET() {
  const now = new Date();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: VentaPrimasSseEvent) => controller.enqueue(encoder.encode(sse(e)));
      let failed = 0;
      const all: CreditSpreadCandidate[] = [];
      const verdictPairs: MarketVerdictPair[] = [];

      try {
        send({
          type: "step",
          label: `Escaneando ${WHEEL_UNIVERSE.length} tickers · spreads de crédito 21-45 días`,
        });

        await mapLimit(WHEEL_UNIVERSE, CONCURRENCY, async (sym) => {
          const ticker = sym.ticker;
          try {
            const [chain, bars, filings] = await Promise.all([
              fetchCreditSpreadChain(ticker, { dteMin: DTE_MIN, dteMax: DTE_MAX, now }),
              cachedDailyBars(ticker, 400, now),
              fetchFilingDates(ticker).catch(() => [] as string[]),
            ]);

            if (chain.puts.length === 0 && chain.calls.length === 0) {
              failed++;
              send({ type: "step", label: `${ticker}: sin cadena` });
              return;
            }

            const closes = bars.map((b) => b.close);
            // El plan de Massive no trae underlying_asset.price en este endpoint
            // (confirmado en vivo, ver la nota en fetchCreditSpreadChain) — se usa
            // el último cierre de las mismas barras diarias que ya se piden para
            // la volatilidad realizada. Es EOD, no intradía, pero es coherente con
            // el resto de las cotizaciones (retrasadas) de este barrido.
            const spot = chain.spot ?? (closes.length > 0 ? closes[closes.length - 1] : null);
            if (spot == null) {
              failed++;
              send({ type: "step", label: `${ticker}: sin precio del subyacente` });
              return;
            }
            const bias = biasFromCloses(closes, 20);

            // Volatilidad realizada de los últimos 22 cierres (para el VE) +
            // la serie completa de RV de 22 días sobre el histórico disponible
            // (para el percentil de PRIMA CARA/NORMAL/BARATA).
            const rvSeries = realizedVolSeries(closes, REALIZED_VOL_WINDOW);
            const currentRv = rvSeries.length > 0 ? rvSeries[rvSeries.length - 1] : null;
            if (currentRv == null) {
              failed++;
              send({ type: "step", label: `${ticker}: sin historial suficiente para volatilidad realizada` });
              return;
            }

            // Vencimiento: el más cercano al punto medio de la ventana 21-45,
            // entre los que trajo la cadena de ambos lados.
            const expirations = [...chain.puts, ...chain.calls].map((q) => ({ expiration: q.expiration, dte: q.dte }));
            const chosen = pickExpiration(expirations, DTE_MIN, DTE_MAX);
            if (!chosen) {
              failed++;
              send({ type: "step", label: `${ticker}: sin vencimiento en la ventana 21-45 días` });
              return;
            }

            const putLegs = chain.puts.filter((q) => q.expiration === chosen.expiration).map(toLeg);
            const callLegs = chain.calls.filter((q) => q.expiration === chosen.expiration).map(toLeg);

            // Earnings: fecha de ANUNCIO estimada de la cadencia de filing_date
            // (no la fecha de filing en sí — ver lib/earnings.ts). La HORA del
            // anuncio ("before_open"/"after_close") no la da ninguna fuente ya
            // integrada en el repo (confirmado en vivo: /benzinga/v1/earnings
            // → 403 "no entitled"; /v1/reference/earnings, /vX/reference/earnings
            // y /v3/reference/tickers/{t}/events → 404, todos en el plan actual
            // de Massive). Se usa "unknown" siempre, que por la regla conservadora
            // cae en "dentro" — limitación declarada en la UI, no silenciosa.
            const nextEarnings = estimateNextEarnings(filings, now);
            const earningsWithin = earningsWithinExpiration({
              earningsDate: nextEarnings, timing: "unknown", expiration: chosen.expiration,
            });

            const candidates = creditSpreadCandidatesForTicker({
              ticker, spot, expiration: chosen.expiration, dte: chosen.dte,
              putLegs, callLegs, bias,
              realizedVolPct: currentRv,
              premiumSeriesPct: rvSeries,
              earningsWithin,
            });

            if (candidates.length > 0) {
              all.push(...candidates);
              // Representativo de "lo que se está pagando" para el veredicto de
              // mercado: promedio de IV de las patas cortas generadas para este
              // ticker (todas del mismo lado, ya que un ticker solo produce un
              // lado por escaneo — el que fija `bias`).
              const impliedAvg = candidates.reduce((s, c) => s + c.iv, 0) / candidates.length;
              verdictPairs.push({ ticker, realizedVolPct: currentRv, impliedVolPct: impliedAvg * 100 });
              send({ type: "step", label: `${ticker}: ${candidates.length} candidatos (${bias})` });
            } else {
              send({ type: "step", label: `${ticker}: sin candidatos operables` });
            }
          } catch {
            failed++;
            send({ type: "step", label: `${ticker}: error` });
          }
        });

        const withCandidates = new Set(all.map((c) => c.ticker)).size;
        const earningsWithinCount = all.filter((c) => c.earningsWithin).length;

        send({
          type: "done",
          candidates: all,
          meta: {
            scanned: WHEEL_UNIVERSE.length,
            failed,
            withCandidates,
            degraded: failed > WHEEL_UNIVERSE.length / 2,
            dteMin: DTE_MIN,
            dteMax: DTE_MAX,
            earningsWithinCount,
            marketVerdict: marketVerdict(verdictPairs),
            quoteDelayMinutes: QUOTE_DELAY_MINUTES,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error inesperado en el escaneo.";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
