// GET /api/contratos-vecinos-3?ticker=SPX|SPY|QQQ — "Contratos vecinos 3.0"
// (Prueba de Fuego). Mismo universo de tickers que Agente ODTE, PERO sin GEX:
// pedido explícito de Carlos (ago 2026), acá el dinero real de MarketSnack
// decide TODO — dónde hay más Premium Traded marca soportes/resistencias
// candidatos, y el Net Premium ahí confirma la dirección. Ver
// lib/contratosVecinos3.ts para la lógica pura y el ejemplo práctico que dio
// Carlos a mano (SPX en 7750).
//
// Solo mira CALLS arriba del spot y PUTS abajo (nunca al revés) — así lo pidió
// Carlos. El precio en vivo combina MarketSnack (fuente principal, la misma
// que usa el resto del agente) y tastytrade (respaldo, y de paso ya trae la
// cadena de opciones que hace falta para resolver los símbolos OCC).

import { fetchZeroDteChain } from "@/lib/tastytradeChain";
import { TastytradeError } from "@/lib/tastytrade";
import { fetchAssetPrice, fetchContractActivitySummaries, MarketSnackError } from "@/lib/marketsnack";
import { isMarketOpen } from "@/lib/marketHours";
import { etDate } from "@/lib/zerodte";
import { contratosVecinos3Signal, NEIGHBOR_COUNT, type ActivityLevel } from "@/lib/contratosVecinos3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_TICKERS = new Set(["SPX", "SPY", "QQQ"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get("ticker") ?? "SPX").trim().toUpperCase();
  const TICKER = SUPPORTED_TICKERS.has(requested) ? requested : "SPX";
  const now = new Date();

  try {
    const day = etDate(now);
    const { rows, underlyingPrice } = await fetchZeroDteChain(TICKER, day);
    if (rows.length === 0) {
      return Response.json(
        { error: `Sin cadena 0DTE de ${TICKER} disponible en tastytrade ahora mismo.` },
        { status: 502 },
      );
    }

    // MarketSnack es la fuente principal de spot en vivo (mismo criterio que
    // el resto del agente); si falla, cae al precio de tastytrade que ya vino
    // con la cadena — nunca deja al usuario sin precio solo porque una de las
    // dos fuentes tuvo un problema puntual.
    const msPrice = await fetchAssetPrice(TICKER).catch(() => null);
    const spot = msPrice ?? underlyingPrice ?? 0;
    if (!(spot > 0)) {
      return Response.json({ error: `Sin precio en vivo de ${TICKER} ahora mismo.` }, { status: 502 });
    }

    const strikes = [...new Set(rows.map((r) => r.strike))];
    const above = strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, NEIGHBOR_COUNT);
    const below = strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, NEIGHBOR_COUNT);

    const bySymbolKey = new Map<string, string>();
    for (const r of rows) bySymbolKey.set(`${r.strike}|${r.contractType}`, r.optionTicker);

    const callSymbol = (s: number) => bySymbolKey.get(`${s}|call`) ?? null;
    const putSymbol = (s: number) => bySymbolKey.get(`${s}|put`) ?? null;
    // Se pide TAMBIÉN el tipo contrario en cada strike (put arriba del spot,
    // call abajo) — pedido explícito de Carlos: mostrar los dos net premium
    // lado a lado en la tabla, aunque el motor (`contratosVecinos3Signal`)
    // solo use el tipo primario para decidir la señal.
    const occSymbols = [
      ...above.flatMap((s) => [callSymbol(s), putSymbol(s)]).filter((s): s is string => s != null),
      ...below.flatMap((s) => [putSymbol(s), callSymbol(s)]).filter((s): s is string => s != null),
    ];
    const activityBySymbol = await fetchContractActivitySummaries(occSymbols);

    const aboveLevels: ActivityLevel[] = above
      .map((strike): ActivityLevel | null => {
        const symbol = callSymbol(strike);
        const activity = symbol ? activityBySymbol.get(symbol) : undefined;
        if (!activity) return null;
        const otherSymbol = putSymbol(strike);
        const otherActivity = otherSymbol ? (activityBySymbol.get(otherSymbol) ?? null) : null;
        return { strike, type: "call", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);

    const belowLevels: ActivityLevel[] = below
      .map((strike): ActivityLevel | null => {
        const symbol = putSymbol(strike);
        const activity = symbol ? activityBySymbol.get(symbol) : undefined;
        if (!activity) return null;
        const otherSymbol = callSymbol(strike);
        const otherActivity = otherSymbol ? (activityBySymbol.get(otherSymbol) ?? null) : null;
        return { strike, type: "put", activity, otherActivity };
      })
      .filter((l): l is ActivityLevel => l != null);

    const signal = contratosVecinos3Signal({ spot, above: aboveLevels, below: belowLevels });

    return Response.json({
      ticker: TICKER,
      asOf: now.toISOString(),
      spot,
      marketOpen: isMarketOpen(now),
      above: aboveLevels,
      below: belowLevels,
      signal,
    });
  } catch (err) {
    const message =
      err instanceof TastytradeError || err instanceof MarketSnackError
        ? err.message
        : "Error inesperado calculando Contratos vecinos 3.0.";
    return Response.json({ error: message }, { status: 502 });
  }
}
