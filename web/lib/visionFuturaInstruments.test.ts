import { describe, expect, it } from "vitest";
import { INSTRUMENTS, labelsOf, scaleFor, strikeStepNear } from "./visionFuturaInstruments";

describe("instrumentos de VisionFutura", () => {
  it("SPX escala 1 siempre (no cambia lo calibrado)", () => {
    expect(scaleFor(INSTRUMENTS.SPX, 7663, { spxSpot: 7663, vix: 30, atmIv: 0.5 })).toBe(1);
  });
  it("NQ: (NDX ÷ SPX) × 1.2, sin depender de la IV de sus opciones", () => {
    expect(scaleFor(INSTRUMENTS.NQ, 28958.69, { spxSpot: 7663.43, vix: 19, atmIv: 0.42 })).toBeCloseTo(4.535, 2);
  });
  it("TSLA: (precio × IV) ÷ (SPX × VIX)", () => {
    expect(scaleFor(INSTRUMENTS.TSLA, 373.42, { spxSpot: 7663.43, vix: 19.03, atmIv: 0.6111 })).toBeCloseTo((373.42 * 0.6111) / (7663.43 * 0.1903), 3);
  });
  it("paso de strike más común cerca del precio", () => {
    expect(strikeStepNear([7600, 7605, 7610, 7615, 7620, 7625, 7650, 7700], 7610)).toBe(5);
    expect(strikeStepNear([28900, 28910, 28920, 28930, 28950, 29000], 28920)).toBe(10);
    expect(strikeStepNear([365, 367.5, 370, 372.5, 375, 380, 385], 372)).toBe(2.5);
  });
  it("nombres por instrumento", () => {
    expect(labelsOf(INSTRUMENTS.NQ, "/NQZ6")).toEqual({ main: "NDX", etf: "QQQ", future: "/NQZ6", vol: "IV ATM" });
    expect(labelsOf(INSTRUMENTS.TSLA)).toEqual({ main: "TSLA", etf: null, future: null, vol: "IV ATM" });
  });
});
