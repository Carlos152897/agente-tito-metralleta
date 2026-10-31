import { describe, expect, it } from "vitest";
import { flowMagnetHistory, flowMagnetsAt, fmtFuerza } from "./visionFuturaFlowMagnets";
import type { StrikeMinute } from "./visionFuturaVolumeDelta";

const m = (t: number, cA = 0, cB = 0, pA = 0, pB = 0): StrikeMinute => ({ t, cA, cB, cV: cA + cB, pA, pB, pV: pA + pB });

describe("flowMagnetsAt", () => {
  it("Imán + = más compra de calls + venta de puts; Imán − = lo contrario", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 1000, 0, 0, 1600)]], // +2,600
      [7555, [m(0, 0, 300, 291, 0)]], // −591
      [7560, [m(0, 100, 0, 0, 0)]], // +100
    ]);
    const r = flowMagnetsAt(by, 60, 7571);
    expect(r.pos).toEqual({ strike: 7550, fuerza: 2600 });
    expect(r.neg).toEqual({ strike: 7555, fuerza: 591 });
  });
  it("solo la ventana de 15 min y solo ±70 pts", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 5000), m(1200, 30)]], // los 5,000 quedaron fuera de la ventana a las 1,260
      [7700, [m(1200, 9000)]], // fuera del radio
    ]);
    const r = flowMagnetsAt(by, 1260, 7571);
    expect(r.pos).toEqual({ strike: 7550, fuerza: 30 });
    expect(r.neg).toBeNull();
  });
  it("nada si no llega al mínimo de contratos", () => {
    const by = new Map<number, StrikeMinute[]>([[7550, [m(0, 10)]]]);
    expect(flowMagnetsAt(by, 60, 7550).pos).toBeNull();
  });
});

describe("flowMagnetHistory", () => {
  it("tramos seguidos por strike, igual que calcular minuto a minuto", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 100), m(60, 100)]],
      [7560, [m(120, 500)]],
    ]);
    const segs = flowMagnetHistory(by, 0, 240, () => 7555, { windowSec: 120 });
    expect(segs.filter((s) => s.kind === "pos").map((s) => [s.strike, s.start, s.end, s.fuerza])).toEqual([
      [7550, 60, 120, 200],
      [7560, 180, 240, 500],
    ]);
    // mismo resultado que flowMagnetsAt en cada minuto
    for (const t of [60, 120, 180, 240]) {
      const seg = segs.find((s) => s.kind === "pos" && s.start <= t && s.end >= t);
      expect(seg?.strike).toBe(flowMagnetsAt(by, t, 7555, { windowSec: 120 }).pos?.strike);
    }
  });
  it("formato de fuerza", () => {
    expect(fmtFuerza(2600)).toBe("2.6K");
    expect(fmtFuerza(591)).toBe("591");
  });
});
