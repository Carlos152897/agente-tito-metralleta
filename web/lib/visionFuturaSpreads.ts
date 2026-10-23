// Sección "Spreads" de VisionFutura (Carlos, oct 2026): "dame contratos de
// spreads — call credit, put credit, call debit, todo — con el contrato exacto
// (ej. call bid 7795 / call ask 7800)". PURO: las cotizaciones (tastytrade, en
// vivo) llegan ya cargadas desde visionFuturaData.ts. Vencimiento = el que
// muestra la pestaña (0DTE en horario).
//
//   Call credit (bear call): VENDER call K al bid + COMPRAR call K+ancho al ask.
//   Put credit  (bull put):  VENDER put K al bid  + COMPRAR put K−ancho al ask.
//   Call debit:  COMPRAR call cerca del precio al ask + VENDER call en un nivel de arriba al bid.
//   Put debit:   COMPRAR put cerca del precio al ask  + VENDER put en un nivel de abajo al bid.
//   Iron condor: el mejor call credit + el mejor put credit del mismo ancho.
//
// Reglas:
//   1. Siempre el llenado malo: lo que se vende al BID, lo que se compra al ASK.
//   2. Probabilidad de ganar medida en el BREAKEVEN con la IV de la pata de
//      referencia (corta en crédito, larga en débito) — lognormal sin deriva.
//   3. Crédito: el strike vendido tiene que quedar MÁS ALLÁ de un nivel de
//      VisionFutura (techo/Call Wall/resistencia arriba; piso/Put Wall abajo).
//   4. Débito: el strike vendido ES un nivel de VisionFutura (el objetivo:
//      Magneto, resistencia/piso, imán, dealers) y la relación ganancia/costo ≥ 1.

import { probAbove } from "./expectedMove";
import type { DealerLevel, ExpectedMove, KeyLevel } from "./visionFutura";

export interface SpreadQuoteRow {
  type: "call" | "put";
  strike: number;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  iv: number | null;
  openInterest: number;
  volume: number;
}

export interface SpreadLeg {
  action: "VENDER" | "COMPRAR";
  type: "call" | "put";
  strike: number;
  /** Precio usado: bid si se vende, ask si se compra. */
  price: number;
  side: "bid" | "ask";
}

export type SpreadStructure = "call_credit" | "put_credit" | "call_debit" | "put_debit" | "iron_condor";

export interface SpreadIdea {
  id: string;
  structure: SpreadStructure;
  title: string;
  legs: SpreadLeg[];
  width: number;
  /** + = crédito cobrado, − = débito pagado (por acción; ×100 = $ por spread). */
  netPrice: number;
  /** Ganancia máxima en $ por spread. */
  maxGainUsd: number;
  /** Pérdida máxima en $ por spread. */
  maxLossUsd: number;
  breakevens: number[];
  /** Probabilidad de terminar con ganancia. */
  pop: number;
  /** Ganancia máxima / pérdida máxima. */
  rr: number;
  /** Delta de la pata de referencia (vendida en crédito, comprada en débito). */
  refDelta: number | null;
  /** Por qué ese strike: niveles que protegen (crédito) u objetivo (débito). */
  levels: string[];
  outsideVixRange: boolean;
  /** Débito: apunta hacia donde está el sesgo del día (Magneto). */
  withBias: boolean;
}

export const SPREAD_TUNING = {
  widths: [5, 10],
  /** Crédito: probabilidad mínima de ganar (en el breakeven). */
  minPopCredit: 0.8,
  /** Crédito: |delta| máximo de la pata vendida. */
  maxShortDelta: 0.2,
  /** Crédito: mínimo por acción ($0.20 = $20 por spread). */
  minCredit: 0.2,
  /** Crédito: distancia mínima del strike vendido al precio (pts SPX). */
  minDistance: 5,
  /** Débito: ganancia máxima / costo mínimo. */
  minDebitRr: 1,
  /**
   * Débito: pérdida máxima por spread en $ (= lo que se paga × 100). Pedido de
   * Carlos (oct 2026): "spreads direccionales con pérdida máxima de solo $200".
   */
  maxDebitLossUsd: 200,
  /** Débito: ancho mínimo entre la pata comprada y el objetivo (pts). */
  minDebitWidth: 5,
  /** Débito: el objetivo (strike vendido) entre estas distancias del precio. */
  debitTargetMin: 5,
  debitTargetMax: 40,
  perSide: 3,
};

