// GET /api/grandes-empresas?ticker=AAPL|MSFT|... — "Grandes empresas"
// (Prueba de Fuego, ago 2026, pedido explícito de Carlos): Magnificent Seven
// + PLTR, IREN, NFLX, SPCX, INTC, ORCL. Mismo motor que "Contratos vecinos
// 3.0" (lib/contratosVecinos3.ts, el dinero real de MarketSnack decide todo,
// sin GEX) pero sobre el vencimiento más cercano disponible de Massive en vez
// del 0DTE fijo de SPX/SPY/QQQ — ver lib/massive.ts `fetchNearTermChain`.
//
// Además, sobre lo que ya daba "Contratos vecinos 3.0":
//   - "Imán" (hacia dónde está el dinero): GEX real de MarketSnack
//     (`fetchGexStats` → `magnet`, el mismo dato de lib/spxLevels.ts) — no el
//     GEX aproximado por Black-Scholes de lib/gex.ts.
//   - % movido en pre-market + soportes/resistencias del pre-market de hoy:
//     ver la nota grande más abajo, junto a `fetchAssetPriceChart`.
//   - "Sugerencias de spreads" (vertical de débito, credit call, iron condor)
//     — mismo motor puro que Agente ODTE (`lib/zerodteSuggestions.ts`), pero
//     con bid/ask REAL de tastytrade del vencimiento más cercano (Massive no
//     trae bid/ask en este plan, ver lib/creditSpreads.ts para la misma
//     limitación ya documentada). A diferencia de Agente ODTE (0DTE, siempre
//     hoy), acá el vencimiento puede caer días después — `hoursToExpirationClose`
//     (lib/occ.ts) generaliza `hoursToClose` a esa fecha. Sin `entry` (el
//     setup de "pin" al imán por Black-Scholes que sí tiene Agente ODTE): la
//     vertical cae a su fallback ya soportado (borde de 1σ) y el sesgo sale
//     del signo del net premium real ya calculado para "Contratos vecinos
//     3.0" (mismo dato, sin pedir nada nuevo) en vez del CVD acumulado en
//     disco de zerodteFlow.ts (pensado para el polling continuo de 0DTE, no
//     para 13 tickers a la vez).

