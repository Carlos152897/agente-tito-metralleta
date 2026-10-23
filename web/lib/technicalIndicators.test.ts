import { describe, expect, it } from "vitest";
import {
  computeAtr,
  computeEma,
  computeMacd,
  computeRelativeVolume,
  computeRsi,
  computeVwap,
} from "./technicalIndicators";
import type { TfBar } from "./types";

function bar(time: number, o: number, h: number, l: number, c: number, v = 0): TfBar {
  return { time, open: o, high: h, low: l, close: c, volume: v };
}

describe("computeEma", () => {
  it("devuelve null antes de tener suficientes datos", () => {
    const out = computeEma([1, 2, 3], 5);
    expect(out).toEqual([null, null, null]);
  });

  it("siembra con la SMA y luego suaviza", () => {
    const out = computeEma([1, 2, 3, 4, 5, 6], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2); // SMA(1,2,3)
    // EMA(4) con k=0.5 sobre semilla 2: 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3);
  });
});

describe("computeMacd", () => {
  it("no da señal hasta que el MACD tiene 9 puntos propios", () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 100 + i, 100 + i, 100 + i, 100 + i));
    const out = computeMacd(bars, 12, 26, 9);
    // MACD existe recién en el índice 25 (slow=26 → índice slow-1); señal 8 puntos después (índice 33)
    expect(out[24].macd).toBeNull();
    expect(out[25].macd).not.toBeNull();
    expect(out[25].signal).toBeNull();
    expect(out[29].signal).toBeNull(); // la serie termina en 29, antes de los 9 puntos de señal
  });

  it("en una tendencia alcista sostenida el MACD queda positivo", () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i, 100 + i, 100 + i, 100 + i));
    const out = computeMacd(bars);
    const last = out[out.length - 1];
    expect(last.macd).not.toBeNull();
    expect(last.macd as number).toBeGreaterThan(0);
  });
});

describe("computeVwap", () => {
  it("es el precio típico ponderado por volumen dentro del mismo día", () => {
    const DAY = 86_400;
    const bars = [
      bar(0, 10, 12, 8, 10, 100), // típico = 10
      bar(3600, 20, 22, 18, 20, 100), // típico = 20
    ];
    const out = computeVwap(bars);
    expect(out[0]).toBeCloseTo(10);
    expect(out[1]).toBeCloseTo(15); // promedio ponderado igual (mismo volumen)
    void DAY;
  });

  it("reinicia el acumulado al cruzar medianoche UTC", () => {
    const DAY = 86_400;
    const bars = [
      bar(0, 10, 10, 10, 10, 100),
      bar(DAY, 50, 50, 50, 50, 100), // día siguiente — no debe arrastrar el día anterior
    ];
    const out = computeVwap(bars);
    expect(out[1]).toBeCloseTo(50);
  });

  it("cae al close si no hay volumen", () => {
    const out = computeVwap([bar(0, 10, 12, 8, 11, 0)]);
    expect(out[0]).toBe(11);
  });
});

describe("computeRsi", () => {
  it("da 100 cuando todas las velas suben", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const out = computeRsi(closes, 14);
    expect(out[14]).toBeCloseTo(100);
  });

  it("da 0 cuando todas las velas bajan", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const out = computeRsi(closes, 14);
    expect(out[14]).toBeCloseTo(0);
  });

  it("da ~50 en un zigzag parejo", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const out = computeRsi(closes, 14);
    expect(out[20]).not.toBeNull();
    expect(out[20] as number).toBeGreaterThan(30);
    expect(out[20] as number).toBeLessThan(70);
  });
});

describe("computeAtr", () => {
  it("es null antes de tener `period` rangos verdaderos", () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar(i, 100, 102, 98, 100));
    expect(computeAtr(bars, 14).every((v) => v == null)).toBe(true);
  });

  it("con rango constante converge a ese rango", () => {
    const bars = Array.from({ length: 30 }, (_, i) => bar(i, 100, 105, 95, 100));
    const out = computeAtr(bars, 14);
    expect(out[out.length - 1]).toBeCloseTo(10, 0);
  });
});

describe("computeRelativeVolume", () => {
  it("null antes de tener `period` barras previas", () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar(i, 1, 1, 1, 1, 100));
    expect(computeRelativeVolume(bars, 20).every((v) => v == null)).toBe(true);
  });

  it("mayor a 1 cuando el volumen actual supera el promedio previo", () => {
    const bars = Array.from({ length: 21 }, (_, i) =>
      bar(i, 1, 1, 1, 1, i === 20 ? 300 : 100),
    );
    const out = computeRelativeVolume(bars, 20);
    expect(out[20]).toBeCloseTo(3);
  });
});
