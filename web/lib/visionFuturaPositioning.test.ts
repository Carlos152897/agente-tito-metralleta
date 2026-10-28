import { describe, expect, it } from "vitest";
import { classify, emptyPosHistory, historyAt, markOutcome, netFlowJumps, netOf, pressureMarks, stepPositions, unusualText, type PosRow } from "./visionFuturaPositioning";

// Pruebas traídas del zip "visionfutura-main", con filas de este proyecto:
// callFlow = calls compradas − calls vendidas; putFlow = puts compradas − puts vendidas.
const row = (spx: number, callAsk: number, putBid: number, callBid: number, putAsk: number): PosRow => ({ spx, callFlow: callAsk - callBid, putFlow: putAsk - putBid });

describe("posicionamiento Long/Short", () => {
  it("Long si compras de call + ventas de put ganan; Short al revés; chico = sin barra", () => {
    const rows = [row(7680, 44, 28, 43, 35), row(7670, 22, 18, 9, 6), row(7650, 1, 0, 4, 3), row(7645, 0.5, 0.3, 0.4, 0.4)];
    expect(netOf(rows[0])).toBe(-6);
    const c = classify(rows);
    expect(c.get(7670)).toBe("L");
    expect(c.get(7680)).toBe("S");
    expect(c.get(7650)).toBe("S");
    expect(c.has(7645)).toBe(false); // 0 < 10% de 25
  });

  it("el historial confirma los cambios con dos lecturas y anota entra/cambia/sale", () => {
    const t0 = 1_000;
    let h = stepPositions(emptyPosHistory(), [row(7670, 20, 10, 5, 5)], t0);
    expect(h.segments).toEqual([{ strike: 7670, side: "L", start: t0, end: null }]);
    expect(h.events).toEqual([]); // la primera lectura no es un cambio

    const shortRows = [row(7670, 5, 5, 10, 30)];
    h = stepPositions(h, shortRows, t0 + 60_000);
    expect(h.segments).toHaveLength(1); // una sola lectura todavía no cambia
    h = stepPositions(h, shortRows, t0 + 120_000);
    expect(h.segments.map((s) => [s.side, s.start, s.end])).toEqual([
      ["L", t0, t0 + 120_000],
      ["S", t0 + 120_000, null],
    ]);
    expect(h.events.at(-1)).toMatchObject({ kind: "cambia", strike: 7670, text: "pasó de Long a Short" });

    // Un salto inusual del agresor se anota como "prende".
    h = stepPositions(h, shortRows, t0 + 180_000, [{ strike: 7670, side: "compra", delta: 9_600_000 }]);
    expect(h.events.at(-1)).toMatchObject({ kind: "prende", text: "▲ compra +$9.6M (agresor inusual)" });

    // Visto a mitad del día (repetición): el segmento Short aún no existía y el Long seguía abierto.
    expect(historyAt(h, t0 + 60_000).segments).toEqual([{ strike: 7670, side: "L", start: t0, end: null }]);
  });

  it("un cambio que no se sostiene 1 minuto no se anota", () => {
    const t0 = 1_000;
    let h = stepPositions(emptyPosHistory(), [row(7670, 20, 10, 5, 5)], t0);
    const shortRows = [row(7670, 5, 5, 10, 30)];
    h = stepPositions(h, shortRows, t0 + 15_000);
    h = stepPositions(h, shortRows, t0 + 30_000); // dos lecturas, pero solo 15 s sostenido
    expect(h.segments).toHaveLength(1);
    h = stepPositions(h, [row(7670, 20, 10, 5, 5)], t0 + 45_000); // regresa a Long: nunca cambió
    expect(h.events).toEqual([]);
    h = stepPositions(h, shortRows, t0 + 60_000);
    h = stepPositions(h, shortRows, t0 + 120_000); // ahora sí, 1 minuto sostenido
    expect(h.events.at(-1)).toMatchObject({ kind: "cambia", text: "pasó de Long a Short" });
  });
});

