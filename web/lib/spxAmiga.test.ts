import { describe, expect, it } from "vitest";
import type { ExtendedChainContract } from "./spxLevels";
import {
  buildSpxAmigaBoard,
  buildStrikeLadder,
  buildVerticalSpread,
  computeCloseScenarios,
  computeFiveMinuteRead,
  computeGexLite,
  computeMoneyFlow,
  resolveAtmIv,
  suggestBestTrade,
  verdictFromRegime,
  yearsFromMinutes,
} from "./spxAmiga";

function contract(params: {
  strike: number;
  type: "call" | "put";
  openInterest?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  iv?: number | null;
  bid?: number;
  mid?: number;
  ask?: number;
}): ExtendedChainContract {
  return {
    symbol: `SPXW260804${params.type === "call" ? "C" : "P"}${params.strike}`,
    strike: params.strike,
    type: params.type,
    expiration: "2026-08-04",
    open_interest: params.openInterest ?? 0,
    volume: params.volume ?? 0,
    price: null,
    greeks: { delta: params.delta ?? 0, gamma: params.gamma ?? 0, theta: 0, vega: 0 },
    implied_volatility: params.iv ?? null,
    premium_breakdown: { bid: params.bid ?? 0, mid: params.mid ?? 0, ask: params.ask ?? 0 },
  };
}

describe("buildStrikeLadder", () => {
  it("top N por volumen, separado calls/puts", () => {
    const contracts = [
      contract({ strike: 300, type: "call", volume: 500 }),
      contract({ strike: 305, type: "call", volume: 900 }),
      contract({ strike: 310, type: "call", volume: 100 }),
      contract({ strike: 300, type: "put", volume: 200 }),
      contract({ strike: 305, type: "put", volume: 800 }),
    ];
    const ladder = buildStrikeLadder(contracts, 2);
    expect(ladder.calls.map((r) => r.strike)).toEqual([305, 300]);
    expect(ladder.puts.map((r) => r.strike)).toEqual([305, 300]);
  });

  it("agresor: >=60% al ask = compra, <=40% = venta, si no mixto", () => {
    const contracts = [
      contract({ strike: 300, type: "call", volume: 1, ask: 70, bid: 30 }),
      contract({ strike: 305, type: "call", volume: 1, ask: 30, bid: 70 }),
      contract({ strike: 310, type: "call", volume: 1, ask: 50, bid: 50 }),
      contract({ strike: 315, type: "call", volume: 1, ask: 60, bid: 40 }),
      contract({ strike: 320, type: "call", volume: 1, ask: 40, bid: 60 }),
    ];
    const ladder = buildStrikeLadder(contracts, 10);
    const byStrike = new Map(ladder.calls.map((r) => [r.strike, r.aggressor]));
    expect(byStrike.get(300)).toBe("compra");
    expect(byStrike.get(305)).toBe("venta");
    expect(byStrike.get(310)).toBe("mixto");
    expect(byStrike.get(315)).toBe("compra"); // 60% exacto, límite inclusive
    expect(byStrike.get(320)).toBe("venta"); // 40% exacto, límite inclusive
  });

  it("netPremium = ask - bid, delta/OI pasan directo del contrato", () => {
    const contracts = [contract({ strike: 300, type: "call", volume: 1, ask: 100, bid: 40, delta: 0.55, openInterest: 2000 })];
    const row = buildStrikeLadder(contracts, 10).calls[0];
    expect(row.netPremium).toBe(60);
    expect(row.delta).toBe(0.55);
    expect(row.openInterest).toBe(2000);
  });
});

