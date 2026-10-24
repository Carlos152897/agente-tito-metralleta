import { describe, expect, it } from "vitest";
import { readMoney, simulateMoneyTrade, type MoneyRow, type MoneyTrade } from "./visionFuturaMoneyFlow";
import type { KeyLevel } from "./visionFutura";

const lv = (kind: KeyLevel["kind"], spx: number, label: string): KeyLevel => ({ kind, label, fuente: "", distance: 0, spx, spy: null, es: null });
const row = (spx: number, callFlow: number, putFlow: number): MoneyRow => ({ spx, callFlow, putFlow });

// Precio 7631, Magneto abajo, puts comprados abajo y creciendo → corto.
const levels = [lv("magneto", 7600, "Magneto"), lv("piso", 7620, "Piso"), lv("resistencia", 7636, "Resistencia")];
const before = [row(7620, 0, 1e6), row(7650, -0.2e6, 0.5e6), row(7600, 0.2e6, 0)];
const after = [row(7620, 0, 2.6e6), row(7650, -0.4e6, 1.2e6), row(7600, 0.2e6, 0)];

describe("readMoney", () => {
  it("todos los votos abajo → CORTO: objetivo = nivel más cercano a ≥ 8 pts, stop detrás del techo + 2", () => {
    const r = readMoney({ spot: 7631, keyLevels: levels, rows: after, rows15: before });
    expect(r.votes.map((v) => v.vote)).toEqual([-1, -1, -1, -1]);
    expect(r.lean).toBe("bajista");
    expect(r.signal).toMatchObject({ side: "corto", target: 7620, targetLabel: "Piso", stop: 7638, riskPts: 7, rewardPts: 11 });
    expect(r.signal!.rb).toBe(1.57);
  });

  it("R:B bajo → no hay señal", () => {
    const r = readMoney({ spot: 7631, keyLevels: [...levels.slice(0, 2), lv("resistencia", 7640, "Resistencia")], rows: after, rows15: before });
    expect(r.signal).toBeNull();
    expect(r.blocked).toMatch(/R:B/);
  });

  it("sin dinero nuevo con dirección (o sin historial) → no hay señal aunque lo demás apunte", () => {
    expect(readMoney({ spot: 7631, keyLevels: levels, rows: after, rows15: after }).blocked).toBe("el dinero nuevo no tiene dirección");
    expect(readMoney({ spot: 7631, keyLevels: levels, rows: after, rows15: null }).signal).toBeNull();
  });

  it("el dinero nuevo manda: si entra verde pero los demás votan abajo → no hay señal", () => {
    const greenNew = [row(7620, 1.5e6, 1e6), row(7650, -0.2e6, 0.5e6), row(7600, 0.2e6, 0)];
    const r = readMoney({ spot: 7631, keyLevels: levels, rows: greenNew, rows15: before });
    expect(r.votes[2].vote).toBe(1);
    expect(r.signal).toBeNull();
  });
});

describe("simulateMoneyTrade", () => {
  const base: MoneyTrade = { side: "corto", direction: "bajista", entry: 7631, stop: 7638, target: 7620, targetLabel: "Piso", stopLabel: "", riskPts: 7, rewardPts: 11, rb: 1.57,
    id: "x", openedAt: 0, votes: [], exit: null, exitAt: null, outcome: null, points: null };
  it("objetivo, stop y cierre", () => {
    expect(simulateMoneyTrade(base, [{ t: 1, v: 7628 }, { t: 2, v: 7619 }])).toMatchObject({ outcome: "objetivo", points: 11 });
    expect(simulateMoneyTrade(base, [{ t: 1, v: 7639 }])).toMatchObject({ outcome: "stop", points: -7 });
    expect(simulateMoneyTrade(base, [{ t: 1, v: 7627 }])).toMatchObject({ outcome: "cierre", points: 4 });
  });
});