describe("órdenes grandes netas (CALL/PUT · empuja)", () => {
  const T = Date.parse("2026-10-28T12:05:00-04:00");
  const noise = [7650, 7655, 7660, 7665].map((k) => row(k, 1e6, 0, 0, 0));
  const prev = [row(7680, 30e6, 5e6, 20e6, 8e6), row(7670, 10e6, 2e6, 9e6, 3e6), ...noise];

  it("compra neta de calls → '▲ compra CALL … neto · empuja Long'", () => {
    const now = [row(7680, 42.74e6, 5e6, 20e6, 8e6), row(7670, 10e6, 2e6, 9e6, 3e6), ...noise.map((r) => ({ ...r, callFlow: r.callFlow + 50_000 }))];
    const [u] = netFlowJumps(now, prev, T, 40e6);
    expect(u).toMatchObject({ strike: 7680, side: "compra", type: "call", push: "L" });
    expect(unusualText(u)).toBe("▲ compra CALL +$12.7M neto · empuja Long");
  });

  it("compra y venta parecidas en el mismo strike se anulan; venta de puts empuja Long", () => {
    const cruce = [row(7680, 32e6, 5e6, 22e6, 8e6), ...prev.slice(1)]; // +2M compradas y +2M vendidas
    expect(netFlowJumps(cruce, prev, T, 40e6)).toEqual([]);
    const putsVendidas = [row(7680, 30e6, 9e6, 20e6, 8e6), ...prev.slice(1)];
    const [u] = netFlowJumps(putsVendidas, prev, T, 40e6);
    expect(unusualText(u)).toBe("▼ venta PUT +$4.0M neto · empuja Long");
  });

  it("9:30–9:45 sin marcas (salvo noche) y nada sin lectura anterior", () => {
    const now = [row(7680, 42.74e6, 5e6, 20e6, 8e6), ...prev.slice(1)];
    const at940 = Date.parse("2026-10-28T09:40:00-04:00");
    expect(netFlowJumps(now, prev, at940, 40e6)).toEqual([]);
    expect(netFlowJumps(now, prev, at940, 40e6, false)).toHaveLength(1);
    expect(netFlowJumps(now, null, T, 40e6)).toEqual([]);
  });
});

describe("marca de presión", () => {
  // 7,700 Short (calls vendidas y puts compradas dominan), precio a 0.7 pts.
  const prev = [row(7700, 11.51e6, 4.33e6, 11.51e6, 7.78e6), row(7690, 1e6, 0, 0, 0)];

  it("Short: puts compradas + calls vendidas netas en el strike del precio → presión abajo", () => {
    const now = [row(7700, 11.51e6, 4.33e6, 11.81e6, 8.18e6), row(7690, 1e6, 0, 0, 0)]; // +0.40M puts, +0.30M calls vendidas
    const [m] = pressureMarks(now, prev, 7699.3, 5, 1000);
    expect(m).toMatchObject({ strike: 7700, side: "S" });
    expect(m.amount).toBeCloseTo(0.7e6, 0);
    expect(m.text).toBe("● Short · compran PUT +$400K · venden CALL +$300K · presión abajo");
  });

  it("no marca si el precio está lejos, si entra poco o si va en contra del lado", () => {
    const now = [row(7700, 11.51e6, 4.33e6, 11.81e6, 8.18e6), row(7690, 1e6, 0, 0, 0)];
    expect(pressureMarks(now, prev, 7685, 5, 1000)).toEqual([]); // a 15 pts
    const poco = [row(7700, 11.51e6, 4.33e6, 11.51e6, 7.88e6), row(7690, 1e6, 0, 0, 0)]; // +0.10M
    expect(pressureMarks(poco, prev, 7699.3, 5, 1000)).toEqual([]);
    const contra = [row(7700, 12.01e6, 4.33e6, 11.51e6, 7.78e6), row(7690, 1e6, 0, 0, 0)]; // compran calls en un Short
    expect(pressureMarks(contra, prev, 7699.3, 5, 1000)).toEqual([]);
  });

  it("resultado: puntos a favor 15/30/60 min después", () => {
    const m = { t: 0, strike: 7700, side: "S" as const, amount: 1, putNet: 1, callNet: 0, spot: 7699, text: "" };
    const prices = [0, 15, 30, 45].map((min, i) => ({ t: min * 60_000, v: 7699 - i * 5 }));
    expect(markOutcome(m, prices)).toEqual({ m15: 5, m30: 10, m60: null });
  });
});
