// GET /api/unusual-swing — "Unusual Swing Trades": escanea TODO el mercado
// buscando contratos OTM, vencimiento 60-90 días, premium ≥$5M, volumen muy
// grande y muy por encima del Open Interest, comprados agresivamente al ask,
// una sola pata. Por SSE, calco del armado de app/api/contract-search/route.ts.

import { classifyFlow, dedupeByContract } from "@/lib/flow";
import { isUnusualSwingCandidate, MAX_RESULTS, rankUnusualSwing } from "@/lib/unusualSwing";
import { fetchMarketFlow, MarketSnackError } from "@/lib/marketsnack";
import { fetchCompany, MassiveError } from "@/lib/massive";
import type { UnusualSwingCandidate, UnusualSwingSseEvent } from "@/app/unusual-swing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PREMIUM = 5_000_000;
// 8 páginas (~400 trades) truncaba el escaneo antes de terminar el flujo del
// día en cuanto un ticker muy activo (ej. XSP) concentraba las operaciones
// grandes más recientes — dejaba fuera todo lo demás sin avisar (ver
// meta.truncated en page.tsx). Sin límite de tiempo de función serverless acá
// (corre local, sin maxDuration/Vercel), así que el único costo de subirlo es
// una espera más larga en el escaneo, no un riesgo de timeout.
const MAX_PAGES = 25;
const PERIOD = "1d";

function sse(event: UnusualSwingSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET() {
  const encoder = new TextEncoder();
  const now = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: UnusualSwingSseEvent) => controller.enqueue(encoder.encode(sse(e)));

      try {
        send({ type: "step", label: "Escaneando el flujo de todo el mercado…" });

        const { trades, pages, truncated } = await fetchMarketFlow({
          period: PERIOD,
          minPremium: MIN_PREMIUM,
          maxPages: MAX_PAGES,
          // isUnusualSwingCandidate ya exige aggression==="ask" (comprados
          // agresivamente al ask) — pedirlo server-side (probado en vivo:
          // "ASKSIDE" agrupa ASKSIDE+AT_ASK+ABOVE_ASK) saca del medio a la
          // mitad de los trades (bid/mid) sin cambiar el criterio en nada,
          // así el cupo de MAX_PAGES rinde el doble.
          side: ["ASKSIDE"],
          onPage: (page, accumulated) => {
            send({ type: "step", label: `Página ${page} — ${accumulated} operaciones grandes` });
          },
        });

        send({ type: "step", label: `Clasificando ${trades.length} operaciones…` });
        const { rows } = classifyFlow(trades, now);

        send({ type: "step", label: "Buscando actividad inusual (OTM, 60-90 días, premium ≥$5M, volumen >> OI, al ask)…" });
        const candidates = dedupeByContract(rows).filter(isUnusualSwingCandidate);
        const top = rankUnusualSwing(candidates).slice(0, MAX_RESULTS);

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

        // strike/expiration/dte no son null acá: isUnusualSwingCandidate ya lo garantizó (isOtm + dte check).
        const result: UnusualSwingCandidate[] = top.map((r) => ({
          symbol: r.symbol,
          ticker: r.underlying,
          type: r.type === "unknown" ? "call" : r.type,
          strike: r.strike!,
          expiration: r.expiration!,
          dte: r.dte,
          assetPrice: spots.get(r.underlying) ?? r.assetPrice,
          volume: r.volume,
          openInterest: r.openInterest,
          premium: r.premium,
          delta: r.delta,
          timestamp: r.timestamp,
        }));

        send({ type: "done", candidates: result, meta: { scanned: trades.length, pages, truncated } });
      } catch (err) {
        const message =
          err instanceof MarketSnackError || err instanceof MassiveError
            ? err.message
            : "Error inesperado al buscar contratos inusuales.";
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
