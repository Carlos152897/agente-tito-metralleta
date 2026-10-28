// Alertas EN VIVO de VisionFutura dentro del backtest (Carlos, 27-oct-2026: "guardar también
// las alertas en vivo con su resultado y dejar la página abierta todo el día, hagamos eso").
//
// La repetición (visionFuturaReplay.ts) solo ve el precio cada 5 min y reconstruye los niveles de
// dealers, así que no saca las mismas entradas que la pantalla. Este módulo PURO toma lo que de
// verdad se disparó en vivo ese día (data/vision-futura/alert-state*.json) y lo califica con las
// velas reales de 1 minuto de tastytrade (máximo y mínimo de cada vela):
//   - Se empieza en la vela SIGUIENTE a la del disparo (la vela del disparo incluye precio de antes).
//   - Si en una misma vela caben stop y objetivo, cuenta el stop (igual que el backtest).
//   - Si nunca toca ninguno, sale al cierre de la última vela.
// Señal del dinero y lottos ya se resolvieron en vivo (cada ~30 s); las que quedaron abiertas se
// cierran aquí con el último precio del día.

import type { BacktestTrade } from "./visionFuturaBacktest";
import type { MoneyTrade } from "./visionFuturaMoneyFlow";
import { settleLottoWithRule, type LottoTrade } from "./visionFuturaLottos";
import type { VisionAlert } from "./visionFuturaAlerts";

export interface LiveCandle {
  /** Segundos (inicio de la vela de 1 min). */
  time: number;
  high: number;
  low: number;
  close: number;
}

export interface LiveFired extends VisionAlert {
  firedAt: number;
  lastSeenAt: number;
}

export interface LiveCoverage {
  /** Primer y último ciclo en vivo con el mercado abierto (ms) y cuántos ciclos hubo. */
  first: number | null;
  last: number | null;
  cycles: number;
  /** Minutos de la sesión (9:30–16:00 = 390) que se vigilaron en vivo, contando huecos de > 3 min como no vigilados. */
  minutesWatched: number;
}

export interface LiveDay {
  coverage: LiveCoverage;
  /** "velas 1 min" o "precio 5 min" (si tastytrade no dio velas). */
  priceSource: string;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  points: number;
  money: MoneyTrade[];
  lottos: LottoTrade[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Primera salida con velas de 1 min (máx/mín). Misma vela con stop y objetivo → stop. */
export function exitWithCandles(candles: LiveCandle[], firedAt: number, side: "largo" | "corto", entry: number, stop: number, target: number | null) {
  const nextBar = Math.floor(firedAt / 60_000) * 60_000 + 60_000;
  const after = candles.filter((c) => c.time * 1000 >= nextBar);
  for (const c of after) {
    const hitStop = side === "corto" ? c.high >= stop : c.low <= stop;
    const hitTarget = target != null && (side === "corto" ? c.low <= target : c.high >= target);
    if (hitStop) return { exit: stop, exitAt: c.time * 1000, outcome: "stop" as const, points: round2(side === "corto" ? entry - stop : stop - entry) };
    if (hitTarget) return { exit: target!, exitAt: c.time * 1000, outcome: "objetivo" as const, points: round2(side === "corto" ? entry - target! : target! - entry) };
  }
  const last = candles.at(-1);
  const exit = last?.close ?? entry;
  return { exit: round2(exit), exitAt: (last?.time ?? firedAt / 1000) * 1000, outcome: "cierre" as const, points: round2(side === "corto" ? entry - exit : exit - entry) };
}

/** Minutos vigilados: suma de los tramos entre ciclos seguidos separados por ≤ 3 min. */
export function minutesWatched(cycleTimes: number[]): number {
  const ts = [...cycleTimes].sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap <= 3 * 60_000) ms += gap;
  }
  return Math.round(ms / 60_000);
}

export function scoreLiveDay(input: {
  date: string;
  fired: LiveFired[];
  candles: LiveCandle[];
  /** Respaldo si no hubo velas: precio de 5 min de la repetición. */
  fallbackPrices?: { time: number; value: number }[];
  money?: MoneyTrade[];
  lottos?: LottoTrade[];
  coverage: LiveCoverage;
}): LiveDay {
  const candles: LiveCandle[] = input.candles.length > 0
    ? [...input.candles].sort((a, b) => a.time - b.time)
    : (input.fallbackPrices ?? []).map((p) => ({ time: p.time, high: p.value, low: p.value, close: p.value }));
  const priceSource = input.candles.length > 0 ? "velas 1 min (tastytrade)" : "precio 5 min (sin velas de 1 min)";
  const lastClose = candles.at(-1)?.close ?? null;

  const trades: BacktestTrade[] = [...input.fired]
    .filter((a) => a.order)
    .sort((a, b) => a.firedAt - b.firedAt)
    .map((a) => {
      const o = a.order;
      const entry = o.entry.spx;
      const stop = o.stop.spx;
      const target = o.target?.spx ?? null;
      const r = exitWithCandles(candles, a.firedAt, o.side, entry, stop, target);
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
        exit: round2(r.exit),
        exitAt: r.exitAt,
        outcome: r.outcome,
        points: r.points,
      };
    });

  // Las que quedaron abiertas (el vivo dejó de correr) se terminan con las velas: stop/objetivo o cierre.
  // "cierre" también se revisa: si un ciclo corrió después de las 16:00 sin vigilar la tarde, la
  // cerró al último precio aunque en el camino haya tocado su stop u objetivo.
  const money = (input.money ?? []).map((tr) => {
    if ((tr.outcome != null && tr.outcome !== "cierre") || candles.length === 0) return tr;
    const r = exitWithCandles(candles, tr.openedAt, tr.side, tr.entry, tr.stop, tr.target);
    return { ...tr, outcome: r.outcome, exit: r.exit, exitAt: r.exitAt, points: r.points };
  });

  const lottos = (input.lottos ?? []).map((tr) => {
    if (tr.settle != null || lastClose == null) return tr.settle != null ? settleLottoWithRule(tr, tr.exits ?? []) : tr;
    return settleLottoWithRule({ ...tr, settle: lastClose }, tr.exits ?? []);
  });

  return {
    coverage: input.coverage,
    priceSource,
    trades,
    wins: trades.filter((t) => t.points > 0).length,
    losses: trades.filter((t) => t.points < 0).length,
    points: round2(trades.reduce((s, t) => s + t.points, 0)),
    money,
    lottos,
  };
}
