// Etapa 4 de la terminal de MarketSnack en VisionFutura (28-oct-2026). PURO.
//
// (1) GEX de varios vencimientos por strike (como el mapa de la terminal: strike × hoy, 1, 2, 3, 4
//     DTE). Un piso/techo de hoy pesa más si los vencimientos siguientes tienen GEX del MISMO signo
//     en ese strike ("★ respaldado"); si la mayoría va al revés, "contrario".
// (2) Operaciones inusuales de MarketSnack (una por una) → puntos en la gráfica (hora × strike).

import { computeStrikeGex, type ExtendedChainContract } from "./spxLevels";
import { parseOcc } from "./occ";
import type { MsUnusualTrade } from "./marketsnack";

export interface ExpGex { expiration: string; netGex: number }
export type Backing = "respaldado" | "contrario" | null;

export const MULTI_EXP_TUNING = {
  /** Cuántos vencimientos después del actual se miran. */
  nextCount: 4,
  /** GEX mínimo de un vencimiento para que cuente (fracción del |GEX| más grande de los días siguientes). */
  minFrac: 0.05,
};

/** GEX neto por strike de cada vencimiento siguiente. */
export function multiExpGex(chains: { expiration: string; contracts: ExtendedChainContract[] }[], spot: number, strikes: number[]): Map<number, ExpGex[]> {
  const maps = chains.map((c) => ({ expiration: c.expiration, g: computeStrikeGex(c.contracts, spot) }));
  const out = new Map<number, ExpGex[]>();
  for (const s of strikes) out.set(s, maps.map((m) => ({ expiration: m.expiration, netGex: m.g.get(s)?.netGex ?? 0 })));
  return out;
}

/**
 * ¿Los vencimientos siguientes respaldan el GEX de hoy en este strike? Cuentan solo los que
 * tienen GEX de tamaño (≥ 5% del más grande del strike). Respaldado = mayoría del mismo signo
 * que hoy; contrario = mayoría al revés; null = sin GEX hoy o empate/sin datos.
 */
export function backingOf(todayNetGex: number, next: ExpGex[], t = MULTI_EXP_TUNING): Backing {
  if (!todayNetGex) return null;
  // Se compara solo entre los días siguientes: si hoy es enorme, no debe borrar a los demás.
  const big = Math.max(0, ...next.map((e) => Math.abs(e.netGex)));
  if (!big) return null;
  const counted = next.filter((e) => Math.abs(e.netGex) >= t.minFrac * big);
  if (!counted.length) return null;
  const same = counted.filter((e) => Math.sign(e.netGex) === Math.sign(todayNetGex)).length;
  const diff = counted.length - same;
  return same > diff ? "respaldado" : diff > same ? "contrario" : null;
}

/** Campos que la carga agrega a cada fila de la escalera. */
export interface RowMultiExp { multiExp?: ExpGex[]; backing?: Backing }

export interface UnusualDot {
  id: number;
  /** segundos */
  time: number;
  strike: number;
  type: "call" | "put";
  premium: number;
  size: number;
  price: number;
  side: string;
  sentiment: string;
  score: number;
  priority: string;
  /** Dirección que implica: compra de call / venta de put = arriba; al revés = abajo; mitad = null. */
  dir: "arriba" | "abajo" | null;
  symbol: string;
}

/** Lado de la operación → dirección (ASKSIDE = compran; BIDSIDE = venden; MIDMKT = no se sabe). */
export function unusualDots(trades: MsUnusualTrade[]): UnusualDot[] {
  const out: UnusualDot[] = [];
  for (const u of trades) {
    const o = parseOcc(u.symbol);
    const time = Math.floor(Date.parse(u.timestamp) / 1000);
    if (!o || !Number.isFinite(time)) continue;
    const s = (u.side ?? "").toUpperCase();
    const buy = s.includes("ASK"), sell = s.includes("BID");
    const type = o.type;
    const dir = buy ? (type === "call" ? "arriba" : "abajo") : sell ? (type === "call" ? "abajo" : "arriba") : null;
    out.push({
      id: u.id, time, strike: o.strike, type, premium: u.premium, size: u.size, price: u.price,
      side: u.side, sentiment: u.sentiment, score: u.score, priority: u.market_alert_priority, dir, symbol: u.symbol,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}
