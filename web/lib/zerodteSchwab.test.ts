import { describe, expect, it } from "vitest";
import { parseZeroDteChain } from "./zerodteSchwab";

describe("parseZeroDteChain", () => {
  it("aplana callExpDateMap/putExpDateMap a ZRow[] con griegos", () => {
    const json = {
      underlyingPrice: 7456.64,
      isDelayed: true,
      callExpDateMap: {
        "2026-07-31:0": {
          "7450.0": [
            {
              putCall: "CALL", symbol: "SPXW  260731C07450000", bid: 12.1, ask: 12.6,
              totalVolume: 66047, openInterest: 3039, volatility: 18.4,
              delta: 0.52, gamma: 0.01, theta: -3.2, vega: 1.1, strikePrice: 7450,
            },
          ],
        },
      },
      putExpDateMap: {
        "2026-07-31:0": {
          "7450.0": [
            {
              putCall: "PUT", symbol: "SPXW  260731P07450000", bid: 10.0, ask: 10.5,
              totalVolume: 20000, openInterest: 1000, volatility: -999,
              delta: -0.48, gamma: 0.01, theta: -3.0, vega: 1.0, strikePrice: 7450,
            },
          ],
        },
      },
    };

    const { rows, underlyingPrice, delayed } = parseZeroDteChain(json);
    expect(underlyingPrice).toBe(7456.64);
    expect(delayed).toBe(true);
    expect(rows).toHaveLength(2);

    const call = rows.find((r) => r.contractType === "call")!;
    expect(call.strike).toBe(7450);
    expect(call.expiration).toBe("2026-07-31");
    expect(call.optionTicker).toBe("SPXW260731C07450000");
    expect(call.volume).toBe(66047);
    expect(call.openInterest).toBe(3039);
    expect(call.bid).toBe(12.1);
    expect(call.greeks?.iv).toBeCloseTo(0.184, 5);

    const put = rows.find((r) => r.contractType === "put")!;
    // -999 es el centinela de "sin dato" en Schwab: debe descartarse, no leerse como IV real.
    expect(put.greeks?.iv).toBeNull();
    expect(put.greeks?.delta).toBeCloseTo(-0.48, 5);
  });

  it("ignora contratos sin strike y devuelve vacío con mapas ausentes", () => {
    expect(parseZeroDteChain({}).rows).toEqual([]);
    const json = { callExpDateMap: { "2026-07-31:0": { "x": [{ putCall: "CALL" }] } } };
    expect(parseZeroDteChain(json).rows).toEqual([]);
  });
});
