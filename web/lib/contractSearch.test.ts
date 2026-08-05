import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import {
  estimateTarget, isAggressiveAsk, isBuildingIntoOI, isInDteWindow, isSingleLeg,
} from "./contractSearch";

const NOW = new Date("2026-07-22T21:00:00Z");

function trade(overrides: Partial<RawTrade>): RawTrade {
  return {
    id: 1,
    symbol: "TSLA261120P00305000",
    price: 11.7,
    size: 1,
    side: "ASKSIDE",
    bid_price: 11.55,
    ask_price: 11.75,
    premium: 1170,
    delta: -0.18,
    implied_volatility: 0.48,
    open_interest: 1556,
    volume: 1046,
    score: 50,
    sentiment: "bearish",
    timestamp: "2026-07-22T19:59:59.994Z",
    ...overrides,
  };
}

describe("isSingleLeg", () => {
  it("acepta un trade de una sola pata", () => {
    const { rows } = classifyFlow([trade({ symbol: "AAAA260101C00100000" })], NOW);
    expect(isSingleLeg(rows[0])).toBe(true);
  });
});

describe("isBuildingIntoOI", () => {
  it("acepta cuando el volumen del día supera el OI existente", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "AAAA260101C00100000", volume: 200, open_interest: 100 })],
      NOW,
    );
    expect(isBuildingIntoOI(rows[0])).toBe(true);
  });

  it("rechaza cuando el volumen no supera el OI (rotación, no dinero nuevo)", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "AAAA260101C00100000", volume: 50, open_interest: 100 })],
      NOW,
    );
    expect(isBuildingIntoOI(rows[0])).toBe(false);
  });

  it("rechaza sin Open Interest (nada contra qué comparar)", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "AAAA260101C00100000", volume: 200, open_interest: 0 })],
      NOW,
    );
    expect(isBuildingIntoOI(rows[0])).toBe(false);
  });
});

describe("isAggressiveAsk", () => {
  it("acepta compra ejecutada al ask", () => {
    const { rows } = classifyFlow([trade({ symbol: "AAAA260101C00100000", side: "ASKSIDE" })], NOW);
    expect(isAggressiveAsk(rows[0])).toBe(true);
  });

  it("rechaza venta ejecutada al bid", () => {
    const { rows } = classifyFlow([trade({ symbol: "AAAA260101C00100000", side: "BIDSIDE" })], NOW);
    expect(isAggressiveAsk(rows[0])).toBe(false);
  });
});

describe("isInDteWindow", () => {
  it("rechaza vencimientos por debajo de la ventana (day-trading, <10 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260724C00320000" })], NOW); // dte=2
    expect(isInDteWindow(rows[0])).toBe(false);
  });

  it("acepta justo en el borde inferior (10 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260801C00320000" })], NOW); // dte=10
    expect(isInDteWindow(rows[0])).toBe(true);
  });

  it("acepta dentro de la ventana (ej. 24 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260815C00320000" })], NOW); // dte≈24
    expect(isInDteWindow(rows[0])).toBe(true);
  });

  it("acepta justo en el borde superior (40 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260831C00320000" })], NOW); // dte=40
    expect(isInDteWindow(rows[0])).toBe(true);
  });

  it("rechaza vencimientos de más de 40 días (LEAPS/swing largo)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260901C00320000" })], NOW); // dte=41
    expect(isInDteWindow(rows[0])).toBe(false);
  });

  it("respeta un umbral custom", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260815C00320000" })], NOW); // dte≈24
    expect(isInDteWindow(rows[0], 30, 60)).toBe(false);
    expect(isInDteWindow(rows[0], 20, 30)).toBe(true);
  });
});

describe("estimateTarget", () => {
  it("para un call, ambos targets quedan ARRIBA del spot, target2 más lejos que target1", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", delta: 0.4, implied_volatility: 0.5, asset_price: 310 })],
      NOW,
    ); // dte ≈ 24
    const result = estimateTarget(rows[0], 310);
    expect(result.target1).not.toBeNull();
    expect(result.target2).not.toBeNull();
    expect(result.target1!).toBeGreaterThan(310);
    expect(result.target2!).toBeGreaterThan(result.target1!);
    expect(result.changePctToTarget1!).toBeGreaterThan(0);
    expect(result.changePctToTarget2!).toBeGreaterThan(result.changePctToTarget1!);
    expect(result.convictionPct1!).toBeGreaterThan(50);
    expect(result.estUsdGain1!).toBeGreaterThan(0);
    expect(result.estUsdGain2!).toBeGreaterThan(result.estUsdGain1!);
  });

  it("target2 tiene menor convicción que target1 (más lejos, menos probable)", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", implied_volatility: 0.5, asset_price: 310 })],
      NOW,
    );
    const result = estimateTarget(rows[0], 310);
    expect(result.convictionPct2!).toBeLessThan(result.convictionPct1!);
  });

  it("para un put, ambos targets quedan ABAJO del spot — no al revés de la apuesta", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815P00320000", delta: -0.4, implied_volatility: 0.5, asset_price: 328 })],
      NOW,
    );
    const result = estimateTarget(rows[0], 328);
    expect(result.target1!).toBeLessThan(328);
    expect(result.target2!).toBeLessThan(result.target1!);
    expect(result.changePctToTarget1!).toBeLessThan(0);
    expect(result.convictionPct1!).toBeGreaterThan(50);
  });

  it("a más IV/DTE, el target1 queda más lejos y la convicción baja", () => {
    const { rows: lowIv } = classifyFlow(
      [trade({ symbol: "TSLA260801C00320000", implied_volatility: 0.3, asset_price: 310 })], // dte=10
      NOW,
    );
    const { rows: highIv } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", implied_volatility: 1.2, asset_price: 310 })], // dte≈24
      NOW,
    );
    const low = estimateTarget(lowIv[0], 310);
    const high = estimateTarget(highIv[0], 310);
    expect(high.target1!).toBeGreaterThan(low.target1!);
    expect(high.convictionPct1!).toBeLessThan(low.convictionPct1!);
  });

  it("null en todos los campos sin spot (ni en vivo ni al momento del trade)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260815C00320000" })], NOW);
    expect(estimateTarget(rows[0], null)).toEqual({
      target1: null, convictionPct1: null, changePctToTarget1: null, estUsdGain1: null,
      target2: null, convictionPct2: null, changePctToTarget2: null, estUsdGain2: null,
    });
  });

  it("usa el precio del subyacente al momento del trade si no hay spot en vivo todavía", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", asset_price: 310 })],
      NOW,
    );
    const result = estimateTarget(rows[0], null);
    expect(result.target1).not.toBeNull();
    expect(result.target1!).toBeGreaterThan(310);
  });
});
