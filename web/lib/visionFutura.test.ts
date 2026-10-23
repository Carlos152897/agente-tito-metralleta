import { describe, expect, it } from "vitest";
import { buildVisionFutura, convertLevel, yearsToExpiry } from "./visionFutura";
import type { ExtendedChainContract, GexStatsBucket } from "./spxLevels";

function contract(strike: number, type: "call" | "put", opts: { oi?: number; gamma?: number; ask?: number; bid?: number; volume?: number } = {}): ExtendedChainContract {
  return {
    symbol: `SPXW${strike}${type[0].toUpperCase()}`,
    strike, type, expiration: "2026-10-22",
    open_interest: opts.oi ?? 100,
    volume: opts.volume ?? 10,
    price: 1,
    greeks: { delta: 0.5, gamma: opts.gamma ?? 0.01, theta: 0, vega: 0 },
    implied_volatility: 0.15,
    premium_breakdown: { bid: opts.bid ?? 0, mid: 0, ask: opts.ask ?? 0 },
  };
}

const gexStats: GexStatsBucket = {
  t: "2026-10-22T15:00:00Z", net_gex: 1e9, call_wall: 7020, put_wall: 6980,
  magnet: 7010, max_pain: 7000, gamma_flip: 6990, asset_price: 7000,
};

describe("convertLevel", () => {
  it("usa ratio para SPY y base para /ES", () => {
    expect(convertLevel(7000, { spyRatio: 0.1, esBasis: 40 })).toEqual({ spx: 7000, spy: 700, es: 7040 });
    expect(convertLevel(7000, { spyRatio: null, esBasis: null })).toEqual({ spx: 7000, spy: null, es: null });
  });
});

describe("buildVisionFutura", () => {
  const contracts = [
    contract(7020, "call", { oi: 5000, bid: 900_000 }), // público vende calls arriba → dealers largos → resistencia
    contract(7010, "call", { oi: 100, ask: 800_000 }), // público compra calls → dealers cortos → acelera arriba
    contract(6980, "put", { oi: 5000, bid: 700_000 }), // público vende puts abajo → piso
    contract(6990, "put", { oi: 9000, ask: 600_000 }), // público compra puts → acelera abajo, imán negativo
  ];
  const r = buildVisionFutura({
    contracts, spot: 7000, gexStats, spy: 700, es: 7030,
    vix: { last: 15.87, prevClose: 15, changePct: 5.8 },
  });

  it("convierte el spot", () => {
    expect(r.spot).toEqual({ spx: 7000, spy: 700, es: 7030 });
  });

  it("marca Magneto, imanes y paredes", () => {
    const kinds = Object.fromEntries(r.keyLevels.map((k) => [k.label, k.spx]));
    expect(kinds["Magneto"]).toBe(7010);
    expect(kinds["Imán positivo"]).toBe(7020);
    expect(kinds["Imán negativo"]).toBe(6990);
    expect(kinds["Resistencia (Call Wall)"]).toBe(7020);
    expect(kinds["Piso (Put Wall)"]).toBe(6980);
  });

  it("lee el rol de los dealers por el flujo", () => {
    const role = (s: number) => r.rows.find((x) => x.spx === s)?.dealerRole;
    expect(role(7020)).toBe("resistencia");
    expect(role(7010)).toBe("acelera_arriba");
    expect(role(6980)).toBe("piso");
    expect(role(6990)).toBe("acelera_abajo");
    expect(r.rows.find((x) => x.spx === 7020)?.dealerCalls).toBe("compran");
    expect(r.rows.find((x) => x.spx === 7010)?.dealerCalls).toBe("venden");
  });

  it("rango esperado por VIX ≈ spot × VIX/√252", () => {
    expect(r.expectedMove?.points).toBeCloseTo(7000 * 0.1587 / Math.sqrt(252), 5);
    expect(r.regime).toBe("positivo");
  });
});

describe("charm", () => {
  it("yearsToExpiry: 2 horas antes del cierre en horario de verano", () => {
    const T = yearsToExpiry("2026-10-22", new Date("2026-10-22T18:00:00Z")); // 14:00 ET
    expect(T * 365 * 24).toBeCloseTo(2, 5);
  });

  it("marca Charm + y Charm − y la suma neta", () => {
    const withIv = (strike: number, type: "call" | "put", oi: number) => ({ ...contract(strike, type, { oi }), implied_volatility: 0.2 });
    const cs = [withIv(7010, "call", 100), withIv(7030, "call", 20_000), withIv(6990, "put", 100), withIv(7020, "put", 30_000)];
    const T = 2 / (365 * 24);
    const r = buildVisionFutura({ contracts: cs, spot: 7000, gexStats, spy: null, es: null, vix: null, yearsToExpiry: T });
    const charm = Object.fromEntries(r.keyLevels.filter((k) => k.kind === "charm").map((k) => [k.label, k.spx]));
    // OTM pierde delta con el tiempo (charm < 0 en calls), el put ITM de 7020 da exposición positiva.
    const byCharm = [...r.rows].sort((a, b) => b.charm - a.charm);
    expect(byCharm[0].charm).toBeGreaterThan(0);
    expect(byCharm.at(-1)!.charm).toBeLessThan(0);
    expect(charm["Charm +"]).toBe(byCharm[0].spx);
    expect(charm["Charm −"]).toBe(byCharm.at(-1)!.spx);
    const sum = r.rows.reduce((a, x) => a + x.charm, 0);
    expect(r.netCharm).toBeCloseTo(sum, 0);
  });
});