describe("computeGexLite", () => {
  // spot=310, spot²=96100 -> gex = gamma*OI*961
  const contracts = [
    contract({ strike: 300, type: "call", gamma: 0.001, openInterest: 100 }),
    contract({ strike: 300, type: "put", gamma: 0.02, openInterest: 100 }),
    contract({ strike: 305, type: "call", gamma: 0.01, openInterest: 100 }),
    contract({ strike: 305, type: "put", gamma: 0.005, openInterest: 100 }),
    contract({ strike: 310, type: "call", gamma: 0.01, openInterest: 200 }),
    contract({ strike: 310, type: "put", gamma: 0.01, openInterest: 200 }),
    contract({ strike: 315, type: "call", gamma: 0.03, openInterest: 300 }),
    contract({ strike: 320, type: "call", gamma: 0.005, openInterest: 100 }),
    contract({ strike: 320, type: "put", gamma: 0.002, openInterest: 100 }),
  ];

  it("imán = strike de mayor |GEX neto|", () => {
    const result = computeGexLite(contracts, 310);
    expect(result.magnet).toBe(315);
  });

  it("flip = cruce de signo más cercano al spot (interpolado)", () => {
    const result = computeGexLite(contracts, 310);
    // único cruce real: 300 (negativo) -> 305 (positivo); 310 es tie (0, se
    // salta), 315/320 no cruzan (ambos positivos).
    expect(result.flip).toBeCloseTo(303.96, 1);
  });

  it("régimen = signo del GEX neto total", () => {
    const result = computeGexLite(contracts, 310);
    expect(result.totalNetGex).toBeGreaterThan(0);
    expect(result.regime).toBe("positivo");
  });

  it("ignora strikes fuera del radio y sin OI/gamma", () => {
    const wide = [
      ...contracts,
      contract({ strike: 400, type: "call", gamma: 1, openInterest: 999999 }), // fuera de ±25
      contract({ strike: 310, type: "call", gamma: 0, openInterest: 500 }), // gamma 0, se ignora
    ];
    const result = computeGexLite(wide, 310, 25);
    expect(result.levels.find((l) => l.strike === 400)).toBeUndefined();
  });

  it("vacío sin contratos válidos", () => {
    expect(computeGexLite([], 310)).toEqual({ levels: [], magnet: null, flip: null, regime: null, totalNetGex: 0 });
  });
});

describe("resolveAtmIv", () => {
  it("elige el strike más cercano al spot y promedia call/put", () => {
    const contracts = [
      contract({ strike: 305, type: "call", iv: 0.3 }),
      contract({ strike: 305, type: "put", iv: 0.5 }),
      contract({ strike: 320, type: "call", iv: 0.9 }),
    ];
    const atm = resolveAtmIv(contracts, 306);
    expect(atm?.strike).toBe(305);
    expect(atm?.iv).toBeCloseTo(0.4, 6);
  });

  it("usa un solo lado si el otro no tiene IV real", () => {
    const contracts = [contract({ strike: 305, type: "call", iv: 0.33 })];
    expect(resolveAtmIv(contracts, 305)?.iv).toBeCloseTo(0.33, 6);
  });

  it("null sin ninguna IV real", () => {
    expect(resolveAtmIv([contract({ strike: 305, type: "call", iv: null })], 305)).toBeNull();
  });
});

describe("yearsFromMinutes", () => {
  it("convierte minutos a años sobre 365 días, nunca negativo", () => {
    expect(yearsFromMinutes(60 * 24 * 365)).toBeCloseTo(1, 9);
    expect(yearsFromMinutes(-10)).toBe(0);
  });
});

describe("computeFiveMinuteRead", () => {
  it("rango ±1σ centrado en el spot (simétrico en log), charm/vanna finitos", () => {
    const read = computeFiveMinuteRead({
      spot: 310, atmIv: 0.25, atmStrike: 310, magnet: 315, minutesToClose: 180,
    });
    expect(read.rangeLow).toBeLessThan(310);
    expect(read.rangeHigh).toBeGreaterThan(310);
    expect(read.rangeLow * read.rangeHigh).toBeCloseTo(310 * 310, 0);
    expect(Number.isFinite(read.charm)).toBe(true);
    expect(Number.isFinite(read.vanna)).toBe(true);
    expect(read.narrative).toContain("315");
  });

  it("narrativa dice 'sin imán claro' cuando magnet es null", () => {
    const read = computeFiveMinuteRead({ spot: 310, atmIv: 0.25, atmStrike: 310, magnet: null, minutesToClose: 180 });
    expect(read.narrative).toContain("sin imán claro");
  });
});

