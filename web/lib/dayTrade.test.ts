import { describe, expect, it } from "vitest";
import type { Row } from "./types";
import type { RawTrade } from "./flow";
import type { GexAnalysis } from "./gex";
import type { ContractPremiumSummary, StrikePremiums } from "./neighborContracts";
import { latestTradeAssetPrice, maxDteFor, resolveLiveSpot, suggestDayTradeContract } from "./dayTrade";

const NOW = new Date("2026-07-22T15:00:00Z"); // ~11:00 ET, mercado abierto

function row(overrides: Partial<Row>): Row {
  return {
    optionTicker: "TSLA260723C00310000",
    contractType: "call",
    expiration: "2026-07-23",
    strike: 310,
    openInterest: 500,
    volume: 100,
    price: 5,
    priceSource: "last_trade",
    openPremium: 2500,
    notionalValue: 310 * 100 * 500,
    ...overrides,
  };
}

function chainAround(spot: number, strikes: number[], expiration = "2026-07-23"): Row[] {
  const rows: Row[] = [];
  for (const strike of strikes) {
    rows.push(row({ optionTicker: `TSLA260723C00${String(strike * 1000).padStart(6, "0")}`, contractType: "call", strike, expiration }));
    rows.push(row({ optionTicker: `TSLA260723P00${String(strike * 1000).padStart(6, "0")}`, contractType: "put", strike, expiration }));
  }
  return rows;
}

function trade(overrides: Partial<RawTrade>): RawTrade {
  return {
    id: 1,
    symbol: "TSLA260723C00315000",
    price: 5,
    size: 500,
    side: "ASKSIDE",
    bid_price: 4.9,
    ask_price: 5.1,
    premium: 250_000,
    delta: 0.4,
    implied_volatility: 0.5,
    open_interest: 100,
    volume: 500,
    score: 50,
    sentiment: "bullish",
    timestamp: "2026-07-22T14:00:00Z",
    ...overrides,
  };
}

function gex(overrides: Partial<GexAnalysis>): GexAnalysis {
  return {
    spot: 310,
    iv: 0.5,
    nodes: [],
    kingStrike: 320,
    flipStrike: null,
    regime: "positive",
    totalNetGex: 0,
    direction: "up",
    confidence: 70,
    lowLiquidity: false,
    n: 5,
    ...overrides,
  };
}

/** Net premium de un solo lado (call o put) para las fixtures de abajo. */
function premiumOf(netPremium: number): ContractPremiumSummary {
  return {
    netPremium,
    askPremium: Math.max(netPremium, 0),
    bidPremium: Math.max(-netPremium, 0),
    askVolume: 0,
    bidVolume: 0,
  };
}

/** Arma el `strikePremiums` que espera `suggestDayTradeContract` a partir de
 *  net premium de call/put por strike — `undefined` = sin contrato/sin trades hoy. */
function strikePremiumsFixture(
  entries: Array<{ strike: number; callNet?: number; putNet?: number }>,
): Map<number, StrikePremiums> {
  const map = new Map<number, StrikePremiums>();
  for (const e of entries) {
    map.set(e.strike, {
      strike: e.strike,
      call: e.callNet != null ? premiumOf(e.callNet) : null,
      put: e.putNet != null ? premiumOf(e.putNet) : null,
    });
  }
  return map;
}

