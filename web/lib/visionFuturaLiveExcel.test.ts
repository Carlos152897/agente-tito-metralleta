import { describe, expect, it } from "vitest";
import { liveEntries, motorStats } from "./visionFuturaLiveExcel";
import type { BacktestDay } from "./visionFuturaBacktest";

const trade = (points: number, at: number) => ({ entryAt: at, title: "t", side: "largo", level: 1, sources: "", entry: 100, stop: 95, target: 110, exit: 100 + points, exitAt: at + 60_000, outcome: points > 0 ? "objetivo" : "stop", points });

const day = {
  date: "2026-11-03",
  instrument: "NQ",
  trades: [],
  live: {
    trades: [trade(10, 2), trade(-5, 1)],
    money: [{ openedAt: 3, side: "corto", direction: "bajista", targetLabel: "x", stopLabel: "y", rb: 2, entry: 1, stop: 2, target: 0, exit: null, exitAt: null, outcome: null, points: null }],
    lottos: [{ openedAt: 4, side: "call", strike: 5, price: 0.5, lectura: "L1", target: { label: "m", spx: 6 }, settle: 0, pnlUsd: -50 }],
    coverage: { minutesWatched: 390 },
  },
  hybrid: { live: { alerts: [{ at: 5, side: "largo", title: "h", entry: 1, stop: 0, target: 3, exit: 3, exitAt: 6, outcome: "objetivo", points: 2, source: "alerta", note: "" }], money: [] } },
} as unknown as BacktestDay;

describe("entradas en vivo en el Excel", () => {
  it("junta los cuatro motores en orden de hora", () => {
    const e = liveEntries([day]);
    expect(e.map((x) => x.motor)).toEqual(["Alertas", "Alertas", "Señal del dinero", "Lottos", "Híbrido"]);
    expect(e[0].points).toBe(-5);
  });

  it("cuenta ganadas, perdidas, abiertas y $ con el multiplicador del instrumento", () => {
    const e = liveEntries([day]);
    const al = motorStats(e.filter((x) => x.motor === "Alertas"), () => 20);
    expect(al).toMatchObject({ entries: 2, wins: 1, losses: 1, open: 0, points: 5, usd: 100 });
    expect(motorStats(e.filter((x) => x.motor === "Señal del dinero"), () => 20)).toMatchObject({ open: 1, wins: 0, losses: 0 });
    expect(motorStats(e.filter((x) => x.motor === "Lottos"), () => 20)).toMatchObject({ losses: 1, usd: -50 });
  });
});
