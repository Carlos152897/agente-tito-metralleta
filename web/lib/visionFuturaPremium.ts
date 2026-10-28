// Prima neta minuto a minuto de MarketSnack en VisionFutura (etapa 3, 28-oct-2026). PURO.
//
// `net_premium_sentiment` da, por minuto, la prima neta ACUMULADA del día de calls y de puts del
// vencimiento (compras al ask − ventas al bid). Verde (hacia arriba) = calls compradas + puts
// vendidas → sube net_call, baja net_put. Por eso la dirección del dinero = net_call − net_put.
//
// "Dinero nuevo 15 min (MarketSnack)" = cuánto cambió (net_call − net_put) en los últimos 15 min,
// con los MISMOS umbrales que el voto 3 de la Señal del dinero ($500K y 15%). NO reemplaza ese
// voto: se guarda junto a la lectura y a cada señal para comparar con unos días de datos.

import type { MsPremiumMinute } from "./marketsnack";
import { MONEY_TUNING } from "./visionFuturaMoneyFlow";

export interface PremiumPoint { time: number; call: number; put: number }

export interface PremiumNewMoney {
  vote: -1 | 0 | 1;
  /** Cambio de la prima neta de calls / puts en la ventana ($). */
  dCall: number;
  dPut: number;
  /** dCall − dPut: + = dinero hacia arriba. */
  net: number;
  minutes: number;
  detail: string;
}

/** Serie en segundos, ordenada, sin puntos inválidos. */
export function premiumSeries(raw: MsPremiumMinute[]): PremiumPoint[] {
  return raw
    .map((p) => ({ time: Math.floor(Date.parse(p.t) / 1000), call: p.net_call_premium, put: p.net_put_premium }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.call) && Number.isFinite(p.put))
    .sort((a, b) => a.time - b.time);
}

const m = (v: number) => `${v >= 0 ? "+" : "−"}$${(Math.abs(v) / 1e6).toFixed(1)}M`;

/**
 * Dinero nuevo en los últimos `minutes` hasta `nowMs` (incluido). null si no hay un punto de
 * hace ~`minutes` (±5 min) y otro reciente (≤ 3 min).
 */
export function premiumNewMoney(series: PremiumPoint[], nowMs: number, minutes = 15, t = MONEY_TUNING): PremiumNewMoney | null {
  const nowSec = nowMs / 1000;
  const past = series.filter((p) => p.time <= nowSec);
  const last = past.at(-1);
  if (!last || nowSec - last.time > 180) return null;
  const target = last.time - minutes * 60;
  const ago = [...past].reverse().find((p) => p.time <= target);
  if (!ago || target - ago.time > 300) return null;
  const dCall = last.call - ago.call;
  const dPut = last.put - ago.put;
  const net = dCall - dPut;
  const gross = Math.abs(dCall) + Math.abs(dPut);
  const vote: -1 | 0 | 1 = gross >= t.newMoneyMinUsd && Math.abs(net) >= t.newMoneyRatio * gross ? (net > 0 ? 1 : -1) : 0;
  return {
    vote, dCall, dPut, net, minutes,
    detail: `calls ${m(dCall)} · puts ${m(dPut)} → ${net >= 0 ? "arriba" : "abajo"} ${m(net).replace(/^[+−]/, "")}${vote === 0 ? " (sin dirección clara)" : ""}`,
  };
}