export interface SpreadsInput {
  rows: SpreadQuoteRow[];
  spot: number;
  /** Días (fracción) hasta el vencimiento. */
  days: number;
  keyLevels: KeyLevel[];
  dealerLevels: DealerLevel[];
  expectedMove: ExpectedMove | null;
  /** IV de respaldo si la pata no trae la suya (ej. VIX/100). */
  fallbackIv: number;
}

export interface SpreadsReport {
  /** Sesgo del día según el Magneto: alcista si está arriba del precio, bajista si abajo. */
  bias: "alcista" | "bajista" | "neutral";
  callCredit: SpreadIdea[];
  putCredit: SpreadIdea[];
  callDebit: SpreadIdea[];
  putDebit: SpreadIdea[];
  ironCondor: SpreadIdea | null;
  note: string | null;
}

const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildSpreads(input: SpreadsInput): SpreadsReport {
  const T = SPREAD_TUNING;
  const { rows, spot, days, keyLevels, dealerLevels, expectedMove, fallbackIv } = input;
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.strike}`, r]));
  const ivOf = (r: SpreadQuoteRow) => (r.iv && r.iv > 0 ? r.iv : fallbackIv);
  const pAbove = (price: number, r: SpreadQuoteRow) => probAbove(spot, price, ivOf(r), days);

  const magnet = keyLevels.find((k) => k.kind === "magneto")?.spx ?? null;
  const bias: SpreadsReport["bias"] = magnet == null || Math.abs(magnet - spot) < 3 ? "neutral" : magnet > spot ? "alcista" : "bajista";

  const ceilings = [
    ...keyLevels.filter((k) => k.kind === "resistencia" || k.kind === "iman_positivo" || k.kind === "magneto").map((k) => ({ spx: k.spx, label: k.label })),
    ...dealerLevels.filter((d) => d.role === "resistencia").map((d) => ({ spx: d.spx, label: "Dealers: techo" })),
  ].filter((l) => l.spx > spot);
  const floors = [
    ...keyLevels.filter((k) => k.kind === "piso" || k.kind === "iman_negativo" || k.kind === "magneto").map((k) => ({ spx: k.spx, label: k.label })),
    ...dealerLevels.filter((d) => d.role === "piso").map((d) => ({ spx: d.spx, label: "Dealers: piso" })),
  ].filter((l) => l.spx < spot);

  const pickTop = (list: SpreadIdea[], key: (i: SpreadIdea) => number) => {
    const seen = new Set<number>();
    const out: SpreadIdea[] = [];
    for (const i of [...list].sort((a, b) => b.pop - a.pop || key(b) - key(a))) {
      const k = key(i);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(i);
      if (out.length >= T.perSide) break;
    }
    return out;
  };

  // ── Crédito ──
  const credit = (type: "call" | "put"): SpreadIdea[] => {
    const pool = type === "call" ? ceilings : floors;
    if (pool.length === 0) return [];
    const out: SpreadIdea[] = [];
    for (const short of rows.filter((r) => r.type === type)) {
      const K = short.strike;
      const distance = type === "call" ? K - spot : spot - K;
      if (distance < T.minDistance || short.bid == null || short.bid <= 0) continue;
      if (short.delta != null && Math.abs(short.delta) > T.maxShortDelta) continue;
      const protectors = pool
        .filter((l) => (type === "call" ? l.spx <= K : l.spx >= K))
        .sort((a, b) => (type === "call" ? a.spx - b.spx : b.spx - a.spx))
        .map((l) => `${l.label} ${fmt0(l.spx)}`);
      if (protectors.length === 0) continue;
      for (const width of T.widths) {
        const longK = type === "call" ? K + width : K - width;
        const long = byKey.get(`${type}:${longK}`);
        if (!long || long.ask == null || long.ask <= 0) continue;
        const net = r2(short.bid - long.ask);
        if (net < T.minCredit || net >= width) continue;
        const be = type === "call" ? K + net : K - net;
        const pop = type === "call" ? 1 - pAbove(be, short) : pAbove(be, short);
        if (pop < T.minPopCredit) continue;
        out.push({
          id: `${type}_credit:${K}:${width}`,
          structure: type === "call" ? "call_credit" : "put_credit",
          title: `${type === "call" ? "Call" : "Put"} credit ${fmt0(K)}/${fmt0(longK)}`,
          legs: [
            { action: "VENDER", type, strike: K, price: short.bid, side: "bid" },
            { action: "COMPRAR", type, strike: longK, price: long.ask, side: "ask" },
          ],
          width, netPrice: net,
          maxGainUsd: Math.round(net * 100), maxLossUsd: Math.round((width - net) * 100),
          breakevens: [r2(be)], pop, rr: net / (width - net), refDelta: short.delta,
          levels: protectors,
          outsideVixRange: expectedMove ? (type === "call" ? K >= expectedMove.high.spx : K <= expectedMove.low.spx) : false,
          withBias: false,
        });
      }
    }
    return pickTop(out, (i) => i.legs[0].strike);
  };

  // ── Débito: comprar cerca del precio, vender en un nivel (el objetivo) ──
  const debit = (type: "call" | "put"): SpreadIdea[] => {
    const targets = (type === "call" ? ceilings : floors)
      .filter((l) => {
        const d = Math.abs(l.spx - spot);
        return d >= T.debitTargetMin && d <= T.debitTargetMax;
      });
    if (targets.length === 0) return [];
    // Pata comprada: cualquier strike entre el precio (ATM) y el objetivo, para
    // que el costo pueda quedar dentro de `maxDebitLossUsd` (los ATM con objetivo
    // lejano cuestan $600+; acercar la compra al objetivo baja el costo).
    const longs = rows
      .filter((r) => r.type === type && (type === "call" ? r.strike >= spot - 5 : r.strike <= spot + 5) && r.ask != null && r.ask > 0);
    const maxCost = T.maxDebitLossUsd / 100;
    const out: SpreadIdea[] = [];
    for (const long of longs) {
      for (const t of targets) {
        const short = byKey.get(`${type}:${t.spx}`);
        if (!short || short.bid == null || short.bid <= 0) continue;
        const width = Math.abs(t.spx - long.strike);
        if (width < T.minDebitWidth || (type === "call" ? t.spx <= long.strike : t.spx >= long.strike)) continue;
        const cost = r2(long.ask! - short.bid);
        if (cost <= 0 || cost >= width || cost > maxCost) continue;
        const gain = width - cost;
        const rr = gain / cost;
        if (rr < T.minDebitRr) continue;
        const be = type === "call" ? long.strike + cost : long.strike - cost;
        const pop = type === "call" ? pAbove(be, long) : 1 - pAbove(be, long);
        out.push({
          id: `${type}_debit:${long.strike}:${t.spx}`,
          structure: type === "call" ? "call_debit" : "put_debit",
          title: `${type === "call" ? "Call" : "Put"} debit ${fmt0(long.strike)}/${fmt0(t.spx)}`,
          legs: [
            { action: "COMPRAR", type, strike: long.strike, price: long.ask!, side: "ask" },
            { action: "VENDER", type, strike: t.spx, price: short.bid, side: "bid" },
          ],
          width, netPrice: -cost,
          maxGainUsd: Math.round(gain * 100), maxLossUsd: Math.round(cost * 100),
          breakevens: [r2(be)], pop, rr, refDelta: long.delta,
          levels: [`Objetivo: ${t.label} ${fmt0(t.spx)}`],
          outsideVixRange: false,
          withBias: (type === "call" && bias === "alcista") || (type === "put" && bias === "bajista"),
        });
      }
    }
    // En débito importa la relación ganancia/costo: se ordena por valor esperado aproximado.
    const ev = (i: SpreadIdea) => i.pop * i.maxGainUsd - (1 - i.pop) * i.maxLossUsd;
    const seen = new Set<string>();
    return [...out].sort((a, b) => ev(b) - ev(a)).filter((i) => {
      const k = `${i.legs[1].strike}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, T.perSide);
  };

  const callCredit = credit("call");
  const putCredit = credit("put");
  const callDebit = debit("call");
  const putDebit = debit("put");

  // ── Iron condor: el mejor call credit + el mejor put credit del mismo ancho ──
  let ironCondor: SpreadIdea | null = null;
  for (const c of callCredit) {
    const p = putCredit.find((x) => x.width === c.width);
    if (!p) continue;
    const net = r2(c.netPrice + p.netPrice);
    const beUp = c.legs[0].strike + net;
    const beDown = p.legs[0].strike - net;
    const shortCall = byKey.get(`call:${c.legs[0].strike}`)!;
    const shortPut = byKey.get(`put:${p.legs[0].strike}`)!;
    const pop = Math.max(0, pAbove(beDown, shortPut) - pAbove(beUp, shortCall));
    ironCondor = {
      id: `iron_condor:${p.legs[0].strike}:${c.legs[0].strike}:${c.width}`,
      structure: "iron_condor",
      title: `Iron condor ${fmt0(p.legs[1].strike)}/${fmt0(p.legs[0].strike)} — ${fmt0(c.legs[0].strike)}/${fmt0(c.legs[1].strike)}`,
      legs: [...p.legs, ...c.legs],
      width: c.width, netPrice: net,
      maxGainUsd: Math.round(net * 100), maxLossUsd: Math.round((c.width - net) * 100),
      breakevens: [r2(beDown), r2(beUp)], pop, rr: net / (c.width - net), refDelta: null,
      levels: [...p.levels.slice(0, 1), ...c.levels.slice(0, 1)],
      outsideVixRange: c.outsideVixRange && p.outsideVixRange,
      withBias: bias === "neutral",
    };
    break;
  }

  const total = callCredit.length + putCredit.length + callDebit.length + putDebit.length;
  return {
    bias, callCredit, putCredit, callDebit, putDebit, ironCondor,
    note: total === 0 ? "Ningún spread pasa los filtros ahora mismo." : null,
  };
}

