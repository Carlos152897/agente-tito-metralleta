import { describe, expect, it } from "vitest";
import {
  candidateStrikesForSide,
  closestStrike,
  detectFlowReversal,
  findFlowExit,
  isTrade,
  nearestStrikes,
  pickAtmContract,
  reconstructRowsFromTrades,
  resolveDirection,
  runBacktestDay,
  sentimentDirection,
  simulateExit,
  simulateTrailingExit,
  sizeContracts,
  summarizeBacktest,
  type BacktestTrade,
  type NeighborZoneTrade,
  type RawDayTrade,
} from "./backtest";

describe("reconstructRowsFromTrades", () => {
  it("agrupa trades del mismo contrato: OI del más reciente, volumen sumado", () => {
    const trades: RawDayTrade[] = [
      { symbol: "TSLA260710C00420000", price: 2.0, size: 10, open_interest: 500, timestamp: "2026-07-06T14:00:00Z" },
      { symbol: "TSLA260710C00420000", price: 9.86, size: 20, open_interest: 900, timestamp: "2026-07-06T19:00:00Z" },
      { symbol: "TSLA260710P00400000", price: 1.5, size: 5, open_interest: 300, timestamp: "2026-07-06T14:00:00Z" },
    ];
    const rows = reconstructRowsFromTrades(trades);
    expect(rows).toHaveLength(2);
    const call = rows.find((r) => r.contractType === "call")!;
    expect(call.strike).toBe(420);
    expect(call.expiration).toBe("2026-07-10");
    expect(call.openInterest).toBe(900); // el más reciente, no el primero
    expect(call.volume).toBe(30); // suma
    expect(call.price).toBe(9.86);
  });

  it("ignora símbolos que no son OCC válidos", () => {
    const trades: RawDayTrade[] = [
      { symbol: "no-es-occ", price: 1, size: 1, open_interest: 1, timestamp: "2026-07-06T14:00:00Z" },
    ];
    expect(reconstructRowsFromTrades(trades)).toHaveLength(0);
  });
});

describe("pickAtmContract", () => {
  const candidates = [
    { strike: 400, expiration: "2026-07-10", dte: 4 },
    { strike: 420, expiration: "2026-07-10", dte: 4 },
    { strike: 440, expiration: "2026-07-10", dte: 4 },
    { strike: 420, expiration: "2026-07-17", dte: 11 }, // vencimiento más lejano, no debería ganar
  ];

  it("elige el vencimiento más próximo dentro de la ventana y el strike más cercano al spot", () => {
    const c = pickAtmContract(candidates, 419, { minDte: 0, maxDte: 7 });
    expect(c).toEqual({ strike: 420, expiration: "2026-07-10", dte: 4 });
  });

  it("null si nada cae en la ventana de DTE", () => {
    expect(pickAtmContract(candidates, 419, { minDte: 20, maxDte: 30 })).toBeNull();
  });

  it("null sin spot válido", () => {
    expect(pickAtmContract(candidates, 0, { minDte: 0, maxDte: 7 })).toBeNull();
  });

  it("respeta maxStrikeDistance: descarta strikes demasiado lejos del spot", () => {
    // spot 449: el más cercano sería 440 (distancia 9), pero el tope es 5 puntos.
    const c = pickAtmContract(candidates, 449, { minDte: 0, maxDte: 7, maxStrikeDistance: 5 });
    expect(c).toBeNull();
  });

  it("con maxStrikeDistance, elige el más cercano que sí entra dentro del tope", () => {
    const c = pickAtmContract(candidates, 424, { minDte: 0, maxDte: 7, maxStrikeDistance: 5 });
    expect(c).toEqual({ strike: 420, expiration: "2026-07-10", dte: 4 }); // 440 queda a 16, fuera del tope
  });
});

