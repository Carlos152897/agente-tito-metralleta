import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import { isOtm, isUnusualSwingCandidate, rankUnusualSwing } from "./unusualSwing";

const NOW = new Date("2026-07-22T21:00:00Z");

function trade(overrides: Partial<RawTrade>): RawTrade {
  return {
    id: 1,
    symbol: "TSLA261001C00330000", // dte=71 desde NOW, dentro de la ventana de 60-90
    price: 5,
    size: 500,
    side: "ASKSIDE",
    bid_price: 4.9,
    ask_price: 5.1,
    premium: 250_000,
    delta: 0.35,
    implied_volatility: 0.5,
    open_interest: 100, // 500 > 100, volumen mayor al Open Interest
    volume: 500,
    score: 50,
    sentiment: "bullish",
    timestamp: "2026-07-22T19:59:59.994Z",
    asset_price: 310, // strike 330 > 310 → OTM call
    ...overrides,
  };
}

describe("isOtm", () => {
  it("call OTM: strike por encima del subyacente", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260810C00330000", asset_price: 310 })], NOW);
    expect(isOtm(rows[0])).toBe(true);
  });

  it("call ITM: strike por debajo del subyacente → no OTM", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260810C00300000", asset_price: 310 })], NOW);
    expect(isOtm(rows[0])).toBe(false);
  });

  it("put OTM: strike por debajo del subyacente", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260810P00300000", asset_price: 310 })], NOW);
    expect(isOtm(rows[0])).toBe(true);
  });

  it("put ITM: strike por encima del subyacente → no OTM", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260810P00330000", asset_price: 310 })], NOW);
    expect(isOtm(rows[0])).toBe(false);
  });
});

describe("isUnusualSwingCandidate", () => {
  it("acepta un candidato que cumple todo el criterio", () => {
    const { rows } = classifyFlow([trade({})], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(true);
  });

  it("rechaza ITM (no OTM)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA261001C00300000" })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza vencimiento a más de 90 días", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA270101C00330000" })], NOW); // muy lejos
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza vencimiento a menos de 60 días (dte=59)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260919C00330000" })], NOW); // dte=59
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("acepta justo en el borde de 60 días", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260920C00330000" })], NOW); // dte=60
    expect(isUnusualSwingCandidate(rows[0])).toBe(true);
  });

  it("acepta justo en el borde de 90 días", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA261020C00330000" })], NOW); // dte=90
    expect(isUnusualSwingCandidate(rows[0])).toBe(true);
  });

  it("rechaza justo un día pasado el borde de 90 días (dte=91)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA261021C00330000" })], NOW); // dte=91
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza vencido", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260701C00330000" })], NOW); // ya pasó
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza compra que no fue al ask", () => {
    const { rows } = classifyFlow([trade({ side: "BIDSIDE" })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza multileg", () => {
    const { rows } = classifyFlow([trade({ trade_condition_id: 232 })], NOW); // MLET, ver lib/conditions.ts
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza volumen absoluto insuficiente aunque el ratio sea alto", () => {
    const { rows } = classifyFlow([trade({ volume: 30, open_interest: 5 })], NOW); // 6x pero solo 30 contratos
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza si el volumen es igual al Open Interest (no es mayor)", () => {
    const { rows } = classifyFlow([trade({ volume: 300, open_interest: 300 })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("rechaza si el volumen queda por debajo del Open Interest", () => {
    const { rows } = classifyFlow([trade({ volume: 300, open_interest: 350 })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });

  it("acepta cuando el volumen supera al Open Interest, aunque sea por poco", () => {
    const { rows } = classifyFlow([trade({ volume: 301, open_interest: 300 })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(true);
  });

  it("rechaza sin Open Interest (dato no confiable)", () => {
    const { rows } = classifyFlow([trade({ open_interest: 0 })], NOW);
    expect(isUnusualSwingCandidate(rows[0])).toBe(false);
  });
});

describe("rankUnusualSwing", () => {
  it("ordena por ratio volumen/OI descendente, y premium como desempate", () => {
    const { rows } = classifyFlow(
      [
        trade({ id: 1, symbol: "AAAA260810C00330000", volume: 300, open_interest: 100, premium: 900_000 }), // 3x
        trade({ id: 2, symbol: "BBBB260810C00330000", volume: 600, open_interest: 100, premium: 500_000 }), // 6x
        trade({ id: 3, symbol: "CCCC260810C00330000", volume: 300, open_interest: 100, premium: 1_000_000 }), // 3x, más premium que #1
      ],
      NOW,
    );
    const ranked = rankUnusualSwing(rows);
    expect(ranked.map((r) => r.symbol)).toEqual([
      "BBBB260810C00330000", // ratio más alto (6x)
      "CCCC260810C00330000", // empate de ratio con AAAA, gana por premium
      "AAAA260810C00330000",
    ]);
  });
});
