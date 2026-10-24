import { describe, expect, it } from "vitest";
import { detectUnusual, mergeUnusual, minutesSinceOpen, positioningSides, snapshotOf, type FlowRow } from "./visionFuturaFlowChanges";

const row = (spx: number, compras: number, ventas: number, callFlow = 0, putFlow = 0): FlowRow => ({ spx, compras, ventas, callFlow, putFlow });

describe("positioningSides", () => {
  it("separa arriba (compra calls + venta puts) y abajo (venta calls + compra puts)", () => {
    expect(positioningSides({ callFlow: 5, putFlow: -2 })).toEqual({ up: 7, down: 0 });
    expect(positioningSides({ callFlow: -3, putFlow: 4 })).toEqual({ up: 0, down: 7 });
    expect(positioningSides({ callFlow: 2, putFlow: 1 })).toEqual({ up: 2, down: 1 });
  });
});

describe("detectUnusual", () => {
  it("el ejemplo de Carlos: 7,625 compras de 14.9M a 17M se enciende", () => {
    const prev = snapshotOf([row(7625, 14.9e6, 5e6), row(7630, 8e6, 6e6), row(7620, 3e6, 2e6)]);
    const now = [row(7625, 17e6, 5e6), row(7630, 8.1e6, 6e6), row(7620, 3.05e6, 2e6)];
    const hits = detectUnusual(now, prev, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ strike: 7625, side: "compra", before: 14.9e6, after: 17e6 });
    expect(hits[0].delta).toBeCloseTo(2.1e6);
  });

  it("ignora saltos chicos y movimientos parejos en muchos strikes", () => {
    const prev = snapshotOf([1, 2, 3, 4, 5].map((i) => row(7600 + i * 5, 10e6, 10e6)));
    const now = [1, 2, 3, 4, 5].map((i) => row(7600 + i * 5, 11.2e6, 10.1e6)); // +1.2M en todos: es el ritmo normal
    expect(detectUnusual(now, prev, 1)).toEqual([]);
  });

  it("detecta ventas inusuales y no hace nada sin refresco anterior", () => {
    const prev = snapshotOf([row(7600, 1e6, 2e6), row(7605, 1e6, 1e6)]);
    const hits = detectUnusual([row(7600, 1e6, 5e6), row(7605, 1e6, 1e6)], prev, 1);
    expect(hits.map((h) => `${h.strike}:${h.side}`)).toEqual(["7600:venta"]);
    expect(detectUnusual([row(7600, 1e6, 5e6)], null, 1)).toEqual([]);
  });
});

describe("calentamiento de apertura", () => {
  it("no enciende nada entre 9:30 y 9:45 NY", () => {
    const at945 = Date.parse("2026-10-23T09:44:00-04:00");
    expect(minutesSinceOpen(at945)).toBe(14);
    const prev = snapshotOf([row(7625, 1e6, 1e6), row(7630, 1e6, 1e6)]);
    const now = [row(7625, 9e6, 1e6), row(7630, 1e6, 1e6)];
    expect(detectUnusual(now, prev, at945)).toEqual([]);
    expect(detectUnusual(now, prev, Date.parse("2026-10-23T10:00:00-04:00"))).toHaveLength(1);
    expect(detectUnusual(now, prev, at945, undefined, false)).toHaveLength(1);
  });
});

describe("mergeUnusual", () => {
  it("mantiene el strike encendido 3 min y se queda con el más reciente", () => {
    const a = { strike: 7625, side: "compra" as const, delta: 1, before: 0, after: 1, at: 0 };
    const b = { ...a, delta: 2, at: 60_000 };
    expect(mergeUnusual([a], [b], 60_000)).toEqual([b]);
    expect(mergeUnusual([a], [], 3 * 60_000 + 1)).toEqual([]);
  });
});
