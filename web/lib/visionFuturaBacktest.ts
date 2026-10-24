// Backtest diario de VisionFutura (Carlos, oct 2026: "guárdame el backtest de
// todas las entradas en una hoja de Excel, por día — voy a hacer backtesting
// todos los días"). PURO: toma la repetición de un día (visionFuturaReplay.ts,
// mismo motor de alertas que la pantalla) y simula cada orden sobre el precio
// real de 5 min que vino DESPUÉS de la alerta: la primera de stop u objetivo
// que se toque cierra la operación; si no, se cierra al último precio del día.
//
// Limitación declarada: con precio cada 5 min no se sabe cuál se tocó primero
// dentro de un mismo intervalo, y stop/objetivo se llenan al precio exacto
// (sin deslizamiento ni comisiones). Son puntos del subyacente, no P&L de opciones.

import type { LottoTrade } from "./visionFuturaLottos";
import type { ReplayAlert, ReplaySpreadTrade } from "./visionFuturaReplay";

export interface BacktestTrade {
  date: string;
  /** Hora de la alerta (ms). */
  entryAt: number;
  title: string;
  kind: string;
  side: "largo" | "corto";
  level: number;
  sources: string;
  score: number;
  conditions: string;
  trap: string | null;
  regimeNote: string | null;
  entry: number;
  entrySpy: number | null;
  stop: number;
  target: number | null;
  exit: number;
  exitAt: number;
  outcome: "objetivo" | "stop" | "cierre";
  points: number;
  /** La misma entrada simulada con otros stops (solo registro, el motor no cambia). */
  stopVariants?: StopVariantResult[];
}

/**
 * Comparación de stops (Carlos, 23-oct-2026: "para el NQ un stop más dinámico"). Se registran
 * en paralelo para decidir con ~2 semanas de datos, sin cambiar el stop del motor:
 *   - fijo:  el del motor (scalp 3 pts SPX, escalado por instrumento).
 *   - atr:   riesgo = ATR (promedio del |cambio| de 5 min de las últimas 12 velas antes de la entrada).
 *   - nivel: riesgo = distancia de la entrada al nivel + ½ ATR (stop detrás del nivel con colchón).
 * En los tres el objetivo está a la misma distancia que el stop (1:1).
 */
export type StopVariantId = "fijo" | "atr" | "nivel";
export const STOP_VARIANTS: { id: StopVariantId; label: string }[] = [
  { id: "fijo", label: "Fijo (actual)" },
  { id: "atr", label: "ATR × 1" },
  { id: "nivel", label: "Nivel + ½ ATR" },
];
export const STOP_ATR_BARS = 12;

export interface StopVariantResult {
  id: StopVariantId;
  /** Distancia del stop (= del objetivo) desde la entrada, en puntos del instrumento. */
  risk: number;
  outcome: "objetivo" | "stop" | "cierre";
  points: number;
}

export interface StopCompareRow {
  id: StopVariantId;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  points: number;
  avgRisk: number;
}

export interface BacktestSpread {
  openedAt: number;
  alertTitle: string;
  kind: "credito" | "debito";
  title: string;
  legs: string;
  priceSource: string;
  netPrice: number;
  maxGainUsd: number;
  maxLossUsd: number;
  pop: number;
  spotAtOpen: number;
  settle: number | null;
  pnl: number | null;
}

export interface BacktestDay {
  date: string;
  /** SPX (por defecto), NQ o TSLA. */
  instrument?: string;
  builtAt: string;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  points: number;
  /** Backtest de spreads del día (cada alerta ejecuta uno de prima y uno direccional). */
  spreads?: BacktestSpread[];
  /** Totales del día por tipo de stop (ver STOP_VARIANTS). */
  stopCompare?: StopCompareRow[];
  /** Lottos al cierre del día (lib/visionFuturaLottos.ts), ya liquidados. */
  lottos?: LottoTrade[];
}

