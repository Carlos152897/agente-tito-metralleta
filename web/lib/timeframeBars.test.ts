import { describe, it, expect } from "vitest";
import { aggregateHourlyBars, chartTimeframeConfig, CHART_TIMEFRAMES } from "./timeframeBars";

describe("aggregateHourlyBars", () => {
  it("agrupa barras horarias dentro del mismo bucket de 4h", () => {
    const h = 3600;
    const bars = [
      { time: 0 * h, open: 10, high: 12, low: 9, close: 11 },
      { time: 1 * h, open: 11, high: 13, low: 10, close: 12 },
      { time: 2 * h, open: 12, high: 14, low: 11, close: 13 },
      { time: 3 * h, open: 13, high: 15, low: 12, close: 14 },
    ];
    const out = aggregateHourlyBars(bars, 4);
    expect(out).toEqual([{ time: 0, open: 10, high: 15, low: 9, close: 14, volume: 0 }]);
  });

  it("abre un bucket nuevo al cruzar el corte de 4h", () => {
    const h = 3600;
    const bars = [
      { time: 3 * h, open: 10, high: 12, low: 9, close: 11 },
      { time: 4 * h, open: 11, high: 13, low: 10, close: 12 },
    ];
    const out = aggregateHourlyBars(bars, 4);
    expect(out).toEqual([
      { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 0 },
      { time: 4 * h, open: 11, high: 13, low: 10, close: 12, volume: 0 },
    ]);
  });

  it("no toca las barras si hours <= 1", () => {
    const bars = [{ time: 0, open: 1, high: 2, low: 0, close: 1.5 }];
    expect(aggregateHourlyBars(bars, 1)).toEqual(bars);
  });

  it("no genera buckets para huecos sin datos", () => {
    const h = 3600;
    const bars = [
      { time: 0 * h, open: 1, high: 1, low: 1, close: 1 },
      { time: 20 * h, open: 2, high: 2, low: 2, close: 2 },
    ];
    const out = aggregateHourlyBars(bars, 4);
    expect(out).toHaveLength(2);
    expect(out[1].time).toBe(20 * h);
  });

  it("suma el volumen de las barras horarias dentro del mismo bucket", () => {
    const h = 3600;
    const bars = [
      { time: 0 * h, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 1 * h, open: 11, high: 13, low: 10, close: 12, volume: 50 },
      { time: 2 * h, open: 12, high: 14, low: 11, close: 13, volume: 75 },
      { time: 3 * h, open: 13, high: 15, low: 12, close: 14, volume: 25 },
    ];
    const out = aggregateHourlyBars(bars, 4);
    expect(out).toEqual([{ time: 0, open: 10, high: 15, low: 9, close: 14, volume: 250 }]);
  });
});

describe("chartTimeframeConfig", () => {
  it("devuelve la config de un id válido", () => {
    expect(chartTimeframeConfig("1w")).toMatchObject({ timespan: "week", days: 3 * 365 });
  });

  it("cae al default (15m) con un id desconocido", () => {
    expect(chartTimeframeConfig("bogus")).toMatchObject({ id: "15m" });
  });

  it("tiene las 6 temporalidades pedidas por Carlos", () => {
    expect(CHART_TIMEFRAMES.map((t) => t.id)).toEqual(["1w", "1d", "4h", "1h", "15m", "5m"]);
  });
});
