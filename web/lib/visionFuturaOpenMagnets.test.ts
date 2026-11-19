import { describe, expect, it } from "vitest";
import { openForce, openMagnets } from "./visionFuturaOpenMagnets";
import type { StrikeMinute } from "./visionFuturaVolumeDelta";

const m = (t: number, x: Partial<StrikeMinute>): StrikeMinute => ({ t, cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0, ...x });

describe("openForce", () => {
  it("sin OI de ayer todo cuenta como posición nueva", () => {
    expect(openForce({ cA: 100, cB: 20, cV: 120, pA: 0, pB: 0, pV: 0 }, undefined)).toBe(80);
  });
  it("lo que cabe dentro del OI de apertura no cuenta (pudo ser cierre)", () => {
    expect(openForce({ cA: 100, cB: 20, cV: 120, pA: 0, pB: 0, pV: 0 }, { call: 500, put: 0 })).toBe(0);
  });
  it("solo la parte que pasa del OI es nueva", () => {
    // volumen 200, OI 100 → la mitad es nueva; neto 100 → 50
    expect(openForce({ cA: 150, cB: 50, cV: 200, pA: 0, pB: 0, pV: 0 }, { call: 100, put: 0 })).toBe(50);
  });
  it("puts compradas empujan hacia abajo, puts vendidas hacia arriba", () => {
    expect(openForce({ cA: 0, cB: 0, cV: 0, pA: 80, pB: 0, pV: 80 }, undefined)).toBe(-80);
    expect(openForce({ cA: 0, cB: 0, cV: 0, pA: 0, pB: 60, pV: 60 }, undefined)).toBe(60);
  });
  it("las idas y vueltas del día se cancelan", () => {
    expect(openForce({ cA: 50, cB: 50, cV: 100, pA: 0, pB: 0, pV: 0 }, undefined)).toBe(0);
  });
});

describe("openMagnets", () => {
  const by = new Map<number, StrikeMinute[]>([
    [7400, [m(60, { cA: 143, cV: 143 })]], // compran calls → Imán +
    [7380, [m(60, { pA: 134, pV: 134 })]], // compran puts → Imán −
    [7360, [m(60, { pA: 900, pV: 900 })]], // compran puts pero hay 5,000 de OI → filtrado
    [7600, [m(60, { cA: 999, cV: 999 })]], // fuera del radio
  ]);
  const oi = new Map([[7360, { call: 0, put: 5000 }]]);

  it("elige el mayor neto abierto de cada lado dentro del radio", () => {
    const r = openMagnets(by, oi, 0, 120, 7390, () => 7390);
    expect(r.now.pos).toEqual({ strike: 7400, fuerza: 143 });
    expect(r.now.neg).toEqual({ strike: 7380, fuerza: 134 });
  });

  it("es acumulado: suma minuto a minuto y deja el recorrido", () => {
    const by2 = new Map<number, StrikeMinute[]>([
      [7400, [m(60, { cA: 20, cV: 20 }), m(120, { cA: 30, cV: 30 })]],
      [7410, [m(60, { cA: 40, cV: 40 })]],
    ]);
    const r = openMagnets(by2, new Map(), 0, 180, 7400, () => 7400);
    expect(r.now.pos).toEqual({ strike: 7400, fuerza: 50 });
    expect(r.history.filter((s) => s.kind === "pos").map((s) => s.strike)).toEqual([7410, 7400]);
  });
});
