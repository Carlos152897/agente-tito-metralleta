import { describe, expect, it } from "vitest";
import { findVolumeOiCandidates, findTopVolumeContract } from "./volumeOiScan";
import type { RawContract } from "./types";

function contract(overrides: Partial<RawContract> & { type?: "call" | "put"; strike?: number; expiration?: string; symbol?: string }): RawContract {
  const { type = "call", strike = 10, expiration = "2026-09-19", symbol = "TEST", ...rest } = overrides;
  return {
    day: { volume: 0 },
    open_interest: 0,
    details: { contract_type: type, strike_price: strike, expiration_date: expiration, ticker: symbol },
    ...rest,
  };
}

describe("findVolumeOiCandidates", () => {
  it("encuentra contratos con volumen >= 3x OI (default)", () => {
    const contracts = [
      contract({ symbol: "A", type: "call", day: { volume: 300 }, open_interest: 100 }), // 3x exacto
      contract({ symbol: "B", type: "put", day: { volume: 250 }, open_interest: 100 }), // 2.5x, no alcanza
      contract({ symbol: "C", type: "call", day: { volume: 1000 }, open_interest: 50 }), // 20x
    ];
    const found = findVolumeOiCandidates(contracts);
    expect(found.map((f) => f.symbol)).toEqual(["C", "A"]); // orden por ratio descendente
    expect(found[0].ratio).toBe(20);
  });

  it("descarta contratos sin Open Interest (ratio sin sentido)", () => {
    const contracts = [contract({ symbol: "A", day: { volume: 500 }, open_interest: 0 })];
    expect(findVolumeOiCandidates(contracts)).toEqual([]);
  });

  it("respeta un minRatio custom", () => {
    const contracts = [contract({ symbol: "A", day: { volume: 200 }, open_interest: 100 })]; // 2x
    expect(findVolumeOiCandidates(contracts, 3)).toEqual([]);
    expect(findVolumeOiCandidates(contracts, 2)).toHaveLength(1);
  });

  it("ignora contratos con datos incompletos (sin tipo/strike/vencimiento/símbolo)", () => {
    const contracts = [
      contract({ symbol: "A", day: { volume: 500 }, open_interest: 100, details: { contract_type: undefined, strike_price: 10, expiration_date: "2026-09-19", ticker: "A" } }),
    ];
    expect(findVolumeOiCandidates(contracts)).toEqual([]);
  });
});

describe("findTopVolumeContract", () => {
  it("el ejemplo real de Carlos: encuentra el contrato de mayor volumen del vencimiento objetivo", () => {
    const contracts = [
      contract({ symbol: "CRM_250C", type: "call", strike: 250, expiration: "2026-08-28", day: { volume: 5000 }, open_interest: 800 }),
      contract({ symbol: "CRM_240P", type: "put", strike: 240, expiration: "2026-08-28", day: { volume: 900 }, open_interest: 300 }),
      contract({ symbol: "CRM_260C", type: "call", strike: 260, expiration: "2026-09-19", day: { volume: 999999 }, open_interest: 5 }), // otro vencimiento, no cuenta
    ];
    const top = findTopVolumeContract(contracts, new Set(["2026-08-28"]));
    expect(top).toMatchObject({ symbol: "CRM_250C", type: "call", strike: 250, expiration: "2026-08-28", volume: 5000 });
  });

  it("ignora vencimientos fuera del set dado", () => {
    const contracts = [contract({ symbol: "A", expiration: "2026-09-19", day: { volume: 1000 } })];
    expect(findTopVolumeContract(contracts, new Set(["2026-08-28"]))).toBeNull();
  });

  it("sin volumen real en ningún contrato del vencimiento, devuelve null", () => {
    const contracts = [contract({ symbol: "A", expiration: "2026-08-28", day: { volume: 0 } })];
    expect(findTopVolumeContract(contracts, new Set(["2026-08-28"]))).toBeNull();
  });
});