describe("sizeContracts", () => {
  it("calcula contratos que caben en el % de riesgo del balance", () => {
    // balance 1000, riesgo 20% = 200 de presupuesto; contrato a $2.00 = $200/contrato → 1 contrato
    expect(sizeContracts(1000, 2.0, 20)).toBe(1);
  });

  it("0 si no alcanza ni para un contrato", () => {
    expect(sizeContracts(1000, 50, 5)).toBe(0); // presupuesto 50, contrato cuesta 5000
  });

  it("0 con insumos inválidos", () => {
    expect(sizeContracts(0, 2, 20)).toBe(0);
    expect(sizeContracts(1000, 0, 20)).toBe(0);
  });

  it("allowMinimumOne: compra 1 si el presupuesto de riesgo no alcanza pero el balance completo sí", () => {
    // presupuesto 50 (5% de 1000), contrato cuesta 500 → sin allowMinimumOne da 0
    expect(sizeContracts(1000, 5, 5)).toBe(0);
    expect(sizeContracts(1000, 5, 5, true)).toBe(1);
  });

  it("allowMinimumOne: sigue en 0 si ni el balance completo alcanza", () => {
    expect(sizeContracts(1000, 15, 5, true)).toBe(0); // contrato cuesta 1500, más que el balance
  });
});

describe("simulateExit", () => {
  it("toca take profit sin tocar stop loss → sale en el target", () => {
    const r = simulateExit({ entry: 2, high: 4, low: 1.8, close: 3, contracts: 1, takeProfitPct: 60, stopLossPct: 50 });
    expect(r.exitReason).toBe("take_profit");
    expect(r.exitPrice).toBeCloseTo(3.2); // 2 * 1.6
  });

  it("toca stop loss → sale ahí aunque el high también haya tocado el target (orden conservador)", () => {
    const r = simulateExit({ entry: 2, high: 5, low: 0.9, close: 3, contracts: 1, takeProfitPct: 60, stopLossPct: 50 });
    expect(r.exitReason).toBe("stop_loss");
    expect(r.exitPrice).toBeCloseTo(1); // 2 * 0.5
  });

  it("ni take profit ni stop loss → sale al cierre", () => {
    const r = simulateExit({ entry: 2, high: 2.8, low: 1.6, close: 2.3, contracts: 1, takeProfitPct: 60, stopLossPct: 50 });
    expect(r.exitReason).toBe("close");
    expect(r.exitPrice).toBe(2.3);
  });

  it("take profit fijo en dólares gana sobre el %: convierte a precio por acción con los contratos", () => {
    // entry 2, 2 contratos, target $150 → +150/(2*100) = +0.75 por acción → precio objetivo 2.75
    const r = simulateExit({
      entry: 2, high: 3, low: 1.9, close: 2.5, contracts: 2,
      takeProfitPct: 60, takeProfitUsd: 150, stopLossPct: 50,
    });
    expect(r.exitReason).toBe("take_profit");
    expect(r.exitPrice).toBeCloseTo(2.75);
  });

  it("sin contratos, el take profit en dólares no se puede convertir → cae al %", () => {
    const r = simulateExit({
      entry: 2, high: 4, low: 1.9, close: 2.5, contracts: 0,
      takeProfitPct: 60, takeProfitUsd: 150, stopLossPct: 50,
    });
    expect(r.exitReason).toBe("take_profit");
    expect(r.exitPrice).toBeCloseTo(3.2); // fórmula por % (2*1.6), no por $
  });
});