describe("computeMoneyFlow", () => {
  it("sesgo calls con >=55% del premium al ask", () => {
    const contracts = [
      contract({ strike: 300, type: "call", ask: 700 }),
      contract({ strike: 300, type: "put", ask: 300 }),
    ];
    const flow = computeMoneyFlow(contracts);
    expect(flow.bias).toBe("calls");
    expect(flow.biasPct).toBeCloseTo(70, 6);
  });

  it("sesgo puts con >=55% del lado contrario", () => {
    const contracts = [
      contract({ strike: 300, type: "call", ask: 200 }),
      contract({ strike: 300, type: "put", ask: 800 }),
    ];
    expect(computeMoneyFlow(contracts).bias).toBe("puts");
  });

  it("neutral dentro de la banda 45-55%", () => {
    const contracts = [
      contract({ strike: 300, type: "call", ask: 510 }),
      contract({ strike: 300, type: "put", ask: 490 }),
    ];
    expect(computeMoneyFlow(contracts).bias).toBe("neutral");
  });

  it("neutral sin premium en absoluto", () => {
    expect(computeMoneyFlow([contract({ strike: 300, type: "call" })]).bias).toBe("neutral");
  });
});

describe("buildVerticalSpread", () => {
  it("calcula costo/max-profit/max-loss de un debit spread real", () => {
    const long = contract({ strike: 310, type: "call", bid: 7.8, ask: 8.0 });
    const short = contract({ strike: 315, type: "call", bid: 3.2, ask: 3.5 });
    const spread = buildVerticalSpread("call", long, short);
    expect(spread?.cost).toBeCloseTo(480, 6); // (8.0 - 3.2) * 100
    expect(spread?.maxProfit).toBeCloseTo(20, 6); // 500 (ancho) - 480
    expect(spread?.maxLoss).toBeCloseTo(480, 6);
  });

  it("null con mismo strike (degenerado)", () => {
    const c = contract({ strike: 310, type: "call", bid: 5, ask: 6 });
    expect(buildVerticalSpread("call", c, c)).toBeNull();
  });

  it("null si el tipo no coincide con los contratos", () => {
    const long = contract({ strike: 310, type: "put", bid: 5, ask: 6 });
    const short = contract({ strike: 315, type: "call", bid: 1, ask: 2 });
    expect(buildVerticalSpread("call", long, short)).toBeNull();
  });

  it("null si el débito da <= 0 (precios inconsistentes)", () => {
    const long = contract({ strike: 310, type: "call", bid: 1, ask: 2 });
    const short = contract({ strike: 315, type: "call", bid: 5, ask: 6 });
    expect(buildVerticalSpread("call", long, short)).toBeNull();
  });
});

