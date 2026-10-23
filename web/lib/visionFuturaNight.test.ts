import { describe, expect, it } from "vitest";
import { nightGexStats } from "./visionFuturaNight";
import { INSTRUMENTS, isNight, labelsOf, scaleFor } from "./visionFuturaInstruments";
import type { ZRow } from "./zerodteTypes";

const row = (contractType: "call" | "put", strike: number, oi: number, gamma = 0.006): ZRow => ({
  optionTicker: `${contractType}${strike}`, contractType, expiration: "2026-10-23", strike, openInterest: oi, volume: 0,
  bid: 1, ask: 1.2, greeks: { delta: null, gamma, theta: null, vega: null, iv: 0.2 },
});

describe("modo noche", () => {
  it("niveles propios: walls, imán, flip y max pain desde gamma × OI", () => {
    const rows = [
      row("put", 7650, 9000), row("call", 7650, 100),
      row("put", 7700, 500), row("call", 7700, 800),
      row("put", 7750, 100), row("call", 7750, 6000),
    ];
    const g = nightGexStats(rows, 7700, new Date("2026-10-23T02:00:00Z"))!;
    expect(g.call_wall).toBe(7750);
    expect(g.put_wall).toBe(7650);
    expect(g.magnet).toBe(7650); // mayor |GEX neto|
    expect(g.gamma_flip).toBeGreaterThan(7650);
    expect(g.gamma_flip).toBeLessThan(7750);
    expect(g.max_pain).toBe(7700);
  });

  it("sin OI no inventa niveles", () => {
    expect(nightGexStats([row("call", 7700, 0)], 7700, new Date())).toBeNull();
  });

  it("config: /ES escala 1, /NQ relativo a /ES, sin conversiones", () => {
    expect(isNight("ESN")).toBe(true);
    expect(isNight("SPX")).toBe(false);
    expect(scaleFor(INSTRUMENTS.ESN, 7700, { spxSpot: 7700, vix: null, atmIv: 0.2 })).toBe(1);
    expect(scaleFor(INSTRUMENTS.NQN, 29000, { spxSpot: 7700, vix: null, atmIv: 0.3 })).toBeCloseTo((29000 / 7700) * 1.2, 2);
    expect(labelsOf(INSTRUMENTS.NQN, "/NQZ6")).toEqual({ main: "/NQZ6", etf: null, future: null, vol: "IV ATM" });
  });
});
