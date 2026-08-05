import { describe, expect, it } from "vitest";
import { classifyFlow, type RawTrade } from "./flow";
import { estimateTarget, isNearExpiration, isNearMoney, rankByAggression } from "./contractSearch";

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

describe("rankByAggression", () => {
  it("descarta lo que no compró al ask", () => {
    const { rows } = classifyFlow(
      [
        trade({ id: 1, symbol: "AAAA260101C00100000", side: "ASKSIDE", premium: 100 }),
        trade({ id: 2, symbol: "BBBB260101C00100000", side: "BIDSIDE", premium: 5_000_000 }),
      ],
      NOW,
    );
    const ranked = rankByAggression(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].symbol).toBe("AAAA260101C00100000");
  });

  it("prioriza exceededOI sobre premium, y premium dentro de cada grupo", () => {
    const { rows } = classifyFlow(
      [
        // más premium pero SIN superar el OI
        trade({ id: 1, symbol: "AAAA260101C00100000", side: "ASKSIDE", premium: 900, volume: 10, open_interest: 1000 }),
        // menos premium pero SÍ superó el OI
        trade({ id: 2, symbol: "BBBB260101C00100000", side: "ASKSIDE", premium: 500, volume: 200, open_interest: 100 }),
        // otro que superó el OI, con más premium que el anterior
        trade({ id: 3, symbol: "CCCC260101C00100000", side: "ASKSIDE", premium: 800, volume: 300, open_interest: 100 }),
      ],
      NOW,
    );
    const ranked = rankByAggression(rows);
    expect(ranked.map((r) => r.symbol)).toEqual([
      "CCCC260101C00100000", // exceededOI, mayor premium
      "BBBB260101C00100000", // exceededOI, menor premium
      "AAAA260101C00100000", // no exceededOI, va al final aunque tenga más premium
    ]);
  });
});

describe("isNearMoney", () => {
  it("acepta un strike cerca del precio del subyacente (ATM)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260101C00315000", asset_price: 310 })], NOW);
    expect(isNearMoney(rows[0])).toBe(true); // 315 vs 310 ≈ 1.6%
  });

  it("rechaza un strike deep ITM/OTM (ej. call $45 con el subyacente en $91)", () => {
    const { rows } = classifyFlow([trade({ symbol: "INTC281215C00045000", asset_price: 91.51 })], NOW);
    expect(isNearMoney(rows[0])).toBe(false); // ≈ 50.8% de distancia
  });

  it("respeta un umbral custom", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260101C00350000", asset_price: 310 })], NOW);
    expect(isNearMoney(rows[0], 10)).toBe(false); // ≈ 12.9%, no pasa ni un umbral de 10% ni el default de 3%
    expect(isNearMoney(rows[0], 15)).toBe(true);
  });

  it("false sin precio del subyacente (asset_price ausente)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260101C00320000" })], NOW);
    expect(isNearMoney(rows[0])).toBe(false);
  });
});

describe("isNearExpiration", () => {
  it("acepta vencimientos dentro de la ventana de day-trading (0-5 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260724C00320000" })], NOW); // dte=2
    expect(isNearExpiration(rows[0])).toBe(true);
  });

  it("acepta 0DTE (vence hoy)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260722C00320000" })], NOW); // dte=0
    expect(isNearExpiration(rows[0])).toBe(true);
  });

  it("acepta justo en el borde (5 días)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260727C00320000" })], NOW); // dte=5
    expect(isNearExpiration(rows[0])).toBe(true);
  });

  it("rechaza vencimientos de más de 5 días (LEAPS/swing)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260729C00320000" })], NOW); // dte=7
    expect(isNearExpiration(rows[0])).toBe(false);
  });

  it("rechaza contratos ya vencidos", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260720C00320000" })], NOW); // dte=-2
    expect(isNearExpiration(rows[0])).toBe(false);
  });

  it("respeta un umbral custom", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260724C00320000" })], NOW); // dte=2
    expect(isNearExpiration(rows[0], 1)).toBe(false);
    expect(isNearExpiration(rows[0], 2)).toBe(true);
  });
});

describe("estimateTarget", () => {
  it("para un call, el target real queda ARRIBA del spot con >50% de convicción", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", delta: 0.4, implied_volatility: 0.5, asset_price: 310 })],
      NOW,
    ); // dte ≈ 24
    const result = estimateTarget(rows[0], 310);
    expect(result.target).not.toBeNull();
    expect(result.target!).toBeGreaterThan(310);
    expect(result.changePctToTarget!).toBeGreaterThan(0);
    expect(result.convictionPct!).toBeGreaterThan(50);
    expect(result.estUsdGain!).toBeGreaterThan(0);
  });

  it("para un put, el target real queda ABAJO del spot — no al revés de la apuesta", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815P00320000", delta: -0.4, implied_volatility: 0.5, asset_price: 328 })],
      NOW,
    );
    const result = estimateTarget(rows[0], 328);
    expect(result.target!).toBeLessThan(328);
    expect(result.changePctToTarget!).toBeLessThan(0);
    expect(result.convictionPct!).toBeGreaterThan(50);
  });

  it("a más IV/DTE, el target queda más lejos y la convicción baja", () => {
    const { rows: lowIv } = classifyFlow(
      [trade({ symbol: "TSLA260724C00320000", implied_volatility: 0.3, asset_price: 310 })], // dte=2
      NOW,
    );
    const { rows: highIv } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", implied_volatility: 1.2, asset_price: 310 })], // dte≈24
      NOW,
    );
    const low = estimateTarget(lowIv[0], 310);
    const high = estimateTarget(highIv[0], 310);
    expect(high.target!).toBeGreaterThan(low.target!);
    expect(high.convictionPct!).toBeLessThan(low.convictionPct!);
  });

  it("null sin spot (ni en vivo ni al momento del trade)", () => {
    const { rows } = classifyFlow([trade({ symbol: "TSLA260815C00320000" })], NOW);
    expect(estimateTarget(rows[0], null)).toEqual({
      target: null,
      convictionPct: null,
      changePctToTarget: null,
      estUsdGain: null,
    });
  });

  it("usa el precio del subyacente al momento del trade si no hay spot en vivo todavía", () => {
    const { rows } = classifyFlow(
      [trade({ symbol: "TSLA260815C00320000", asset_price: 310 })],
      NOW,
    );
    const result = estimateTarget(rows[0], null);
    expect(result.target).not.toBeNull();
    expect(result.target!).toBeGreaterThan(310);
  });
});