describe("suggestBestTrade", () => {
  const gexPositive = computeGexLite(
    [
      contract({ strike: 300, type: "call", gamma: 0.001, openInterest: 100 }),
      contract({ strike: 300, type: "put", gamma: 0.02, openInterest: 100 }),
      contract({ strike: 305, type: "call", gamma: 0.01, openInterest: 100 }),
      contract({ strike: 305, type: "put", gamma: 0.005, openInterest: 100 }),
      contract({ strike: 310, type: "call", gamma: 0.01, openInterest: 200 }),
      contract({ strike: 310, type: "put", gamma: 0.01, openInterest: 200 }),
      contract({ strike: 315, type: "call", gamma: 0.03, openInterest: 300 }),
      contract({ strike: 320, type: "call", gamma: 0.005, openInterest: 100 }),
      contract({ strike: 320, type: "put", gamma: 0.002, openInterest: 100 }),
    ],
    310,
  );
  const neutralFlow = computeMoneyFlow([]);

  it("direccional CALL: entry/stop/tp1/tp2/R:R consistentes con el imán ($315, arriba del spot)", () => {
    const contracts = [
      contract({ strike: 310, type: "call", bid: 7.8, ask: 8.0 }),
      contract({ strike: 315, type: "call", bid: 3.2, ask: 3.5 }),
    ];
    const trade = suggestBestTrade({ spot: 310, gex: gexPositive, moneyFlow: neutralFlow, contracts, atmStrike: 310 });
    expect(trade.lateral).toBe(false);
    if (trade.lateral) throw new Error("esperaba direccional");
    expect(trade.type).toBe("call");
    expect(trade.entry).toBe(8.0);
    expect(trade.entryStrike).toBe(310);
    expect(trade.tp1Underlying).toBe(315); // primer nivel arriba del spot
    expect(trade.tp2Underlying).toBe(320); // segundo nivel arriba
    expect(trade.stopUnderlying).toBeCloseTo(303.96, 1); // el flip, que frena del lado correcto
    expect(trade.riskReward).toBeCloseTo(5 / (310 - 303.96), 2);
    expect(trade.spread?.longStrike).toBe(310);
    expect(trade.spread?.shortStrike).toBe(315);
  });

  it("LATERAL sin imán claro", () => {
    const noGex = computeGexLite([], 310);
    const trade = suggestBestTrade({ spot: 310, gex: noGex, moneyFlow: neutralFlow, contracts: [], atmStrike: 310 });
    expect(trade.lateral).toBe(true);
  });

  it("LATERAL cuando el imán está pegado al spot", () => {
    const pegged = computeGexLite(
      [
        contract({ strike: 310, type: "call", gamma: 0.01, openInterest: 100 }),
        contract({ strike: 310, type: "put", gamma: 0.001, openInterest: 100 }),
      ],
      310,
    );
    const trade = suggestBestTrade({ spot: 310, gex: pegged, moneyFlow: neutralFlow, contracts: [], atmStrike: 310 });
    expect(trade.lateral).toBe(true);
    if (!trade.lateral) throw new Error("esperaba lateral");
    expect(trade.reason).toContain("pegado");
  });

  it("LATERAL cuando el dinero al ask contradice la dirección del imán", () => {
    const putFlow = computeMoneyFlow([
      contract({ strike: 300, type: "call", ask: 100 }),
      contract({ strike: 300, type: "put", ask: 900 }), // sesgo puts fuerte
    ]);
    const contracts = [contract({ strike: 310, type: "call", bid: 7.8, ask: 8.0 })];
    const trade = suggestBestTrade({ spot: 310, gex: gexPositive, moneyFlow: putFlow, contracts, atmStrike: 310 });
    expect(trade.lateral).toBe(true);
    if (!trade.lateral) throw new Error("esperaba lateral");
    expect(trade.reason).toContain("contradictoria");
  });

  it("LATERAL si no hay contrato ATM con precio disponible", () => {
    const trade = suggestBestTrade({ spot: 310, gex: gexPositive, moneyFlow: neutralFlow, contracts: [], atmStrike: 310 });
    expect(trade.lateral).toBe(true);
  });
});