import { fetchNearTermChain, fetchBars, MassiveError } from "@/lib/massive";
import {
  fetchAssetPrice,
  fetchAssetPriceChart,
  fetchGexStats,
  fetchContractActivitySummaries,
  MarketSnackError,
} from "@/lib/marketsnack";
import { isMarketOpen, isPreMarket, filterPremarketBars } from "@/lib/marketHours";
import { daysToExpiration, etTimeToUnix, hoursToExpirationClose, marketDateStr } from "@/lib/occ";
import { findPivots, clusterPivots } from "@/lib/levels";
import { contratosVecinos3Signal, NEIGHBOR_COUNT, type ActivityLevel } from "@/lib/contratosVecinos3";
import { GRANDES_EMPRESAS_TICKERS, DEFAULT_GRANDES_EMPRESA, NEAR_TERM_DTE_MAX } from "@/lib/grandesEmpresas";
import { fetchNestedOptionChain, TastytradeError } from "@/lib/tastytrade";
import { fetchZeroDteChain } from "@/lib/tastytradeChain";
import { atmIV } from "@/lib/zerodte";
import { buildSuggestions, type ZeroDteSuggestions } from "@/lib/zerodteSuggestions";
import type { TfBar } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get("ticker") ?? DEFAULT_GRANDES_EMPRESA).trim().toUpperCase();
  const TICKER = GRANDES_EMPRESAS_TICKERS.has(requested) ? requested : DEFAULT_GRANDES_EMPRESA;
  const now = new Date();

  try {
    // La cadena anidada de tastytrade (para "Sugerencias de spreads") se pide
    // en paralelo con todo lo demás, no después — es la llamada más pesada
    // de las siete (cientos de strikes/vencimientos) y esperarla en serie
    // duplicaba el tiempo total de la respuesta (~30s medido en vivo).
    const [chain, msPrice, gexStats, bars15m, dailyBars, todayChart, tastyExpirations] = await Promise.all([
      fetchNearTermChain(TICKER, { dteMax: NEAR_TERM_DTE_MAX, now }),
      fetchAssetPrice(TICKER).catch(() => null),
      fetchGexStats(TICKER, { period: "1d" }).catch(() => []),
      fetchBars(TICKER, 15, "minute", 20),
      fetchBars(TICKER, 1, "day", 5),
      fetchAssetPriceChart(TICKER).catch(() => []),
      fetchNestedOptionChain(TICKER).catch(() => []),
    ]);

    const spot = msPrice ?? chain.spot ?? dailyBars.at(-1)?.close ?? 0;
    if (!(spot > 0)) {
      return Response.json({ error: `Sin precio en vivo de ${TICKER} ahora mismo.` }, { status: 502 });
    }

    const expirations = [...new Set(chain.contracts.map((c) => c.expiration))]
      .filter((e) => daysToExpiration(e, now) >= 0)
      .sort((a, b) => daysToExpiration(a, now) - daysToExpiration(b, now));
    const nearExpiration = expirations[0] ?? null;
    if (!nearExpiration) {
      return Response.json({ error: `Sin vencimientos de ${TICKER} disponibles ahora mismo.` }, { status: 502 });
    }

    const nearRows = chain.contracts.filter((c) => c.expiration === nearExpiration);
    const strikeSet = new Set<number>();
    const symbolByStrikeType = new Map<string, string>();
    for (const c of nearRows) {
      strikeSet.add(c.strike);
      const cleanSymbol = c.optionTicker.startsWith("O:") ? c.optionTicker.slice(2) : c.optionTicker;
      symbolByStrikeType.set(`${c.strike}|${c.contractType}`, cleanSymbol);
    }
    const strikes = [...strikeSet];
    const above = strikes.filter((s) => s > spot).sort((a, b) => a - b).slice(0, NEIGHBOR_COUNT);
    const below = strikes.filter((s) => s < spot).sort((a, b) => b - a).slice(0, NEIGHBOR_COUNT);

    const callSymbol = (s: number) => symbolByStrikeType.get(`${s}|call`) ?? null;
    const putSymbol = (s: number) => symbolByStrikeType.get(`${s}|put`) ?? null;
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

    // Pre-market — % movido y soportes/resistencias de HOY.
    //
    // Massive (`fetchBars`, velas OHLC de 15 min) NO sirve para esto:
    // verificado en vivo (ago 2026) que en este entorno su feed de velas
    // intradía Y diarias está atrasado ~1 día completo (ni una vela de HOY
    // todavía, aunque el mercado ya cerró) — mientras que el snapshot de la
    // cadena de opciones sí es del día (el vencimiento más cercano ya es
    // hoy/esta semana). En cambio `fetchAssetPriceChart` (MarketSnack,
    // `/api/assets/{ticker}/chart?period=1d`) SÍ es de hoy en vivo — probado
    // con AAPL: primer punto a las 4:00 ET, sigue hasta after-hours. Solo da
    // precio puntual cada 5 min (no rango OHLC), así que se arma como vela
    // sintética open=high=low=close=v — suficiente para pivotes de
    // soporte/resistencia, no para mechas reales.
    const todayBars: TfBar[] = todayChart.map((p) => {
      const v = p.v;
      const time = Math.floor(Date.parse(p.t) / 1000);
      return { time, open: v, high: v, low: v, close: v };
    });

    // Fecha de la SESIÓN que se muestra: la del último dato disponible, no
    // necesariamente la fecha calendario de `now` — pedido explícito de
    // Carlos ("al menos mostrame los pisos y techos del pre-market de hoy"):
    // entre medianoche y las 4:00 ET el feed en vivo de MarketSnack
    // (`fetchAssetPriceChart`) todavía no tiene NINGÚN punto de la fecha
    // calendario de hoy — usar `marketDateStr(now)` ahí siempre daba `[]`,
    // aunque la sesión de ayer (la más reciente que existe) siguiera siendo
    // relevante para operar apenas abra pre-market. En cuanto arranca el feed
    // de la sesión nueva (las 4:00 ET), `sessionDateStr` salta solo a hoy —
    // sigue siendo "el día que vamos a operar, nada más", solo que resuelto
    // por dato real en vez de por el reloj de pared.
    const sessionDateStr =
      todayBars.length > 0 ? marketDateStr(new Date(todayBars.at(-1)!.time * 1000)) : marketDateStr(now);
    const premarketBars = filterPremarketBars(todayBars, sessionDateStr);
    const priorDailyBars = dailyBars.filter((b) => marketDateStr(new Date(b.time * 1000)) < sessionDateStr);
    const prevClose = priorDailyBars.at(-1)?.close ?? null;
    const premarketLastClose = premarketBars.at(-1)?.close ?? null;
    const premarketReference = isPreMarket(now) ? spot : (premarketLastClose ?? spot);
    const premarketChangePct =
      prevClose != null && prevClose > 0 && (isPreMarket(now) || premarketLastClose != null)
        ? ((premarketReference - prevClose) / prevClose) * 100
        : null;

    // "Puntos de rechazo" del pre-market (pedido explícito de Carlos, ago
    // 2026): NO es el mismo concepto que soporte/resistencia de findLevels
    // (que clasifica según el spot ACTUAL — a media mañana, con el spot ya
    // lejos del pre-market, todo salía "soporte" y nunca "resistencia", ver
    // nota vieja más abajo). Acá un "rechazo" es un pivote de precio real
    // (swing high/low) DURANTE el pre-market — el techo o el piso de donde el
    // precio se dio vuelta, sin importar dónde esté el spot ahora. Se calcula
    // una sola vez con las velas fijas del pre-market de hoy (4:00–9:30 ET) y
    // por eso sigue viéndose igual toda la sesión, incluida la apertura
    // (9:30 ET) y el resto del día — pedido explícito de Carlos.
    //
    // `clusterPivots` con tolerancia 0.2% (no el 1% por defecto, pensado para
    // swings de varios días): verificado con datos reales de AAPL (pre-market
    // 2026-08-19) que con 1% TODOS los pivotes reales se fusionaban en un
    // único nivel, y que 0.2% es lo más ajustado que sigue separando bien los
    // pivotes reales (308.62/309.47/310.54) sin over-fragmentar en ruido.
    //
    // `findPivots(..., 1)` — k=1, no el k=3 por defecto: un rechazo real del
    // pre-market puede durar solo 10-15 min (2-3 velas de 5 min), y con k=3
    // (exige perder contra 3 velas de cada lado, 30 min de confirmación) un
    // rechazo así de rápido no calificaba nunca. Pedido explícito de Carlos
    // tras ver un rechazo real (338.96) que faltaba en el gráfico aunque solo
    // hubiera pasado una vez — CERO mínimo de toques a propósito: un rechazo
    // real cuenta aunque se haya visto una sola vez, `touches` ya informa la
    // fuerza sin que haga falta descartar el de un solo toque.
    const premarketRejections =
      premarketBars.length >= 3
        ? clusterPivots(
            findPivots(
              premarketBars.map((b) => ({
                time: marketDateStr(new Date(b.time * 1000)),
                high: b.high,
                low: b.low,
                close: b.close,
              })),
              1,
            ),
            0.2,
          ).map((c) => ({
            price: c.price,
            touches: c.touches,
            // Un pivote de tipo "high" es donde el precio subió y se dio
            // vuelta (techo); "low", donde bajó y rebotó (piso). Si el
            // cluster mezcla ambos tipos, gana el que más se repitió.
            kind: c.highs >= c.lows ? ("techo" as const) : ("piso" as const),
          }))
        : [];

    const magnetBucket = gexStats.at(-1) ?? null;

    // Gráfica: velas de Massive de los últimos 20 días (pueden no llegar
    // hasta hoy, ver nota de arriba) + las velas sintéticas de HOY de
    // MarketSnack pegadas al final, para que el tramo de hoy no quede vacío.
    const lastMassiveTime = bars15m.at(-1)?.time ?? 0;
    const chartBars: TfBar[] = [...bars15m, ...todayBars.filter((b) => b.time > lastMassiveTime)];

    // Franjas de pre-market (4:00–9:30 ET) de CADA día que aparece en la
    // gráfica — para sombrearlas en gris, pedido explícito de Carlos con una
    // captura de referencia (estilo TradingView).
    const chartDates = [...new Set(chartBars.map((b) => marketDateStr(new Date(b.time * 1000))))];
    const premarketWindows = chartDates.map((d) => ({
      from: etTimeToUnix(d, 4, 0),
      to: etTimeToUnix(d, 9, 30),
    }));

    // "Sugerencias de spreads" — bid/ask REAL de tastytrade (Massive no trae
    // bid/ask en este plan). Vencimiento más cercano propio de tastytrade
    // (puede no coincidir al día exacto con el de Massive usado arriba, pero
    // en la práctica son el mismo listado real de bolsa).
    let suggestions: ZeroDteSuggestions | null = null;
    try {
      const nearestTasty = [...tastyExpirations]
        .filter((e) => e["days-to-expiration"] >= 0)
        .sort((a, b) => a["days-to-expiration"] - b["days-to-expiration"])[0];
      if (nearestTasty) {
        const { rows: tastyRows } = await fetchZeroDteChain(TICKER, nearestTasty["expiration-date"], tastyExpirations);
        if (tastyRows.length > 0) {
          const iv = atmIV(tastyRows, spot);
          const hoursLeft = hoursToExpirationClose(nearestTasty["expiration-date"], now);
          const netPremiumSum = [...aboveLevels, ...belowLevels].reduce((s, l) => s + l.activity.netPremium, 0);
          const netAggressorSign = Math.sign(netPremiumSum);
          suggestions = buildSuggestions(tastyRows, spot, iv, hoursLeft, null, netAggressorSign);
        }
      }
    } catch {
      suggestions = null; // best-effort — no debe tumbar el resto de la respuesta
    }

    return Response.json({
      ticker: TICKER,
      asOf: now.toISOString(),
      spot,
      prevClose,
      premarketChangePct,
      isPreMarket: isPreMarket(now),
      marketOpen: isMarketOpen(now),
      magnet: magnetBucket
        ? {
            strike: magnetBucket.magnet,
            callWall: magnetBucket.call_wall,
            putWall: magnetBucket.put_wall,
            gammaFlip: magnetBucket.gamma_flip,
          }
        : null,
      expiration: nearExpiration,
      bars: chartBars,
      premarketWindows,
      premarketRejections,
      above: aboveLevels,
      below: belowLevels,
      signal,
      suggestions,
    });
  } catch (err) {
    const message =
      err instanceof MassiveError || err instanceof MarketSnackError || err instanceof TastytradeError
        ? err.message
        : "Error inesperado analizando la empresa.";
    return Response.json({ error: message }, { status: 502 });
  }
}