describe("latestTradeAssetPrice", () => {
  it("toma el asset_price del trade más reciente por timestamp, no el último del array", () => {
    const trades = [
      trade({ timestamp: "2026-07-22T14:00:00Z", asset_price: 300 }),
      trade({ timestamp: "2026-07-22T14:05:00Z", asset_price: 305.87 }), // el más reciente, en medio del array
      trade({ timestamp: "2026-07-22T14:02:00Z", asset_price: 302 }),
    ];
    expect(latestTradeAssetPrice(trades)).toBe(305.87);
  });

  it("ignora trades sin asset_price o con valor no positivo", () => {
    const trades = [
      trade({ timestamp: "2026-07-22T14:05:00Z", asset_price: undefined }),
      trade({ timestamp: "2026-07-22T14:06:00Z", asset_price: 0 }),
      trade({ timestamp: "2026-07-22T14:00:00Z", asset_price: 300 }),
    ];
    expect(latestTradeAssetPrice(trades)).toBe(300);
  });

  it("null sin trades con asset_price válido", () => {
    expect(latestTradeAssetPrice([])).toBeNull();
    expect(latestTradeAssetPrice([trade({ asset_price: undefined })])).toBeNull();
  });
});

describe("resolveLiveSpot", () => {
  it("prefiere el precio del activo de MarketSnack (mismo dato que su UI, resuelve solo pre-market/after-hours)", () => {
    expect(resolveLiveSpot({
      assetPrice: 304.44, companyPrice: 298.32, chainUnderlyingPrice: 300,
      trades: [trade({ asset_price: 298.32 })], lastDailyClose: 290,
    })).toBe(304.44);
  });

  it("cae al trade más reciente de MarketSnack si no hay precio de activo", () => {
    expect(resolveLiveSpot({
      assetPrice: null, companyPrice: 298.32, chainUnderlyingPrice: 300,
      trades: [trade({ asset_price: 304.67 })], lastDailyClose: 290,
    })).toBe(304.67);
  });

  it("cae al precio de la acción de Massive si no hay ni precio de activo ni trades de MarketSnack", () => {
    expect(resolveLiveSpot({
      assetPrice: null, companyPrice: 309.22, chainUnderlyingPrice: 310, trades: [], lastDailyClose: 300,
    })).toBe(309.22);
  });

  it("cae al precio embebido en la cadena si no queda ninguna fuente de MarketSnack ni de Massive (el bug real de TSLA)", () => {
    expect(resolveLiveSpot({
      assetPrice: null, companyPrice: null, chainUnderlyingPrice: 310, trades: [], lastDailyClose: 300,
    })).toBe(310);
  });

  it("cae al cierre diario solo si no queda ninguna otra fuente", () => {
    expect(resolveLiveSpot({
      assetPrice: null, companyPrice: null, chainUnderlyingPrice: null, trades: [], lastDailyClose: 300,
    })).toBe(300);
  });

  it("null si no hay ninguna fuente", () => {
    expect(resolveLiveSpot({
      assetPrice: null, companyPrice: null, chainUnderlyingPrice: null, trades: [], lastDailyClose: null,
    })).toBeNull();
  });
});

