import { describe, expect, it } from "vitest";
import { closeAtr, simulateDay } from "./visionFuturaBacktest";
import type { ReplayAlert } from "./visionFuturaReplay";

const lv = (spx: number) => ({ spx, spy: spx / 10, es: null });
const T0 = 1_800_000_000; // segundos

function alert(side: "largo" | "corto", entry: number, stop: number, target: number, atSec: number): ReplayAlert {
  return {
    id: `x:${entry}`, kind: side === "largo" ? "defensa_piso" : "rechazo_techo", direction: side === "largo" ? "alcista" : "bajista",
    title: "test", level: lv(entry), levelSources: ["Piso"], price: lv(entry), conditions: [], score: 4, fires: true,
    blocked: null, trap: null, target: { ...lv(target), label: "Scalp" }, regimeNote: null,
    order: { side, instrumento: "", entry: lv(entry), stop: lv(stop), target: lv(target), rb: 1, riskPts: 3, rewardPts: 3 },
    firedAt: atSec * 1000, lastSeenAt: atSec * 1000,
  };
}
const series = (vals: number[]) => vals.map((v, i) => ({ time: T0 + i * 300, value: v }));

describe("simulateDay", () => {
  it("largo que toca el objetivo", () => {
    const d = simulateDay({ date: "2026-10-22", alerts: [alert("largo", 100, 97, 103, T0)], priceSeries: series([100, 101, 104, 90]) });
    expect(d.trades[0].outcome).toBe("objetivo");
    expect(d.trades[0].points).toBe(3);
    expect(d.wins).toBe(1);
  });

  it("corto que toca el stop", () => {
    const d = simulateDay({ date: "2026-10-22", alerts: [alert("corto", 100, 103, 97, T0)], priceSeries: series([100, 104, 90]) });
    expect(d.trades[0].outcome).toBe("stop");
    expect(d.trades[0].points).toBe(-3);
    expect(d.losses).toBe(1);
  });

  it("sin tocar nada → cierra al último precio; ignora precios anteriores a la alerta", () => {
    const d = simulateDay({ date: "2026-10-22", alerts: [alert("largo", 100, 97, 103, T0 + 300)], priceSeries: series([200, 100, 101, 101.5]) });
    expect(d.trades[0].outcome).toBe("cierre");
    expect(d.trades[0].points).toBe(1.5);
    expect(d.points).toBe(1.5);
  });

  it("compara stops: fijo = el del motor, ATR y nivel + ½ ATR con objetivo 1:1", () => {
    // velas previas cambian 2 pts cada una → ATR = 2
    const a = alert("largo", 100, 97, 103, T0 + 3 * 300);
    a.level = lv(99);
    const d = simulateDay({ date: "2026-10-22", alerts: [a], priceSeries: series([94, 96, 98, 100, 101.5, 102.5, 90]) });
    const v = Object.fromEntries(d.trades[0].stopVariants!.map((x) => [x.id, x]));
    expect(v.fijo).toMatchObject({ risk: 3, outcome: "stop", points: -3 });
    expect(v.atr).toMatchObject({ risk: 2, outcome: "objetivo", points: 2 });
    expect(v.nivel).toMatchObject({ risk: 2, outcome: "objetivo", points: 2 }); // |100−99| + 1
    const row = d.stopCompare!.find((r) => r.id === "atr")!;
    expect(row).toMatchObject({ trades: 1, wins: 1, losses: 0, points: 2, avgRisk: 2 });
  });

  it("closeAtr usa solo velas hasta la entrada", () => {
    expect(closeAtr(series([10, 12, 11, 50]), (T0 + 600) * 1000)).toBe(1.5);
    expect(closeAtr(series([10]), T0 * 1000)).toBeNull();
  });
});
