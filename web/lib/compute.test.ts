import { describe, expect, it } from "vitest";
import {
  contractPrice,
  countExpirations,
  notionalValue,
  openPremium,
  sortByOpenInterestDesc,
  toRow,
} from "./compute";
import type { RawContract, Row } from "./types";

describe("contractPrice", () => {
  it("prefiere last_trade.price", () => {
    const raw: RawContract = {
      last_trade: { price: 1.25 },
      day: { close: 1.1, vwap: 1.05 },
    };
    expect(contractPrice(raw)).toEqual({ price: 1.25, source: "last_trade" });
  });

  it("cae a day.close cuando no hay last_trade", () => {
    const raw: RawContract = { day: { close: 1.1, vwap: 1.05 } };
    expect(contractPrice(raw)).toEqual({ price: 1.1, source: "day_close" });
  });

  it("cae a day.vwap cuando no hay last_trade ni close", () => {
    const raw: RawContract = { day: { vwap: 1.05 } };
    expect(contractPrice(raw)).toEqual({ price: 1.05, source: "day_vwap" });
  });

  it("devuelve null cuando no hay ningún precio", () => {
    expect(contractPrice({})).toEqual({ price: null, source: "none" });
  });

  it("ignora precios no positivos", () => {
    const raw: RawContract = { last_trade: { price: 0 }, day: { close: 2 } };
    expect(contractPrice(raw)).toEqual({ price: 2, source: "day_close" });
  });
});

describe("openPremium", () => {
  it("OI × precio", () => {
    expect(openPremium(60, 1.25)).toBe(75);
  });
  it("null si no hay precio", () => {
    expect(openPremium(60, null)).toBeNull();
  });
});

describe("notionalValue", () => {
  it("OI × 100 × strike", () => {
    expect(notionalValue(60, 205)).toBe(60 * 100 * 205);
  });
  it("respeta shares_per_contract distinto de 100", () => {
    expect(notionalValue(10, 50, 10)).toBe(10 * 10 * 50);
  });
});

describe("toRow", () => {
  it("mapea un contrato crudo de Massive", () => {
    const raw: RawContract = {
      details: {
        contract_type: "call",
        expiration_date: "2026-07-22",
        strike_price: 205,
        shares_per_contract: 100,
        ticker: "O:AAPL260722C00205000",
      },
      day: { volume: 81, close: 119.28 },
      last_trade: { price: 119.28 },
      open_interest: 60,
    };
    const row = toRow(raw);
    expect(row.contractType).toBe("call");
    expect(row.strike).toBe(205);
    expect(row.openInterest).toBe(60);
    expect(row.volume).toBe(81);
    expect(row.price).toBe(119.28);
    expect(row.priceSource).toBe("last_trade");
    expect(row.openPremium).toBeCloseTo(60 * 119.28);
    expect(row.notionalValue).toBe(60 * 100 * 205);
  });

  it("trata contract_type ausente como call y campos faltantes como 0", () => {
    const row = toRow({});
    expect(row.contractType).toBe("call");
    expect(row.openInterest).toBe(0);
    expect(row.notionalValue).toBe(0);
    expect(row.openPremium).toBeNull();
  });
});

describe("sortByOpenInterestDesc", () => {
  it("ordena de mayor a menor OI sin mutar el original", () => {
    const rows = [
      { openInterest: 5 },
      { openInterest: 100 },
      { openInterest: 27 },
    ] as Row[];
    const sorted = sortByOpenInterestDesc(rows);
    expect(sorted.map((r) => r.openInterest)).toEqual([100, 27, 5]);
    expect(rows[0].openInterest).toBe(5); // original intacto
  });
});

describe("countExpirations", () => {
  it("cuenta vencimientos distintos", () => {
    const rows = [
      { expiration: "2026-07-22" },
      { expiration: "2026-07-22" },
      { expiration: "2026-08-21" },
      { expiration: "" },
    ] as Row[];
    expect(countExpirations(rows)).toBe(2);
  });
});
