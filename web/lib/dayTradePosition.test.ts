import { describe, expect, it } from "vitest";
import type { ContractSuggestion } from "./dayTrade";
import { buildPosition, isSameTradingDay, pnlOf } from "./dayTradePosition";

const NOW = new Date("2026-07-22T15:00:00Z");

function suggestion(overrides: Partial<ContractSuggestion> = {}): ContractSuggestion {
  return {
    ticker: "TSLA", occRoot: "TSLA", type: "call", strike: 315, expiration: "2026-07-23",
    role: "continuation", reason: "test", target: 320, spot: 310, reversalWarning: null,
    ...overrides,
  };
}

describe("buildPosition", () => {
  it("arma la posición con el símbolo OCC correcto y el día de mercado de hoy", () => {
    const pos = buildPosition(suggestion(), 5.2, NOW);
    expect(pos.symbol).toBe("TSLA260723C00315000");
    expect(pos.ticker).toBe("TSLA");
    expect(pos.entryPrice).toBe(5.2);
    expect(pos.entrySpot).toBe(310);
    expect(pos.dayKey).toBe("2026-07-22");
  });

  it("usa occRoot (no ticker) como raíz OCC — SPX cotiza sus opciones bajo SPXW", () => {
    const pos = buildPosition(suggestion({ ticker: "SPX", occRoot: "SPXW" }), 5.2, NOW);
    expect(pos.symbol).toBe("SPXW260723C00315000");
    expect(pos.ticker).toBe("SPX");
  });
});

describe("pnlOf", () => {
  it("calcula %/$ de ganancia sobre el precio de entrada", () => {
    expect(pnlOf(5, 6)).toEqual({ pctChange: 20, usdChange: 100 });
  });

  it("calcula %/$ de pérdida", () => {
    expect(pnlOf(5, 4)).toEqual({ pctChange: -20, usdChange: -100 });
  });

  it("null sin precio actual todavía", () => {
    expect(pnlOf(5, null)).toEqual({ pctChange: null, usdChange: null });
  });
});

describe("isSameTradingDay", () => {
  it("true si el dayKey coincide con el día de mercado de `now`", () => {
    const pos = buildPosition(suggestion(), 5, NOW);
    expect(isSameTradingDay(pos, NOW)).toBe(true);
  });

  it("false al día siguiente (day-trading: la posición caduca sola)", () => {
    const pos = buildPosition(suggestion(), 5, NOW);
    expect(isSameTradingDay(pos, new Date("2026-07-23T15:00:00Z"))).toBe(false);
  });
});
