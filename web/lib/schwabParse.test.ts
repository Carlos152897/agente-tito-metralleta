import { describe, expect, it } from "vitest";
import { greeksKey, parseSchwabChain } from "./schwabParse";

function fixture() {
  return {
    underlyingPrice: 738.93,
    callExpDateMap: {
      "2026-07-27:1": {
        "738.0": [
          {
            strikePrice: 738.0,
            delta: 0.536,
            gamma: 0.064,
            theta: -0.404,
            vega: 0.261,
            volatility: 9.819,
            bid: 3.03,
            ask: 3.05,
            last: 3.05,
            openInterest: 1428,
          },
        ],
      },
    },
    putExpDateMap: {
      "2026-07-27:1": {
        "700.0": [
          {
            strikePrice: 700.0,
            delta: -999, // Schwab: sin dato
            gamma: -999,
            theta: -999,
            vega: -999,
            volatility: -999,
            bid: 0.5,
            ask: 0.6,
            last: 0.55,
            openInterest: 200,
          },
        ],
      },
    },
  };
}

describe("parseSchwabChain", () => {
  it("mapea underlyingPrice y contratos con griegos válidos", () => {
    const { underlyingPrice, greeks } = parseSchwabChain(fixture());
    expect(underlyingPrice).toBe(738.93);
    const key = greeksKey(738, "2026-07-27", "call");
    expect(greeks[key]).toMatchObject({
      delta: 0.536,
      gamma: 0.064,
      theta: -0.404,
      vega: 0.261,
      openInterest: 1428,
    });
    expect(greeks[key].iv).toBeCloseTo(0.09819);
  });

  it("trata el centinela -999 de Schwab como sin dato, no como griego real", () => {
    const { greeks } = parseSchwabChain(fixture());
    const key = greeksKey(700, "2026-07-27", "put");
    expect(greeks[key]).toMatchObject({
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: 200,
    });
  });

  it("devuelve mapa vacío con entrada vacía o inválida", () => {
    expect(parseSchwabChain(null).greeks).toEqual({});
    expect(parseSchwabChain({}).greeks).toEqual({});
  });
});