/** Spreads ejecutados en la repetición → filas del backtest (solo los ya liquidados). */
export function spreadsForBacktest(trades: ReplaySpreadTrade[]): BacktestSpread[] {
  return trades
    .filter((t) => t.pnl != null)
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((t) => ({
      openedAt: t.openedAt,
      alertTitle: t.alertTitle,
      kind: t.kind,
      title: t.idea.title,
      legs: t.idea.legs.map((l) => `${l.action} ${l.type.toUpperCase()} ${l.strike} @${l.side} ${l.price.toFixed(2)}`).join(" / "),
      priceSource: t.legSources.every((s) => s === "real") ? "llenado real" : t.legSources.join(" / "),
      netPrice: t.idea.netPrice,
      maxGainUsd: t.idea.maxGainUsd,
      maxLossUsd: t.idea.maxLossUsd,
      pop: t.idea.pop,
      spotAtOpen: t.spotAtOpen,
      settle: t.settle,
      pnl: t.pnl,
    }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type Px = { time: number; value: number };

/** Primera salida (stop u objetivo) después de `fromMs`; si ninguna, al último precio. Mismo punto → stop. */
export function simulateExit(prices: Px[], fromMs: number, side: "largo" | "corto", entry: number, stop: number, target: number | null) {
  const last = prices.at(-1);
  let exit = last?.value ?? entry;
  let exitAt = (last?.time ?? fromMs / 1000) * 1000;
  let outcome: BacktestTrade["outcome"] = "cierre";
  for (const p of prices) {
    if (p.time * 1000 <= fromMs) continue;
    const hitStop = side === "corto" ? p.value >= stop : p.value <= stop;
    const hitTarget = target != null && (side === "corto" ? p.value <= target : p.value >= target);
    if (hitStop) { exit = stop; exitAt = p.time * 1000; outcome = "stop"; break; }
    if (hitTarget) { exit = target!; exitAt = p.time * 1000; outcome = "objetivo"; break; }
  }
  return { exit, exitAt, outcome, points: round2(side === "corto" ? entry - exit : exit - entry) };
}

/** ATR de cierre: promedio del |cambio| entre precios de 5 min de las últimas `bars` velas hasta `atMs` (incluida). */
export function closeAtr(prices: Px[], atMs: number, bars = STOP_ATR_BARS): number | null {
  const upTo = prices.filter((p) => p.time * 1000 <= atMs);
  const win = upTo.slice(-(bars + 1));
  if (win.length < 2) return null;
  let s = 0;
  for (let i = 1; i < win.length; i++) s += Math.abs(win[i].value - win[i - 1].value);
  return s / (win.length - 1);
}

function stopVariantsFor(prices: Px[], firedAt: number, side: "largo" | "corto", entry: number, level: number, fixedRisk: number, fixed: { outcome: BacktestTrade["outcome"]; points: number }): StopVariantResult[] {
  const atr = closeAtr(prices, firedAt) ?? fixedRisk;
  const dir = side === "corto" ? -1 : 1;
  const run = (id: StopVariantId, risk: number): StopVariantResult => {
    const r = simulateExit(prices, firedAt, side, entry, entry - dir * risk, entry + dir * risk);
    return { id, risk: round2(risk), outcome: r.outcome, points: r.points };
  };
  return [
    { id: "fijo", risk: round2(fixedRisk), outcome: fixed.outcome, points: fixed.points },
    run("atr", Math.max(atr, 0.01)),
    run("nivel", Math.abs(entry - level) + 0.5 * atr),
  ];
}

export function summarizeStops(trades: BacktestTrade[]): StopCompareRow[] {
  return STOP_VARIANTS.map(({ id, label }) => {
    const rs = trades.map((t) => t.stopVariants?.find((v) => v.id === id)).filter((v): v is StopVariantResult => !!v);
    return {
      id, label, trades: rs.length,
      wins: rs.filter((v) => v.points > 0).length,
      losses: rs.filter((v) => v.points < 0).length,
      points: round2(rs.reduce((a, v) => a + v.points, 0)),
      avgRisk: rs.length ? round2(rs.reduce((a, v) => a + v.risk, 0) / rs.length) : 0,
    };
  });
}

export function simulateDay(input: {
  date: string;
  alerts: ReplayAlert[];
  priceSeries: { time: number; value: number }[];
  builtAt?: string;
}): BacktestDay {
  const prices = [...input.priceSeries].sort((a, b) => a.time - b.time);
  const trades: BacktestTrade[] = [...input.alerts]
    .sort((a, b) => a.firedAt - b.firedAt)
    .map((a) => {
      const o = a.order;
      const entry = o.entry.spx;
      const stop = o.stop.spx;
      const target = o.target?.spx ?? null;
      const { exit, exitAt, outcome, points } = simulateExit(prices, a.firedAt, o.side, entry, stop, target);
      return {
        date: input.date,
        entryAt: a.firedAt,
        title: a.title,
        kind: a.kind,
        side: o.side,
        level: a.level.spx,
        sources: a.levelSources.join(", "),
        score: a.score,
        conditions: a.conditions.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`).join(" | "),
        trap: a.trap ?? null,
        regimeNote: a.regimeNote,
        entry,
        entrySpy: o.entry.spy,
        stop,
        target,
        exit: round2(exit),
        exitAt,
        outcome,
        points,
        stopVariants: stopVariantsFor(prices, a.firedAt, o.side, entry, a.level.spx, Math.abs(entry - stop), { outcome, points }),
      };
    });
  return {
    date: input.date,
    builtAt: input.builtAt ?? new Date().toISOString(),
    trades,
    wins: trades.filter((t) => t.points > 0).length,
    losses: trades.filter((t) => t.points < 0).length,
    points: round2(trades.reduce((s, t) => s + t.points, 0)),
    stopCompare: summarizeStops(trades),
  };
}
