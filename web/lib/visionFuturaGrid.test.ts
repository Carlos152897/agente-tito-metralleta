import { describe, expect, it } from "vitest";
import { gridMinutes, gridRows, gridSnapshot, gridStepFor, gridVolRows, nativeStep } from "./visionFuturaGrid";
import type { VisionStrikeRow } from "./visionFutura";

const row = (spx: number, netGex = 0, compras = 0, extra: Partial<VisionStrikeRow> = {}): VisionStrikeRow => ({
  spx, spy: spx / 10, es: spx + 100,
  callGex: Math.max(netGex, 0), putGex: Math.max(-netGex, 0), netGex, charm: 0,
  callFlow: 0, putFlow: 0, compras, ventas: 0, callVolume: 0, putVolume: 0,
  dealerCalls: null, dealerPuts: null, dealerRole: null, strongFlow: false, tags: [],
  ...extra,
});

describe("gridStepFor", () => {
  it("SPX queda en 5, NQ sube a 20, TSLA se queda en su paso", () => {
    expect(gridStepFor(5, 1)).toBe(5);
    expect(gridStepFor(10, 4.49)).toBe(20);
    expect(gridStepFor(5, 4.49)).toBe(20);
    expect(gridStepFor(2.5, 0.2)).toBe(2.5);
  });
  it("paso nativo = hueco más chico", () => {
    expect(nativeStep([28500, 28510, 28520, 28550])).toBe(10);
  });
});

describe("gridRows", () => {
  it("SPX parejo queda igual", () => {
    const rows = [row(7605, 1), row(7600, -2), row(7595, 3)];
    expect(gridRows(rows, 5).map((r) => [r.spx, r.netGex])).toEqual([[7605, 1], [7600, -2], [7595, 3]]);
  });
  it("suma por tramo y rellena huecos (de mayor a menor)", () => {
    const rows = [row(28560, 5, 1), row(28540, 1, 2), row(28530, -4, 3), row(28480, 2, 4)];
    const g = gridRows(rows, 20);
    expect(g.map((r) => r.spx)).toEqual([28560, 28540, 28520, 28500, 28480]);
    expect(g.map((r) => r.netGex)).toEqual([5, 1, -4, 0, 2]);
    // 28530 cae en el tramo de 28520 (redondeo), con su conversión corrida
    expect(g[2].es).toBe(28520 + 100);
    expect(g[3].compras).toBe(0);
  });
  it("agrega filas vacías para que quepa el precio, con tope", () => {
    const rows = [row(28500, 1), row(28480, 2)];
    const g = gridRows(rows, 20, { lo: 28430, hi: 28505 });
    // una fila de margen arriba y abajo del precio
    expect(g.map((r) => r.spx)).toEqual([28520, 28500, 28480, 28460, 28440, 28420, 28400]);
    expect(gridRows(rows, 20, { lo: 20000, hi: 28500, maxExtra: 2 }).at(-1)!.spx).toBe(28440);
  });
  it("lo que no se suma viene del strike con más peso", () => {
    const rows = [row(28510, 1, 0, { dealerRole: "piso" }), row(28500, -9, 0, { dealerRole: "acelera_abajo" })];
    const g = gridRows(rows, 20);
    expect(g).toHaveLength(1);
    expect(g[0].netGex).toBe(-8);
    expect(g[0].dealerRole).toBe("acelera_abajo");
  });
});

describe("datos por strike", () => {
  it("agresor anterior, volumen y minutos se suman en su fila", () => {
    const snap = gridSnapshot(new Map([[28510, { compras: 1, ventas: 2, up: 0, down: 1 }], [28500, { compras: 3, ventas: 0, up: 2, down: 0 }]]), 20);
    expect(snap!.get(28500)).toEqual({ compras: 4, ventas: 2, up: 2, down: 1 });
    const vol = gridVolRows([
      { strike: 28510, cA: 1, cB: 0, cV: 1, pA: 0, pB: 0, pV: 0, delta: 1, prevDelta: null, position: null },
      { strike: 28500, cA: 2, cB: 1, cV: 3, pA: 0, pB: 0, pV: 0, delta: 1, prevDelta: 2, position: { kind: "compran_calls", contracts: 1, side: "arriba" } },
    ], 20);
    expect(vol).toHaveLength(1);
    expect(vol[0]).toMatchObject({ strike: 28500, cA: 3, delta: 2, prevDelta: 2, position: { kind: "compran_calls" } });
    const mins = gridMinutes(new Map([[28510, [{ t: 60, cA: 1, cB: 0, cV: 1, pA: 0, pB: 0, pV: 0 }]], [28500, [{ t: 60, cA: 2, cB: 0, cV: 2, pA: 0, pB: 0, pV: 0 }]]]), 20);
    expect(mins.get(28500)).toEqual([{ t: 60, cA: 3, cB: 0, cV: 3, pA: 0, pB: 0, pV: 0 }]);
  });
});
