// GET /api/vision-futura/prueba?inst=SPX&w=5|15|30|60|1D
// Vista "Prueba" de la escalera: posicionamiento por strike con la fórmula oficial (lib/visionFuturaPrueba.ts)
// sobre el flujo trade por trade de MarketSnack (lib/visionFuturaPruebaData.ts). Devuelve la ventana
// actual y la anterior del mismo tamaño (ENTRANDO / SALIENDO) y el agresor por strike con la regla del
// Paso 1. El navegador la pide cada 15 s; los pisos/techos/imanes se arman allá con la gamma de la escalera.

import { NextResponse } from "next/server";
import { loadPruebaFeed, PRUEBA_DATA_TUNING } from "@/lib/visionFuturaPruebaData";
import {
  aggressorSide, positionWindow, prepare, PRUEBA_WINDOWS, windowBounds,
  type PruebaAgg, type PruebaResponse, type PruebaTrade,
} from "@/lib/visionFuturaPrueba";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let prepCache: { key: string; prep: ReturnType<typeof prepare> } | null = null;

/** Agresor por strike (Paso 1) en $ de prima: compras al ask/cerca del ask, ventas al bid/cerca del bid. */
function aggressorBy(trades: PruebaTrade[], cur: [number, number], prev: [number, number]): PruebaAgg[] {
  const by = new Map<number, PruebaAgg>();
  const get = (k: number) => {
    let a = by.get(k);
    if (!a) { a = { strike: k, buy: 0, sell: 0, prevBuy: 0, prevSell: 0 }; by.set(k, a); }
    return a;
  };
  for (const t of trades) {
    const inCur = t.t > cur[0] && t.t <= cur[1];
    const inPrev = t.t > prev[0] && t.t <= prev[1];
    if (!inCur && !inPrev) continue;
    const side = aggressorSide(t.price, t.bid, t.ask);
    if (!side) continue;
    const a = get(t.strike);
    if (inCur) { if (side === "compra") a.buy += t.premium; else a.sell += t.premium; }
    if (inPrev) { if (side === "compra") a.prevBuy += t.premium; else a.prevSell += t.premium; }
  }
  return [...by.values()];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inst = (url.searchParams.get("inst") ?? "SPX").toUpperCase();
  if (inst !== "SPX") return NextResponse.json({ error: "La vista Prueba por ahora es solo SPX." }, { status: 400 });
  const wRaw = url.searchParams.get("w") ?? "15";
  const w = PRUEBA_WINDOWS.find((x) => String(x) === wRaw) ?? 15;
  try {
    const feed = await loadPruebaFeed(inst);
    const key = `${feed.date}|${feed.version}|${feed.trades.length}`;
    if (!prepCache || prepCache.key !== key) prepCache = { key, prep: prepare(feed.trades) };
    const prep = prepCache.prep;
    const bounds = windowBounds(w, feed.asOf, feed.open);
    const cur = positionWindow(prep, bounds.cur[0], bounds.cur[1]);
    const prev = positionWindow(prep, bounds.prev[0], bounds.prev[1]);
    const body: PruebaResponse = {
      inst, date: feed.date, window: w, asOf: feed.asOf,
      cur: [...cur.byStrike.values()], prev: [...prev.byStrike.values()],
      unclassified: cur.unclassified, classified: cur.classified,
      bySubagent: cur.bySubagent, prevBySubagent: prev.bySubagent, structures: cur.structures,
      agg: aggressorBy(feed.trades, bounds.cur, bounds.prev),
      bounds, coveredFrom: feed.coveredFrom, segmentsDone: feed.segmentsDone, segmentsTotal: feed.segmentsTotal,
      tradesTotal: feed.trades.length, lastTradeT: feed.lastTradeT, minPremium: PRUEBA_DATA_TUNING.minPremium,
      cookieExpired: feed.cookieExpired, error: feed.error,
    };
    return NextResponse.json(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cookieExpired = msg.includes("Cookie de MarketSnack expirada");
    return NextResponse.json({ error: msg, cookieExpired }, { status: cookieExpired ? 401 : 500 });
  }
}