describe("runBacktestDay", () => {
  const base = {
    date: "2026-07-06",
    spot: 419,
    candidates: [{ strike: 420, expiration: "2026-07-10", dte: 4 }],
    contract: { strike: 420, expiration: "2026-07-10", dte: 4 },
    balance: 1000,
    riskPct: 20,
    takeProfitPct: 60,
    stopLossPct: 50,
  };

  it("sin señal (flat) → skip", () => {
    const r = runBacktestDay({ ...base, direction: "flat", contractBar: { open: 2, high: 3, low: 1.5, close: 2.5 } });
    expect(isTrade(r)).toBe(false);
    expect((r as { reason: string }).reason).toBe("sin_senal");
  });

  it("sin contrato → skip", () => {
    const r = runBacktestDay({ ...base, direction: "call", contract: null, contractBar: null });
    expect((r as { reason: string }).reason).toBe("sin_contrato");
  });

  it("sin barra del contrato → skip", () => {
    const r = runBacktestDay({ ...base, direction: "call", contractBar: null });
    expect((r as { reason: string }).reason).toBe("sin_datos_del_contrato");
  });

  it("balance insuficiente para 1 contrato → skip", () => {
    const r = runBacktestDay({
      ...base, direction: "call", balance: 10,
      contractBar: { open: 2, high: 3, low: 1.5, close: 2.5 },
    });
    expect((r as { reason: string }).reason).toBe("balance_insuficiente");
  });

  it("operación completa: entra, sale, actualiza balance", () => {
    const r = runBacktestDay({
      ...base, direction: "call",
      contractBar: { open: 2, high: 3.5, low: 1.9, close: 3 }, // toca TP en 3.2? no, high=3.5>=3.2 sí toca
    });
    expect(isTrade(r)).toBe(true);
    const t = r as BacktestTrade;
    expect(t.contracts).toBe(1);
    expect(t.exitReason).toBe("take_profit");
    expect(t.balanceAfter).toBeGreaterThan(1000);
  });
});

describe("summarizeBacktest", () => {
  function trade(pnl: number, balanceAfter: number): BacktestTrade {
    return {
      date: "2026-07-06", direction: "call", strike: 420, expiration: "2026-07-10", dte: 4,
      entryPrice: 2, exitPrice: 2 + pnl / 100, exitReason: "close", triggeredAt: null, triggerSymbol: null,
      contracts: 1, cost: 200, pnl, pnlPct: (pnl / 200) * 100, balanceAfter,
    };
  }

  it("calcula win rate, retorno total y drawdown", () => {
    const trades = [trade(100, 1100), trade(-50, 1050), trade(200, 1250)];
    const s = summarizeBacktest(trades, 1000);
    expect(s.endingBalance).toBe(1250);
    expect(s.totalReturnPct).toBeCloseTo(25);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRatePct).toBeCloseTo(66.666, 2);
    expect(s.bestTrade?.pnl).toBe(200);
    expect(s.worstTrade?.pnl).toBe(-50);
    // pico en 1100 tras el primer trade, cae a 1050 → drawdown ~4.545%
    expect(s.maxDrawdownPct).toBeCloseTo(4.545, 2);
  });

  it("sin operaciones: balance final = inicial, sin ganadores/perdedores", () => {
    const s = summarizeBacktest([], 1000);
    expect(s.endingBalance).toBe(1000);
    expect(s.totalReturnPct).toBe(0);
    expect(s.tradesCount).toBe(0);
    expect(s.winRatePct).toBe(0);
  });
});

describe("sentimentDirection", () => {
  it("mayoría alcista clara → call", () => {
    const d = sentimentDirection([
      { premium: 800, sentiment: "bullish" },
      { premium: 200, sentiment: "bearish" },
    ]);
    expect(d).toBe("call");
  });

  it("mayoría bajista clara → put", () => {
    const d = sentimentDirection([
      { premium: 200, sentiment: "bullish" },
      { premium: 800, sentiment: "bearish" },
    ]);
    expect(d).toBe("put");
  });

  it("sin mayoría clara (cerca de 50/50) → flat", () => {
    const d = sentimentDirection([
      { premium: 520, sentiment: "bullish" },
      { premium: 480, sentiment: "bearish" },
    ]);
    expect(d).toBe("flat");
  });

  it("sin trades con sentimiento → flat", () => {
    expect(sentimentDirection([])).toBe("flat");
  });
});