describe("suggestDayTradeContract", () => {
  const chainRows = chainAround(310, [300, 305, 310, 315, 320, 325]);

  // Calls dominan en 310 y 315, voltea a puts en 320 — soporte/resistencia en
  // $320, target = último strike que confirmó antes del volteo ($315).
  const callWalkFlipsAt320 = strikePremiumsFixture([
    { strike: 310, callNet: 1000, putNet: 0 },
    { strike: 315, callNet: 1000, putNet: 0 },
    { strike: 320, callNet: 0, putNet: 1000 },
  ]);

  it("sin dirección clara del GEX y sin desequilibrio real en el centro → null (ante la duda, no operar)", () => {
    expect(
      suggestDayTradeContract({
        ticker: "TSLA", spot: 310, chainRows, strikePremiums: new Map(),
        gex: gex({ direction: "flat", kingStrike: null }), now: NOW,
      }),
    ).toBeNull();
    expect(
      suggestDayTradeContract({
        ticker: "TSLA", spot: 310, chainRows, strikePremiums: new Map(), gex: gex({ direction: null }), now: NOW,
      }),
    ).toBeNull();
  });

  it("confirma con net premium real (role continuation) cuando domina un lado en el strike central", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result?.role).toBe("continuation");
    expect(result?.type).toBe("call");
    expect(result?.strike).toBe(315);
    expect(result?.target).toBe(315);
    expect(result?.reversalWarning).toBeNull();
  });

  it("cae a gex_only con un target REALISTA (el vecino inmediato, no el kingStrike lejano)", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: new Map(), gex: gex({}), now: NOW, // kingStrike=320
    });
    expect(result).not.toBeNull();
    expect(result?.role).toBe("gex_only");
    expect(result?.type).toBe("call");
    expect(result?.strike).toBe(315); // vecino inmediato hacia arriba, no el 320 del kingStrike
    expect(result?.target).toBe(315);
  });

  it("marca advertencia de reversión cuando la dominancia voltea en el primer vecino (poco recorrido)", () => {
    const flipsImmediately = strikePremiumsFixture([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 0, putNet: 1000 }, // voltea apenas un strike más allá del centro
    ]);
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: flipsImmediately, gex: gex({}), now: NOW,
    });
    expect(result?.role).toBe("continuation");
    expect(result?.strike).toBe(310);
    expect(result?.reversalWarning).not.toBeNull();
  });

  it("el reason cita el strike real donde voltea la dominancia", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result?.reason).toMatch(/\$320/);
    expect(result?.reason).toMatch(/\$315/);
  });

  it("occRoot igual al ticker cuando la raíz OCC del contrato coincide (TSLA)", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result?.occRoot).toBe("TSLA");
  });

  it("occRoot usa la raíz OCC real del contrato cuando difiere del ticker (SPX cotiza bajo SPXW)", () => {
    // SPX es 0DTE (maxDteFor) — la cadena tiene que vencer HOY (misma fecha que NOW) o el
    // filtro de DTE la descarta antes de llegar a resolver el occRoot.
    const spxChain = chainAround(310, [310, 315, 320], "2026-07-22").map((r) => ({
      ...r, optionTicker: `O:${r.optionTicker.replace(/^TSLA/, "SPXW")}`,
    }));
    const result = suggestDayTradeContract({
      ticker: "SPX", spot: 310, chainRows: spxChain, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result?.ticker).toBe("SPX");
    expect(result?.occRoot).toBe("SPXW");
  });

  it("sin gex (TSLA, pedido de Carlos): sigue confirmando con net premium real, sin necesitar GEX", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: callWalkFlipsAt320, now: NOW, // sin campo gex
    });
    expect(result?.role).toBe("continuation");
    expect(result?.strike).toBe(315);
  });

  it("sin gex y sin desequilibrio real en el centro → null (no cae a un fallback gex_only)", () => {
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows, strikePremiums: new Map(), now: NOW, // sin campo gex
    });
    expect(result).toBeNull();
  });

  it("maxDteFor: SPX es 0DTE, el resto (TSLA) mantiene la ventana de 5 días", () => {
    expect(maxDteFor("SPX")).toBe(0);
    expect(maxDteFor("TSLA")).toBe(5);
  });

  it("SPX con contratos que vencen mañana (no 0DTE) → null, aunque el mismo flujo confirmaría para TSLA", () => {
    const tomorrowChain = chainAround(310, [300, 305, 310, 315, 320, 325], "2026-07-23"); // NOW es 2026-07-22
    const result = suggestDayTradeContract({
      ticker: "SPX", spot: 310, chainRows: tomorrowChain, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result).toBeNull();
  });

  it("TSLA sigue resolviendo con contratos de hasta 5 DTE (el default no se achicó al agregar el 0DTE de SPX)", () => {
    const fiveDteChain = chainAround(310, [300, 305, 310, 315, 320, 325], "2026-07-27"); // NOW+5 días
    const result = suggestDayTradeContract({
      ticker: "TSLA", spot: 310, chainRows: fiveDteChain, strikePremiums: callWalkFlipsAt320, gex: gex({}), now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result?.role).toBe("continuation");
  });
});
