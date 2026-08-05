// GET /api/wheel?preset=balanceado — Screener de cash-secured puts por SSE.
//
// Orquesta I/O y NADA de criterio: todo lo que decide vive en lib/wheel.ts.
// El saldo NO llega aquí: la ruta devuelve candidatos con métricas y la
// asequibilidad se calcula en el cliente con visionary.risk.* de localStorage.

import { fetchWheelChain } from "@/lib/massive";
import { fetchGreeksMap } from "@/lib/schwab";
import { greeksKey } from "@/lib/schwabParse";
import { cachedDailyBars } from "@/lib/barsStore";
import { findLevels, type LvlBar } from "@/lib/levels";
import { realizedVolSeries, rankWithin } from "@/lib/ivcontext";
import { earningsForTicker } from "@/lib/earnings";
import {
  WHEEL_PRESETS, wheelCandidates,
  type ChainQuote, type PresetId, type WheelCandidate,
} from "@/lib/wheel";
import { WHEEL_UNIVERSE } from "@/lib/wheelUniverse";
import type { WheelSseEvent } from "@/app/wheel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONCURRENCY = 6;

function sse(event: WheelSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isPreset(v: string | null): v is PresetId {
  return v === "conservador" || v === "balanceado" || v === "agresivo";
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const presetParam = url.searchParams.get("preset");
  const preset = WHEEL_PRESETS[isPreset(presetParam) ? presetParam : "balanceado"];
  const now = new Date();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: WheelSseEvent) => controller.enqueue(encoder.encode(sse(e)));
      let failed = 0;
      const all: WheelCandidate[] = [];

      try {
        send({ type: "step", label: `Escaneando ${WHEEL_UNIVERSE.length} tickers · preset ${preset.label}` });

        await mapLimit(WHEEL_UNIVERSE, CONCURRENCY, async (sym) => {
          try {
            const chain = await fetchWheelChain(sym.ticker, {
              dteMin: preset.dteMin, dteMax: preset.dteMax, now,
            });
            if (chain.quotes.length === 0) {
              failed++;
              send({ type: "step", label: `${sym.ticker}: sin cadena` });
              return;
            }

            // Delta/IV real de Schwab, si está configurado — opcional: si falla
            // (sin credenciales, rate limit, ticker no cubierto) el candidato sigue
            // con Black-Scholes/IV implícita como antes, sin marcar al ticker como fallido.
            // Bonus: Massive a veces no trae underlying_asset.price en este endpoint
            // (chain.spot sale null) — el underlyingPrice de Schwab sirve de respaldo
            // para no perder el ticker entero por un solo campo faltante.
            let quotes: ChainQuote[] = chain.quotes;
            let spot = chain.spot;
            try {
              const { underlyingPrice, greeks } = await fetchGreeksMap(sym.ticker, {
                contractType: "PUT",
                fromDate: toDateStr(now),
                toDate: toDateStr(new Date(now.getTime() + preset.dteMax * 86_400_000)),
              });
              spot = spot ?? underlyingPrice;
              quotes = chain.quotes.map((q) => {
                const real = greeks[greeksKey(q.strike, q.expiration, "put")];
                return { ...q, delta: real?.delta ?? null, iv: real?.iv ?? null };
              });
            } catch {
              // Schwab opcional — sin él, sigue con la estimación de siempre.
            }

            if (spot == null) {
              failed++;
              send({ type: "step", label: `${sym.ticker}: sin precio del subyacente` });
              return;
            }
            // fetchWheelChain solo filtra a OTM cuando YA conoce el spot; si vino de
            // Schwab (chain.spot era null), ese filtro no corrió — se aplica aquí.
            if (chain.spot == null) quotes = quotes.filter((q) => q.strike <= spot!);

            const bars = await cachedDailyBars(sym.ticker, 365, now);
            const lvlBars: LvlBar[] = bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close }));
            const levels = findLevels({ bars: lvlBars, spot, now });

            // IV Rank propio: proxy de volatilidad realizada (no hay serie de IV).
            const rvSeries = realizedVolSeries(bars.map((b) => b.close), 30);
            const currentRv = rvSeries.length > 0 ? rvSeries[rvSeries.length - 1] : null;
            const ivRank = currentRv != null ? rankWithin(rvSeries, currentRv) : null;

            // Earnings sobre el vencimiento más cercano de la ventana.
            // frontSkew: null a propósito — este escaneo Wheel no computa
            // ivContextScore por ticker (no hay flujo de MarketSnack por
            // símbolo aquí), así que la confirmación por skew de earningsFlag
            // ("dentro_confirmado") queda pendiente y hoy nunca dispara; ver
            // la nota en lib/earnings.ts (earningsForTicker).
            const nearExp = chain.quotes.reduce((a, b) => (b.dte < a.dte ? b : a)).expiration;
            const earnings = await earningsForTicker({
              ticker: sym.ticker, expiration: nearExp, frontSkew: null, now,
            });

            const fallbackIv = currentRv != null ? currentRv / 100 : 0.4;
            const cands = wheelCandidates({
              ticker: sym.ticker, spot, quotes,
              preset, ivRank, supports: levels.supports, earnings, fallbackIv,
            });
            all.push(...cands);
            send({ type: "step", label: `${sym.ticker}: ${cands.filter((c) => !c.blocked).length} candidatos` });
          } catch {
            failed++;
            send({ type: "step", label: `${sym.ticker}: error` });
          }
        });

        all.sort((a, b) => {
          if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
          return (b.score?.total ?? 0) - (a.score?.total ?? 0);
        });

        const withCandidates = new Set(all.filter((c) => !c.blocked).map((c) => c.ticker)).size;
        send({
          type: "done",
          candidates: all,
          meta: {
            preset: preset.label,
            scanned: WHEEL_UNIVERSE.length,
            failed,
            withCandidates,
            degraded: failed > WHEEL_UNIVERSE.length / 2,
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