describe("computeCloseScenarios", () => {
  it("bajista/base/alcista con probTouch, base = imán, prob=1 si el strike es el spot", () => {
    const levels = computeGexLite(
      [
        contract({ strike: 305, type: "put", gamma: 0.01, openInterest: 100 }),
        contract({ strike: 310, type: "call", gamma: 0.01, openInterest: 100 }),
        contract({ strike: 310, type: "put", gamma: 0.01, openInterest: 100 }),
        contract({ strike: 315, type: "call", gamma: 0.01, openInterest: 100 }),
      ],
      310,
    ).levels;
    const scenarios = computeCloseScenarios({ spot: 310, atmIv: 0.3, magnet: 310, minutesToClose: 180, levels });
    const base = scenarios.find((s) => s.label === "base")!;
    expect(base.strike).toBe(310);
    expect(base.probTouch).toBe(1); // strike === spot
    expect(scenarios.find((s) => s.label === "alcista")!.strike).toBe(315);
    expect(scenarios.find((s) => s.label === "bajista")!.strike).toBe(305);
  });

  it("cae a un fallback ±0.5% si no hay niveles de ese lado", () => {
    const scenarios = computeCloseScenarios({ spot: 310, atmIv: 0.3, magnet: 310, minutesToClose: 180, levels: [] });
    expect(scenarios.find((s) => s.label === "alcista")!.strike).toBeGreaterThan(310);
    expect(scenarios.find((s) => s.label === "bajista")!.strike).toBeLessThan(310);
  });
});

describe("verdictFromRegime", () => {
  it("positivo -> fadear", () => {
    expect(verdictFromRegime("positivo")?.verdict).toBe("fadear");
  });
  it("negativo -> seguir", () => {
    expect(verdictFromRegime("negativo")?.verdict).toBe("seguir");
  });
  it("null sin régimen", () => {
    expect(verdictFromRegime(null)).toBeNull();
  });
});

describe("buildSpxAmigaBoard", () => {
  const contracts = [
    contract({ strike: 300, type: "call", gamma: 0.001, openInterest: 100, volume: 50, iv: 0.3, bid: 1, ask: 1.2 }),
    contract({ strike: 300, type: "put", gamma: 0.02, openInterest: 100, volume: 80, iv: 0.35, bid: 2, ask: 2.2 }),
    contract({ strike: 305, type: "call", gamma: 0.01, openInterest: 100, volume: 60, iv: 0.28, bid: 3, ask: 3.2 }),
    contract({ strike: 310, type: "call", gamma: 0.01, openInterest: 200, volume: 500, iv: 0.25, bid: 7.8, ask: 8.0 }),
    contract({ strike: 310, type: "put", gamma: 0.01, openInterest: 200, volume: 300, iv: 0.26, bid: 7.5, ask: 7.7 }),
    contract({ strike: 315, type: "call", gamma: 0.03, openInterest: 300, volume: 900, iv: 0.24, bid: 3.2, ask: 3.5 }),
    contract({ strike: 320, type: "call", gamma: 0.005, openInterest: 100, volume: 40, iv: 0.22, bid: 1, ask: 1.2 }),
  ];

  it("mercado abierto: arma lectura a 5 min, mejor trade y escenarios", () => {
    // martes 2026-07-21 14:00 UTC = 10:00 ET (mismo fixture que marketHours.test.ts)
    const board = buildSpxAmigaBoard({ spot: 310, expiration: "2026-08-04", contracts, now: new Date("2026-07-21T14:00:00Z") });
    expect(board.marketOpen).toBe(true);
    expect(board.fiveMinute).not.toBeNull();
    expect(board.bestTrade).not.toBeNull();
    expect(board.scenarios.length).toBe(3);
    expect(board.gex.magnet).toBe(315);
    expect(board.verdict?.verdict).toBeDefined();
  });

  it("mercado cerrado (fin de semana): sin trade en vivo, pero el resto del tablero sigue", () => {
    const board = buildSpxAmigaBoard({ spot: 310, expiration: "2026-08-04", contracts, now: new Date("2026-07-25T15:00:00Z") });
    expect(board.marketOpen).toBe(false);
    expect(board.fiveMinute).toBeNull();
    expect(board.bestTrade).toBeNull();
    expect(board.scenarios).toEqual([]);
    expect(board.ladder.calls.length).toBeGreaterThan(0);
    expect(board.gex.magnet).toBe(315);
  });
});
