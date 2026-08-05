import { describe, expect, it } from "vitest";
import {
  buildSpxLevelsTable,
  computeStrikeGex,
  topByVolume,
  toStrikePremiumsFromExtendedChain,
  type ExtendedChainContract,
  type GexStatsBucket,
} from "./spxLevels";

function contract(overrides: Partial<ExtendedChainContract>): ExtendedChainContract {
  return {
    symbol: "SPXW260730C07300000",
    strike: 7300,
    type: "call",
    expiration: "2026-07-30",
    open_interest: 1000,
    volume: 100,
    price: 10,
    greeks: { delta: 0.5, gamma: 0.002, theta: -5, vega: 1 },
    implied_volatility: 0.25,
    premium_breakdown: { bid: 100_000, mid: 50_000, ask: 200_000 },
    ...overrides,
  };
}

function contractAt(
  strike: number,
  type: "call" | "put",
  opts: { ask: number; bid: number; gamma?: number; oi?: number },
): ExtendedChainContract {
  return contract({
    strike, type,
    symbol: `SPXW260730${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
    open_interest: opts.oi ?? 100,
    greeks: { delta: 0, gamma: opts.gamma ?? 0.001, theta: 0, vega: 0 },
    premium_breakdown: { bid: opts.bid, mid: 0, ask: opts.ask },
  });
}

describe("toStrikePremiumsFromExtendedChain", () => {
  it("agrupa por strike; net premium = ask - bid de premium_breakdown", () => {
    const contracts = [
      contractAt(310, "call", { ask: 500, bid: 200 }),
      contractAt(310, "put", { ask: 100, bid: 400 }),
    ];
    const result = toStrikePremiumsFromExtendedChain(contracts);
    const level = result.get(310)!;
    expect(level.call?.netPremium).toBe(300);
    expect(level.put?.netPremium).toBe(-300);
  });
});

describe("computeStrikeGex", () => {
  it("misma fórmula que gexHeatmap.ts: gamma·OI·100·spot²·0.01, calls suman, puts restan del neto", () => {
    const contracts = [
      contract({ strike: 100, type: "call", open_interest: 1, greeks: { delta: 0, gamma: 1, theta: 0, vega: 0 } }),
      contract({ strike: 100, type: "put", open_interest: 1, greeks: { delta: 0, gamma: 1, theta: 0, vega: 0 } }),
    ];
    // gamma(1) * OI(1) * 100 * spot(10)² * 0.01 = 100 por lado
    const result = computeStrikeGex(contracts, 10);
    expect(result.get(100)).toEqual({ callGex: 100, putGex: 100, netGex: 0 });
  });

  it("ignora contratos sin open interest o sin gamma real", () => {
    const contracts = [
      contract({ strike: 100, open_interest: 0 }),
      contract({ strike: 105, greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 } }),
    ];
    expect(computeStrikeGex(contracts, 10).size).toBe(0);
  });
});

describe("buildSpxLevelsTable", () => {
  it("detecta el flip arriba y abajo del spot, y clasifica piso/techo/soporte/resistencia", () => {
    const spot = 310;
    const contracts = [
      contractAt(315, "call", { ask: 1_000_000, bid: 0 }),
      contractAt(315, "put", { ask: 0, bid: 0 }),
      contractAt(320, "call", { ask: 0, bid: 0 }),
      contractAt(320, "put", { ask: 1_000_000, bid: 0 }), // voltea a puts -> resistencia en 320
      contractAt(305, "put", { ask: 1_000_000, bid: 0 }),
      contractAt(305, "call", { ask: 0, bid: 0 }),
      contractAt(300, "put", { ask: 0, bid: 0 }),
      contractAt(300, "call", { ask: 1_000_000, bid: 0 }), // voltea a calls -> soporte en 300
    ];
    const rows = buildSpxLevelsTable({ contracts, spot, gexStats: null });
    const byStrike = new Map(rows.map((r) => [r.strike, r]));
    expect(byStrike.get(315)?.lectura).toMatch(/Techo/);
    expect(byStrike.get(320)?.lectura).toMatch(/Resistencia/);
    expect(byStrike.get(305)?.lectura).toMatch(/Piso/);
    expect(byStrike.get(300)?.lectura).toMatch(/Soporte/);
  });

  it("marca 'imán' en los strikes más allá del nivel de flip", () => {
    const spot = 310;
    const contracts = [
      contractAt(315, "call", { ask: 1_000_000, bid: 0 }),
      contractAt(315, "put", { ask: 0, bid: 0 }),
      contractAt(320, "call", { ask: 0, bid: 0 }),
      contractAt(320, "put", { ask: 1_000_000, bid: 0 }), // flip en 320
      contractAt(325, "call", { ask: 0, bid: 0 }),
      contractAt(325, "put", { ask: 1_000_000, bid: 0 }), // más allá del flip, puts siguen dominando
    ];
    const rows = buildSpxLevelsTable({ contracts, spot, gexStats: null });
    expect(rows.find((r) => r.strike === 325)?.lectura).toMatch(/Imán/);
  });

  it("marca confluencia cuando el GEX real coincide con el lado dominante de net premium", () => {
    const spot = 310;
    const contracts = [
      contractAt(315, "call", { ask: 1_000_000, bid: 0, gamma: 0.01, oi: 1000 }),
      contractAt(315, "put", { ask: 0, bid: 0, gamma: 0.0001, oi: 1 }),
    ];
    const row = buildSpxLevelsTable({ contracts, spot, gexStats: null }).find((r) => r.strike === 315)!;
    expect(row.dominant).toBe("call");
    expect(row.netGex).toBeGreaterThan(0);
    expect(row.confluence).toBe(true);
    expect(row.conflict).toBe(false);
  });

  it("marca conflicto cuando el net premium y el GEX real apuntan a lados contrarios", () => {
    const spot = 310;
    const contracts = [
      contractAt(315, "call", { ask: 1_000_000, bid: 0, gamma: 0.0001, oi: 1 }), // net premium: calls
      contractAt(315, "put", { ask: 0, bid: 0, gamma: 0.01, oi: 1000 }),          // gamma real: puts
    ];
    const row = buildSpxLevelsTable({ contracts, spot, gexStats: null }).find((r) => r.strike === 315)!;
    expect(row.dominant).toBe("call");
    expect(row.netGex).toBeLessThan(0);
    expect(row.conflict).toBe(true);
    expect(row.lectura).toMatch(/conflicto/);
  });

  it("marca el badge de call_wall/put_wall cuando el strike coincide con el nivel de MarketSnack", () => {
    const spot = 310;
    const contracts = [contractAt(320, "call", { ask: 1, bid: 0 }), contractAt(320, "put", { ask: 0, bid: 0 })];
    const gexStats: GexStatsBucket = {
      t: "", net_gex: 0, call_wall: 320, put_wall: 300, magnet: 310, max_pain: 310, gamma_flip: 305, asset_price: 310,
    };
    const rows = buildSpxLevelsTable({ contracts, spot, gexStats });
    expect(rows.find((r) => r.strike === 320)?.badge).toBe("call_wall");
  });

  it("filtra strikes fuera del radio (default $25)", () => {
    const spot = 310;
    const contracts = [contractAt(340, "call", { ask: 1, bid: 0 }), contractAt(340, "put", { ask: 0, bid: 0 })];
    expect(buildSpxLevelsTable({ contracts, spot, gexStats: null })).toHaveLength(0);
  });
});

describe("topByVolume", () => {
  it("ordena por volumen desc y separa call/put por lado, top 10 cada uno", () => {
    const contracts = [
      contract({ strike: 300, type: "call", volume: 50 }),
      contract({ strike: 305, type: "call", volume: 500 }),
      contract({ strike: 310, type: "call", volume: 200 }),
      contract({ strike: 300, type: "put", volume: 90 }),
      contract({ strike: 305, type: "put", volume: 900 }),
    ];
    const { calls, puts } = topByVolume(contracts, 2);
    expect(calls.map((c) => c.strike)).toEqual([305, 310]); // 500, 200 desc, top 2
    expect(calls.every((c) => c.type === "call")).toBe(true);
    expect(puts.map((p) => p.strike)).toEqual([305, 300]); // 900, 90 desc
  });

  it("netPremium = ask - bid de premium_breakdown, igual convención que ContractPremiumSummary", () => {
    const contracts = [contractAt(300, "call", { ask: 500, bid: 200 })];
    const { calls } = topByVolume(contracts);
    expect(calls[0].netPremium).toBe(300);
  });

  it("dominantSideHere refleja quién domina en ESE strike (call vs put), no el volumen", () => {
    const contracts = [
      contractAt(300, "call", { ask: 1_000_000, bid: 0 }),
      contractAt(300, "put", { ask: 0, bid: 0 }),
    ];
    const { calls } = topByVolume(contracts);
    expect(calls[0].dominantSideHere).toBe("call");
  });

  it("listas vacías si no hay contratos de ese lado", () => {
    const contracts = [contractAt(300, "call", { ask: 1, bid: 0 })];
    const { puts } = topByVolume(contracts);
    expect(puts).toEqual([]);
  });
});
