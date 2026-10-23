import { describe, expect, it } from "vitest";
import {
  detectSwings,
  elliottWaveSignal,
  tryCorrectionComplete,
  tryImpulseComplete,
  tryInWave4,
  type Swing,
} from "./btcElliottWave";
import type { TfBar } from "./types";

/** Camino en escalera entre `points`, con velas angostas (bajo ATR) para que el
 * zigzag confirme exactamente en cada punto de giro. */
function pathBars(points: number[], stepsPerLeg = 20): TfBar[] {
  const bars: TfBar[] = [];
  let t = 0;
  for (let leg = 0; leg < points.length - 1; leg++) {
    const from = points[leg];
    const to = points[leg + 1];
    for (let i = 1; i <= stepsPerLeg; i++) {
      const price = from + (to - from) * (i / stepsPerLeg);
      bars.push({ time: t * 3600, open: price, high: price + 0.3, low: price - 0.3, close: price, volume: 100 });
      t++;
    }
  }
  return bars;
}

function swing(time: number, price: number, kind: "high" | "low", index = 0): Swing {
  return { time, price, kind, index };
}

describe("detectSwings", () => {
  it("confirma los giros de un camino en escalera limpio", () => {
    const bars = pathBars([100, 130, 115, 175]);
    const swings = detectSwings(bars);
    expect(swings.map((s) => Math.round(s.price))).toEqual([130, 115]);
    // el tramo final (115→175) queda sin confirmar (no hubo reversión todavía)
  });

  it("no confirma nada en una serie plana", () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({ time: i * 3600, open: 100, high: 100.05, low: 99.95, close: 100 }));
    expect(detectSwings(bars)).toEqual([]);
  });
});

describe("tryImpulseComplete", () => {
  const step = 3600;

  it("detecta un impulso alcista válido de 5 ondas y proyecta la corrección bajista", () => {
    const swings = [
      swing(0, 100, "low"),
      swing(1, 130, "high"),
      swing(2, 115, "low"),
      swing(3, 175, "high"),
      swing(4, 160, "low"),
      swing(5, 190, "high"),
    ];
    const c = tryImpulseComplete(swings, step);
    expect(c).not.toBeNull();
    expect(c!.bullish).toBe(false); // la corrección va en contra del impulso alcista → short
    expect(c!.invalidation).toBe(190);
    expect(c!.targetPrice).toBeCloseTo(145); // retroceso 50% del impulso 100→190
    expect(c!.confidence).toBeGreaterThan(0.35);
  });

  it("rechaza el conteo si la onda 2 retrocede más del 100% de la onda 1", () => {
    const swings = [
      swing(0, 100, "low"),
      swing(1, 130, "high"),
      swing(2, 90, "low"), // por debajo del inicio — invalida el impulso
      swing(3, 175, "high"),
      swing(4, 160, "low"),
      swing(5, 190, "high"),
    ];
    expect(tryImpulseComplete(swings, step)).toBeNull();
  });

  it("rechaza el conteo si la onda 4 invade el territorio de la onda 1", () => {
    const swings = [
      swing(0, 100, "low"),
      swing(1, 130, "high"),
      swing(2, 115, "low"),
      swing(3, 175, "high"),
      swing(4, 120, "low"), // por debajo del techo de la onda 1 (130)
      swing(5, 190, "high"),
    ];
    expect(tryImpulseComplete(swings, step)).toBeNull();
  });

  it("devuelve null con menos de 6 swings", () => {
    expect(tryImpulseComplete([swing(0, 100, "low"), swing(1, 130, "high")], step)).toBeNull();
  });
});

describe("tryInWave4", () => {
  const step = 3600;
  const swings = [swing(0, 100, "low", 0), swing(10, 130, "high", 1), swing(20, 115, "low", 2)];

  function bars(lastClose: number): TfBar[] {
    return [
      { time: 0, open: 100, high: 100, low: 100, close: 100 },
      { time: 10, open: 130, high: 130, low: 130, close: 130 },
      { time: 20, open: 115, high: 115, low: 114, close: 115 },
      { time: 30, open: 150, high: 150, low: 149, close: 150 },
      { time: 40, open: 175, high: 175, low: 170, close: 175 }, // techo (todavía no confirmado) de la onda 3
      { time: 50, open: lastClose, high: lastClose + 1, low: lastClose - 1, close: lastClose },
    ];
  }

  it("detecta la onda 4 en curso cuando el precio retrocede sin invadir la onda 1", () => {
    const c = tryInWave4(bars(150), swings, step);
    expect(c).not.toBeNull();
    expect(c!.bullish).toBe(true); // se retoma la subida con la onda 5
    expect(c!.invalidation).toBe(130);
    expect(c!.targetPrice).toBeCloseTo(205); // techo onda3 (175) + largo onda1 (30)
  });

  it("invalida el conteo si el retroceso rompe por debajo del techo de la onda 1", () => {
    expect(tryInWave4(bars(125), swings, step)).toBeNull();
  });
});

describe("tryCorrectionComplete", () => {
  const step = 3600;

  it("detecta una corrección ABC completa y proyecta la reanudación alcista", () => {
    const swings = [swing(0, 200, "high"), swing(1, 170, "low"), swing(2, 185, "high"), swing(3, 160, "low")];
    const c = tryCorrectionComplete(swings, step);
    expect(c).not.toBeNull();
    expect(c!.bullish).toBe(true);
    expect(c!.invalidation).toBe(160);
    expect(c!.targetPrice).toBe(190); // C (160) + tramo A (30)
  });

  it("rechaza el conteo si la onda B supera el techo previo", () => {
    const swings = [swing(0, 200, "high"), swing(1, 170, "low"), swing(2, 210, "high"), swing(3, 160, "low")];
    expect(tryCorrectionComplete(swings, step)).toBeNull();
  });
});

describe("elliottWaveSignal", () => {
  it("cae a neutral con pocas velas", () => {
    const bars = pathBars([100, 130], 5);
    const s = elliottWaveSignal(bars);
    expect(s.bias).toBe("neutral");
    expect(s.reason).toMatch(/no hay suficientes velas/i);
  });

  it("cae a neutral sin ningún swing (serie plana)", () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({ time: i * 3600, open: 100, high: 100.05, low: 99.95, close: 100 }));
    const s = elliottWaveSignal(bars);
    expect(s.bias).toBe("neutral");
  });

  it("de punta a punta: un impulso alcista limpio da bias short con la corrección proyectada", () => {
    // 150→100 arranca la serie (para que el propio 100 quede confirmado como
    // giro), y el tramo final 190→175 revierte lo suficiente para confirmar
    // el techo de la onda 5 — sin esa cola, el zigzag nunca la confirma.
    const bars = pathBars([150, 100, 130, 115, 175, 160, 190, 175]);
    const s = elliottWaveSignal(bars);
    expect(s.bias).toBe("short");
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.projection.length).toBeGreaterThan(0);
    expect(s.stopLoss).toBeGreaterThan(188);
    expect(s.target).toBeLessThan(150);
    expect(s.target).toBeGreaterThan(140);
  });
});