describe("resolveDirection", () => {
  it("sin señal del GEX, siempre flat sin importar el sentimiento", () => {
    expect(resolveDirection("flat", "call", true)).toBe("flat");
  });

  it("sin exigir confirmación, el GEX manda solo", () => {
    expect(resolveDirection("call", "put", false)).toBe("call");
  });

  it("exigiendo confirmación, sentimiento sin mayoría no bloquea", () => {
    expect(resolveDirection("call", "flat", true)).toBe("call");
  });

  it("exigiendo confirmación, sentimiento de acuerdo con el GEX → pasa", () => {
    expect(resolveDirection("call", "call", true)).toBe("call");
  });

  it("exigiendo confirmación, sentimiento contrario al GEX → contradice", () => {
    expect(resolveDirection("call", "put", true)).toBe("contradice");
  });
});

describe("nearestStrikes", () => {
  const strikes = [380, 385, 390, 395, 400, 405, 410, 415, 420];

  it("los N más cercanos por encima, ascendentes", () => {
    expect(nearestStrikes(strikes, 400, "above", 3)).toEqual([405, 410, 415]);
  });

  it("los N más cercanos por debajo, descendentes desde el spot", () => {
    expect(nearestStrikes(strikes, 400, "below", 3)).toEqual([395, 390, 385]);
  });

  it("menos strikes disponibles que N: devuelve los que haya", () => {
    expect(nearestStrikes([405], 400, "above", 3)).toEqual([405]);
  });
});

describe("closestStrike", () => {
  it("elige el strike más cercano al spot", () => {
    expect(closestStrike([300, 305, 310, 315, 320], 311)).toBe(310);
  });
});

describe("candidateStrikesForSide", () => {
  const strikes = [300, 305, 310, 315, 320, 325];

  it("arriba: strike actual + vecinos hacia arriba (ejemplo de Carlos: 310/315/320/325)", () => {
    expect(candidateStrikesForSide(strikes, 310, "above", 5)).toEqual([310, 315, 320, 325]);
  });

  it("abajo: strike actual + vecinos hacia abajo (ejemplo de Carlos: 310/305/300)", () => {
    expect(candidateStrikesForSide(strikes, 310, "below", 5)).toEqual([310, 305, 300]);
  });

  it("vacío sin strikes", () => {
    expect(candidateStrikesForSide([], 310, "above", 5)).toEqual([]);
  });
});

describe("findFlowExit", () => {
  const base = {
    direction: "call" as const,
    entryTime: "2026-07-06T13:30:00Z",
    entryPrice: 2,
    contracts: 1,
    heldTrades: [] as { timestamp: string; price: number }[],
    volumeMultiple: 4,
    takeProfitPct: 60,
    dayHigh: 2.5,
    dayLow: 1.7,
    dayClose: 2.2,
    emergencyStopPct: 70,
  };

  it("compra agresiva en la zona de reversión (puts, con call) que supera 4x OI → sale por flujo", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put", size: 500, openInterest: 100, side: "ASKSIDE" },
    ];
    const heldTrades = [{ timestamp: "2026-07-06T14:00:05Z", price: 1.9 }];
    const r = findFlowExit({ ...base, neighborTrades, heldTrades });
    expect(r.exitReason).toBe("flow_reversal");
    expect(r.exitPrice).toBe(1.9); // precio real del contrato propio más cercano en el tiempo
    expect(r.triggerSymbol).toBe("TSLA260710P00395000");
  });

  it("volumen alto pero SIN compra agresiva (venta al bid) → no dispara", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put", size: 500, openInterest: 100, side: "BIDSIDE" },
    ];
    const r = findFlowExit({ ...base, neighborTrades });
    expect(r.exitReason).not.toBe("flow_reversal");
  });

  it("compra agresiva pero SIN superar 4x OI → no dispara", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put", size: 300, openInterest: 100, side: "ASKSIDE" },
    ];
    const r = findFlowExit({ ...base, neighborTrades });
    expect(r.exitReason).not.toBe("flow_reversal");
  });

  it("compra agresiva y volumen alto en la ZONA DE CONTINUACIÓN (calls, con call) → no dispara, es confirmación no reversión", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710C00405000", strike: 405, type: "call", size: 500, openInterest: 100, side: "ASKSIDE" },
    ];
    const r = findFlowExit({ ...base, neighborTrades });
    expect(r.exitReason).not.toBe("flow_reversal");
  });

  it("trades antes de la entrada no cuentan para el volumen acumulado", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T13:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put", size: 500, openInterest: 100, side: "ASKSIDE" },
    ];
    const r = findFlowExit({ ...base, neighborTrades });
    expect(r.exitReason).not.toBe("flow_reversal");
  });

  it("nada dispara → cae al take profit / backstop de emergencia contra el rango del día", () => {
    const r = findFlowExit({ ...base, neighborTrades: [], dayHigh: 3.2 }); // 2*1.6 = 3.2 → toca TP
    expect(r.exitReason).toBe("take_profit");
    expect(r.exitPrice).toBeCloseTo(3.2);
  });

  it("posición PUT: la zona de reversión son los calls arriba, no los puts", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710C00405000", strike: 405, type: "call", size: 500, openInterest: 100, side: "ASKSIDE" },
    ];
    const r = findFlowExit({ ...base, direction: "put", neighborTrades });
    expect(r.exitReason).toBe("flow_reversal");
  });
});

