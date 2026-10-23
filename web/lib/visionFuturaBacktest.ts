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

export function simulateDay(input: {
  date: string;
  alerts: ReplayAlert[];
  priceSeries: { time: number; value: number }[];
  builtAt?: string;
}): BacktestDay {
  const prices = [...input.priceSeries].sort((a, b) => a.time - b.time);
  const last = prices.at(-1);
  const trades: BacktestTrade[] = [...input.alerts]
    .sort((a, b) => a.firedAt - b.firedAt)
    .map((a) => {
      const o = a.order;
      const entry = o.entry.spx;
      const stop = o.stop.spx;
      const target = o.target?.spx ?? null;
      let exit = last?.value ?? entry;
      let exitAt = (last?.time ?? a.firedAt / 1000) * 1000;
      let outcome: BacktestTrade["outcome"] = "cierre";
      for (const p of prices) {
        if (p.time * 1000 <= a.firedAt) continue;
        const hitStop = o.side === "corto" ? p.value >= stop : p.value <= stop;
        const hitTarget = target != null && (o.side === "corto" ? p.value <= target : p.value >= target);
        // Si en el mismo punto se ven los dos, se cuenta el stop (lo conservador).
        if (hitStop) { exit = stop; exitAt = p.time * 1000; outcome = "stop"; break; }
        if (hitTarget) { exit = target!; exitAt = p.time * 1000; outcome = "objetivo"; break; }
      }
      const points = round2(o.side === "corto" ? entry - exit : exit - entry);
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
      };
    });
  return {
    date: input.date,
    builtAt: input.builtAt ?? new Date().toISOString(),
    trades,
    wins: trades.filter((t) => t.points > 0).length,
    losses: trades.filter((t) => t.points < 0).length,
    points: round2(trades.reduce((s, t) => s + t.points, 0)),
  };
}
