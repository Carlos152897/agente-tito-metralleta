// Barras del subyacente para Grandes empresas (1.0 y 2.0): Massive primero y,
// si no trae nada, velas de tastytrade (DXLink). Motivo (2026-10-27): con el
// plan gratis de Massive las barras llegan vacías ("DELAYED", 0 resultados) y
// la gráfica quedaba sin historial. `fetchBars` de Massive nunca lanza (devuelve
// [] si falla), así que el respaldo se activa solo con la lista vacía.
// Solo servidor.

import { fetchBars } from "./massive";
import { fetchFutureCandles } from "./futuresCandles";
import type { TfBar } from "./types";

const UNIT: Record<"day" | "minute" | "hour" | "week", string> = { minute: "m", hour: "h", day: "d", week: "w" };

export async function fetchBarsWithFallback(
  ticker: string,
  multiplier: number,
  timespan: "day" | "minute" | "hour" | "week",
  days: number,
): Promise<TfBar[]> {
  const massive = await fetchBars(ticker, multiplier, timespan, days).catch(() => [] as TfBar[]);
  if (massive.length > 0) return massive;
  const from = Date.now() - days * 24 * 60 * 60 * 1000;
  const candles = await fetchFutureCandles(ticker.trim().toUpperCase(), from, `${multiplier}${UNIT[timespan]}`, 10_000, 20_000);
  return candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
}