describe("detectFlowReversal", () => {
  it("detecta el mismo disparo que findFlowExit, pero devuelve solo el trigger (sin fallback)", () => {
    const neighborTrades: NeighborZoneTrade[] = [
      { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put", size: 500, openInterest: 100, side: "ASKSIDE" },
    ];
    const r = detectFlowReversal({ direction: "call", entryTime: "2026-07-06T13:30:00Z", neighborTrades, volumeMultiple: 4 });
    expect(r).toEqual({ timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000" });
  });

  it("null si nada dispara", () => {
    expect(detectFlowReversal({ direction: "call", entryTime: "2026-07-06T13:30:00Z", neighborTrades: [], volumeMultiple: 4 })).toBeNull();
  });
});

describe("simulateTrailingExit", () => {
  // entry 2, armPct 20 → arma en 2.4; hardStopPct 50 → stop duro en 1.0.
  const base = { entry: 2, armPct: 20, trailPct: 25, hardStopPct: 50 };

  it("el rango del día nunca llegó a armar Y tocó el stop duro → sale ahí", () => {
    const r = simulateTrailingExit({
      ...base, heldTrades: [], dayHigh: 2.2, dayLow: 0.9, close: 1.1,
    });
    expect(r.exitReason).toBe("stop_loss");
    expect(r.exitPrice).toBeCloseTo(1.0);
    expect(r.armedAt).toBeNull();
  });

  it("el rango nunca armó y tampoco tocó el stop duro → sale al cierre", () => {
    const r = simulateTrailingExit({
      ...base, heldTrades: [], dayHigh: 2.2, dayLow: 1.5, close: 1.9,
    });
    expect(r.exitReason).toBe("close");
    expect(r.exitPrice).toBe(1.9);
  });

  it("armó (según el rango) pero no retrocedió lo suficiente desde el pico → cierre", () => {
    const heldTrades = [
      { timestamp: "2026-07-06T14:00:00Z", price: 2.5 }, // cruza el umbral de armado (2.4) → arma aquí
      { timestamp: "2026-07-06T14:05:00Z", price: 3.0 },
    ];
    // pico = max(dayHigh, trades) = 3.0 → trail en 3*0.75 = 2.25; dayLow (2.4) no lo toca.
    const r = simulateTrailingExit({ ...base, heldTrades, dayHigh: 3.0, dayLow: 2.4, close: 2.8 });
    expect(r.armedAt).toBe("2026-07-06T14:00:00Z");
    expect(r.exitReason).toBe("close");
    expect(r.exitPrice).toBe(2.8);
  });

  it("armó y el rango retrocedió más del trailPct desde el pico → sale ahí, asegurando la ganancia", () => {
    const heldTrades = [
      { timestamp: "2026-07-06T14:00:00Z", price: 2.5 },
      { timestamp: "2026-07-06T14:05:00Z", price: 4.0 },
    ];
    // pico 4.0 → trail en 4*0.75 = 3.0; dayLow (2.0) sí lo toca.
    const r = simulateTrailingExit({ ...base, heldTrades, dayHigh: 4.0, dayLow: 2.0, close: 2.5 });
    expect(r.exitReason).toBe("trailing_stop");
    expect(r.exitPrice).toBeCloseTo(3.0);
    expect(r.exitPrice).toBeGreaterThan(base.entry); // la ganancia quedó asegurada, no se perdió todo
    expect(r.armedAt).toBe("2026-07-06T14:00:00Z");
  });

  it("CRÍTICO — sin trades propios ese día (MarketSnack sin cobertura), el rango del día SIGUE protegiendo", () => {
    // Este es el caso que fallaba antes del fix: heldTrades vacío no debe dejar la
    // posición sin protección solo porque MarketSnack no cubrió el contrato ese día.
    const r = simulateTrailingExit({
      ...base, heldTrades: [], dayHigh: 4.0, dayLow: 1.5, close: 1.8,
    });
    expect(r.exitReason).toBe("trailing_stop");
    expect(r.exitPrice).toBeCloseTo(3.0); // 4.0 * 0.75, el pico lo da el rango del día, no un trade
    expect(r.armedAt).toBeNull(); // se sabe que armó, pero no hay trade propio que diga cuándo
  });
});

describe("runBacktestDay — combinación de flowExit + trailingStop", () => {
  const dayInput = {
    date: "2026-07-06", direction: "call" as const, spot: 2,
    candidates: [], contract: { strike: 400, expiration: "2026-07-10", dte: 4 },
    contractBar: { open: 2, high: 4.5, low: 1.9, close: 3 },
    balance: 1000, riskPct: 20, takeProfitPct: 60, stopLossPct: 50,
  };

  it("la reversión de flujo gana aunque haya trailing configurado", () => {
    const flowExit = {
      entryTime: "2026-07-06T13:30:00Z",
      heldTrades: [{ timestamp: "2026-07-06T14:00:05Z", price: 2.1 }],
      neighborTrades: [
        { timestamp: "2026-07-06T14:00:00Z", symbol: "TSLA260710P00395000", strike: 395, type: "put" as const, size: 500, openInterest: 100, side: "ASKSIDE" },
      ],
      volumeMultiple: 4, emergencyStopPct: 70,
    };
    const trailingStop = { heldTrades: flowExit.heldTrades, armPct: 20, trailPct: 25, hardStopPct: 70 };
    const r = runBacktestDay({ ...dayInput, flowExit, trailingStop });
    expect(isTrade(r)).toBe(true);
    expect((r as BacktestTrade).exitReason).toBe("flow_reversal");
  });

  it("sin reversión, el trailing decide (no el take-profit/backstop fijo)", () => {
    const trailingStop = {
      heldTrades: [
        { timestamp: "2026-07-06T14:00:00Z", price: 2.5 },
        { timestamp: "2026-07-06T14:05:00Z", price: 4.0 },
        { timestamp: "2026-07-06T14:10:00Z", price: 2.9 },
      ],
      armPct: 20, trailPct: 25, hardStopPct: 70,
    };
    const r = runBacktestDay({ ...dayInput, trailingStop });
    expect(isTrade(r)).toBe(true);
    expect((r as BacktestTrade).exitReason).toBe("trailing_stop");
    // pico = max(dayHigh 4.5, trades) = 4.5 → trail en 4.5*0.75 = 3.375 (dayLow 1.9 lo toca)
    expect((r as BacktestTrade).exitPrice).toBeCloseTo(3.375);
  });
});