/**
 * Resultado de un spread al vencimiento, por acción (×100 = $ por spread):
 * lo cobrado/pagado al abrir (`netPrice`: + crédito, − débito) más el valor
 * intrínseco de cada pata a `settle` (compradas suman, vendidas restan).
 */
export function spreadPnlAtExpiry(idea: Pick<SpreadIdea, "netPrice" | "legs">, settle: number): number {
  let value = 0;
  for (const l of idea.legs) {
    const intrinsic = l.type === "call" ? Math.max(0, settle - l.strike) : Math.max(0, l.strike - settle);
    value += l.action === "COMPRAR" ? intrinsic : -intrinsic;
  }
  return Math.round((idea.netPrice + value) * 100) / 100;
}

/**
 * Los spreads que "ejecuta" una alerta de VisionFutura (backtest/repetición):
 *   - alcista (defensa de piso / ruptura de techo): put credit protegido por ESE
 *     nivel (o el mejor put credit si ninguno lo nombra) + el mejor call debit.
 *   - bajista (rechazo en techo / ruptura de piso): call credit protegido por
 *     ESE nivel + el mejor put debit.
 */
export function spreadsForAlert(
  report: SpreadsReport,
  alert: { direction: "alcista" | "bajista"; level: { spx: number } },
): { credit: SpreadIdea | null; debit: SpreadIdea | null } {
  const levelTxt = Math.round(alert.level.spx).toLocaleString("en-US");
  const credits = alert.direction === "alcista" ? report.putCredit : report.callCredit;
  const debits = alert.direction === "alcista" ? report.callDebit : report.putDebit;
  const credit = credits.find((c) => c.levels.some((l) => l.endsWith(` ${levelTxt}`))) ?? credits[0] ?? null;
  return { credit, debit: debits[0] ?? null };
}
