import { describe, expect, it } from "vitest";
import { aggregateCandles, analyzePremarket, niceStep, type PmCandle } from "./visionFuturaPremarketChart";

const c = (i: number, o: number, h: number, l: number, cl: number, v = 100, ask = 50, bid = 50): PmCandle =>
  ({ time: 1_000_000 + i * 60, open: o, high: h, low: l, close: cl, volume: v, askVolume: ask, bidVolume: bid });

describe("niceStep", () => {
  it("redondea a 1/2/2.5/5×10^n", () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1.7)).toBe(2);
    expect(niceStep(2.3)).toBe(2.5);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05);
  });
});

describe("aggregateCandles", () => {
  it("junta velas de 1 min en 5 min", () => {
    const base = 300 * 1000; // múltiplo de 5 min
    const bars = [0, 1, 2, 3, 4, 5].map((i) => ({ ...c(i, 10 + i, 12 + i, 9 + i, 11 + i), time: base + i * 60 }));
    const agg = aggregateCandles(bars, 5);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toMatchObject({ open: 10, high: 16, low: 9, close: 15, volume: 500, askVolume: 250 });
    expect(agg[1]).toMatchObject({ open: 15, close: 16 });
  });
});

describe("analyzePremarket", () => {
  it("sin velas → vacío", () => {
    const a = analyzePremarket([]);
    expect(a.nightHigh).toBeNull();
    expect(a.profile).toEqual([]);
  });

  it("máx/mín de la noche con su hora", () => {
    const bars = [c(0, 100, 101, 99, 100), c(1, 100, 105, 100, 104), c(2, 104, 104, 95, 96), c(3, 96, 98, 96, 97)];
    const a = analyzePremarket(bars);
    expect(a.nightHigh).toEqual({ price: 105, time: bars[1].time });
    expect(a.nightLow).toEqual({ price: 95, time: bars[2].time });
    expect(a.first).toBe(100);
    expect(a.last).toBe(97);
  });

  it("POC en el precio donde más se operó y área de valor lo contiene", () => {
    const bars: PmCandle[] = [];
    for (let i = 0; i < 30; i++) bars.push(c(i, 7000, 7001, 6999, 7000, 1000)); // mucho volumen en 7000
    bars.push(c(30, 7000, 7040, 7000, 7040, 50), c(31, 7040, 7040, 6960, 6960, 50));
    const a = analyzePremarket(bars);
    expect(a.poc).not.toBeNull();
    expect(Math.abs(a.poc! - 7000)).toBeLessThanOrEqual(a.bucket);
    expect(a.valueArea!.low).toBeLessThanOrEqual(a.poc!);
    expect(a.valueArea!.high).toBeGreaterThanOrEqual(a.poc!);
  });

  it("marca la vela con compra agresiva fuera de lo normal", () => {
    const bars: PmCandle[] = [];
    for (let i = 0; i < 40; i++) bars.push(c(i, 100, 101, 99, 100, 100, 50 + (i % 3), 50));
    bars.push(c(40, 100, 103, 100, 103, 500, 450, 50)); // delta +400
    bars.push(c(41, 103, 103, 98, 98, 400, 40, 360)); // delta −320
    const a = analyzePremarket(bars);
    expect(a.hasFlow).toBe(true);
    expect(a.aggressors.map((x) => x.side)).toEqual(["compra", "venta"]);
    expect(a.aggressors[0].delta).toBe(400);
    expect(a.aggZones.some((z) => z.side === "compra")).toBe(true);
    expect(a.aggZones.some((z) => z.side === "venta")).toBe(true);
  });

  it("sin bid/ask no inventa agresor", () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10, volume: 5 }));
    const a = analyzePremarket(bars);
    expect(a.hasFlow).toBe(false);
    expect(a.aggressors).toEqual([]);
  });
});
