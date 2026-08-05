import { describe, expect, it } from "vitest";
import type { Row } from "./types";
import {
  dominantSideAt,
  neighborContractsConfirmPosition,
  neighborContractsEntrySignal,
  neighborContractsWalk,
  profitSideOf,
  resolveStrikeContracts,
  summarizeTradeBuckets,
  toStrikePremiums,
  wallEntrySignal,
  walkNeighborContracts,
  type ContractPremiumSummary,
  type StrikePremiums,
  type TradeSummaryBucket,
} from "./neighborContracts";

function bucket(overrides: Partial<TradeSummaryBucket>): TradeSummaryBucket {
  return {
    t: "2026-07-22T14:00:00.000Z",
    ask_volume: 0, bid_volume: 0, mid_volume: 0,
    ask_premium: 0, bid_premium: 0, mid_premium: 0,
    single_leg_premium: 0, multi_leg_premium: 0, other_premium: 0,
    ...overrides,
  };
}

function premium(netPremium: number): ContractPremiumSummary {
  return {
    netPremium,
    askPremium: Math.max(netPremium, 0),
    bidPremium: Math.max(-netPremium, 0),
    askVolume: 0,
    bidVolume: 0,
  };
}

function strikePremiums(
  entries: Array<{ strike: number; callNet?: number; putNet?: number }>,
): Map<number, StrikePremiums> {
  const map = new Map<number, StrikePremiums>();
  for (const e of entries) {
    map.set(e.strike, {
      strike: e.strike,
      call: e.callNet != null ? premium(e.callNet) : null,
      put: e.putNet != null ? premium(e.putNet) : null,
    });
  }
  return map;
}

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

const NOW = new Date("2026-07-22T15:00:00Z"); // ~11:00 ET, mercado abierto

describe("summarizeTradeBuckets", () => {
  it("suma ask/bid de todos los buckets; net premium = ask - bid (mid queda afuera)", () => {
    const buckets = [
      bucket({ ask_volume: 10, bid_volume: 5, ask_premium: 1000, bid_premium: 400 }),
      bucket({ ask_volume: 2, bid_volume: 8, ask_premium: 200, bid_premium: 600 }),
    ];
    expect(summarizeTradeBuckets(buckets)).toEqual({
      netPremium: 200, askPremium: 1200, bidPremium: 1000, askVolume: 12, bidVolume: 13,
    });
  });

  it("array vacío (contrato sin trades hoy) -> todo en cero", () => {
    expect(summarizeTradeBuckets([])).toEqual({ netPremium: 0, askPremium: 0, bidPremium: 0, askVolume: 0, bidVolume: 0 });
  });
});

describe("dominantSideAt", () => {
  it("domina el lado con mayor net premium", () => {
    expect(dominantSideAt({ strike: 100, call: premium(500), put: premium(100) })).toBe("call");
    expect(dominantSideAt({ strike: 100, call: premium(100), put: premium(500) })).toBe("put");
  });

  it("empate exacto -> tie", () => {
    expect(dominantSideAt({ strike: 100, call: premium(300), put: premium(300) })).toBe("tie");
  });

  it("ambos lados sin contrato/sin trades -> tie (0 vs 0)", () => {
    expect(dominantSideAt({ strike: 100, call: null, put: null })).toBe("tie");
  });
});

describe("profitSideOf", () => {
  it("call -> above, put -> below", () => {
    expect(profitSideOf("call")).toBe("above");
    expect(profitSideOf("put")).toBe("below");
  });
});

describe("walkNeighborContracts", () => {
  it("camina mientras el mismo lado domine y se detiene en el primer flip", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
      { strike: 320, callNet: 0, putNet: 1000 },
      { strike: 325, callNet: 0, putNet: 1000 },
    ]);
    const walk = walkNeighborContracts([310, 315, 320, 325], premiums, "above", "call");
    expect(walk.flipStrike).toBe(320);
    expect(walk.levels.map((l) => l.strike)).toEqual([310, 315, 320]); // no sigue a 325, ya volteó
  });

  it("nunca voltea dentro del recorrido -> flipStrike null, camina todos los niveles", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
    ]);
    const walk = walkNeighborContracts([310, 315], premiums, "above", "call");
    expect(walk.flipStrike).toBeNull();
    expect(walk.levels).toHaveLength(2);
  });

  it("un empate en un strike también corta el recorrido (sin datos claros no hay más 'espacio')", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 500, putNet: 500 },
    ]);
    const walk = walkNeighborContracts([310, 315], premiums, "above", "call");
    expect(walk.flipStrike).toBe(315);
  });

  it("strike sin datos en el mapa se trata como tie", () => {
    const walk = walkNeighborContracts([310], new Map(), "above", "call");
    expect(walk.flipStrike).toBe(310);
  });
});

describe("neighborContractsEntrySignal", () => {
  it("null si el strike central empata (ante la duda, no operar)", () => {
    const premiums = strikePremiums([{ strike: 310, callNet: 500, putNet: 500 }]);
    expect(
      neighborContractsEntrySignal({ strikes: [305, 310, 315], spot: 310, strikePremiums: premiums }),
    ).toBeNull();
  });

  it("detecta la dirección desde el centro (calls dominan) y camina hasta el flip", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
      { strike: 320, callNet: 0, putNet: 1000 },
    ]);
    const signal = neighborContractsEntrySignal({
      strikes: [300, 305, 310, 315, 320, 325], spot: 310, strikePremiums: premiums, count: 4,
    });
    expect(signal?.type).toBe("call");
    expect(signal?.side).toBe("above");
    expect(signal?.flipStrike).toBe(320);
    expect(signal?.target).toBe(315); // último strike que confirmó antes del volteo
    expect(signal?.reversalWarning).toBeNull();
    expect(signal?.reason).toMatch(/\$320/);
  });

  it("dirección puts (bajista) camina hacia abajo", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 0, putNet: 1000 },
      { strike: 305, callNet: 0, putNet: 1000 },
      { strike: 300, callNet: 1000, putNet: 0 },
    ]);
    const signal = neighborContractsEntrySignal({
      strikes: [295, 300, 305, 310, 315], spot: 310, strikePremiums: premiums, count: 4,
    });
    expect(signal?.type).toBe("put");
    expect(signal?.side).toBe("below");
    expect(signal?.flipStrike).toBe(300);
    expect(signal?.target).toBe(305);
  });

  it("reversalWarning cuando el flip está apenas en el primer vecino (poco recorrido)", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 0, putNet: 1000 },
    ]);
    const signal = neighborContractsEntrySignal({
      strikes: [305, 310, 315, 320], spot: 310, strikePremiums: premiums, count: 4,
    });
    expect(signal?.target).toBe(310);
    expect(signal?.reversalWarning).not.toBeNull();
  });

  it("nunca voltea dentro del recorrido -> target es el strike más lejano caminado", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
    ]);
    const signal = neighborContractsEntrySignal({
      strikes: [310, 315], spot: 310, strikePremiums: premiums, count: 4,
    });
    expect(signal?.flipStrike).toBeNull();
    expect(signal?.target).toBe(315);
  });

  it("vacío sin strikes", () => {
    expect(neighborContractsEntrySignal({ strikes: [], spot: 310, strikePremiums: new Map() })).toBeNull();
  });
});

describe("neighborContractsWalk", () => {
  it("camina en la dirección fija del tipo dado, centrado en un strike (no en el spot)", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 0, putNet: 1000 },
      { strike: 305, callNet: 0, putNet: 1000 },
      { strike: 300, callNet: 1000, putNet: 0 },
    ]);
    const walk = neighborContractsWalk({
      centerStrike: 310, type: "put", chainStrikes: [300, 305, 310, 315, 320], strikePremiums: premiums, count: 4,
    });
    expect(walk?.side).toBe("below");
    expect(walk?.flipStrike).toBe(300);
    expect(walk?.levels.map((l) => l.strike)).toEqual([310, 305, 300]);
  });

  it("null sin strikes disponibles", () => {
    expect(
      neighborContractsWalk({ centerStrike: 310, type: "call", chainStrikes: [], strikePremiums: new Map() }),
    ).toBeNull();
  });
});

describe("neighborContractsConfirmPosition", () => {
  it("confirma si la dominancia sigue del lado de la posición más allá de su propio strike", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
    ]);
    expect(
      neighborContractsConfirmPosition({
        position: { type: "call", strike: 310 }, chainStrikes: [305, 310, 315, 320], strikePremiums: premiums,
      }),
    ).toBe(true);
  });

  it("NO confirma si la dominancia ya volteó justo en el strike de la posición", () => {
    const premiums = strikePremiums([{ strike: 310, callNet: 0, putNet: 1000 }]);
    expect(
      neighborContractsConfirmPosition({
        position: { type: "call", strike: 310 }, chainStrikes: [305, 310, 315], strikePremiums: premiums,
      }),
    ).toBe(false);
  });

  it("confirma aunque nunca voltee dentro del recorrido", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 1000, putNet: 0 },
      { strike: 315, callNet: 1000, putNet: 0 },
    ]);
    expect(
      neighborContractsConfirmPosition({
        position: { type: "call", strike: 310 }, chainStrikes: [310, 315], strikePremiums: premiums,
      }),
    ).toBe(true);
  });

  it("false sin strikes de cadena disponibles", () => {
    expect(
      neighborContractsConfirmPosition({
        position: { type: "call", strike: 310 }, chainStrikes: [], strikePremiums: new Map(),
      }),
    ).toBe(false);
  });
});

describe("resolveStrikeContracts", () => {
  it("arma el símbolo OCC real de call y put por strike, con la expiración más próxima disponible", () => {
    const rows: Row[] = [
      row({ optionTicker: "TSLA260723C00310000", contractType: "call", expiration: "2026-07-23", strike: 310 }),
      row({ optionTicker: "TSLA260723P00310000", contractType: "put", expiration: "2026-07-23", strike: 310 }),
      row({ optionTicker: "TSLA260730C00310000", contractType: "call", expiration: "2026-07-30", strike: 310 }), // más lejano, no debe ganar
    ];
    const result = resolveStrikeContracts([310], rows, NOW, "TSLA");
    expect(result.get(310)).toEqual({ call: "TSLA260723C00310000", put: "TSLA260723P00310000" });
  });

  it("null cuando ese strike no tiene ese tipo de contrato", () => {
    const rows: Row[] = [row({ contractType: "call", strike: 310 })];
    const result = resolveStrikeContracts([310], rows, NOW, "TSLA");
    expect(result.get(310)?.put).toBeNull();
  });

  it("resuelve la raíz OCC real cuando difiere del ticker (SPX cotiza bajo SPXW)", () => {
    const rows: Row[] = [
      row({ optionTicker: "O:SPXW260723C00310000", contractType: "call", expiration: "2026-07-23", strike: 310 }),
    ];
    const result = resolveStrikeContracts([310], rows, NOW, "SPX");
    expect(result.get(310)?.call).toBe("SPXW260723C00310000");
  });
});

describe("toStrikePremiums", () => {
  it("combina strike->símbolos con símbolo->net premium", () => {
    const strikeContracts = new Map([[310, { call: "TSLA260723C00310000", put: "TSLA260723P00310000" as string | null }]]);
    const premiumsBySymbol = new Map([["TSLA260723C00310000", premium(500)]]); // el put queda sin datos
    const result = toStrikePremiums(strikeContracts, premiumsBySymbol);
    expect(result.get(310)).toEqual({ strike: 310, call: premium(500), put: null });
  });

  it("símbolo null (sin contrato real en ese strike) -> null en ese lado", () => {
    const strikeContracts = new Map([[310, { call: null as string | null, put: "TSLA260723P00310000" }]]);
    const premiumsBySymbol = new Map<string, ContractPremiumSummary>();
    const result = toStrikePremiums(strikeContracts, premiumsBySymbol);
    expect(result.get(310)?.call).toBeNull();
    expect(result.get(310)?.put).toBeNull(); // símbolo existe pero sin datos en el mapa de premiums
  });
});

describe("wallEntrySignal", () => {
  it("caso real: centro con desbalance chico pierde contra una pared más grande un strike más allá", () => {
    // SPX 31-jul-2026, 09:45 ET, spot 7456.64: el centro (7455) daba CALL por
    // apenas +$60,824, mientras 7460 tenía +$471,794 en puts (~8x más grande).
    // El walk de dominancia local elegía CALL $7455; la pared elige PUT $7460
    // (o el primer strike hacia abajo que confirme esa misma dirección).
    const premiums = strikePremiums([
      { strike: 7440, callNet: -264436, putNet: -44445 },
      { strike: 7445, callNet: -150032, putNet: 170831 },
      { strike: 7450, callNet: -34145, putNet: 249004 },
      { strike: 7455, callNet: 60824, putNet: -227 }, // centro: domina call, pero chico
      { strike: 7460, callNet: -35072, putNet: 471794 }, // pared real: put, 8x más grande
    ]);
    const signal = wallEntrySignal({
      strikes: [7440, 7445, 7450, 7455, 7460],
      spot: 7456.64,
      strikePremiums: premiums,
      count: 6,
    });
    expect(signal?.type).toBe("put");
    expect(signal?.wallStrike).toBe(7460);
    expect(signal?.wallMagnitude).toBeCloseTo(506866, 0); // |−35072 − 471794|
    expect(signal?.target1).toEqual({ strike: 7450, netPremium: 283149 }); // primer strike hacia abajo que confirma put
    expect(signal?.target2).toEqual({ strike: 7445, netPremium: 320863 }); // segundo, más allá del primero
    expect(signal?.resistance).toEqual({ strike: 7460, netPremium: 506866 }); // techo: pared más grande arriba
    expect(signal?.support).toEqual({ strike: 7445, netPremium: 320863 }); // piso: pared más grande abajo
  });

  it("sin pared (todo en $0) -> null", () => {
    const premiums = strikePremiums([{ strike: 310, callNet: 0, putNet: 0 }]);
    expect(wallEntrySignal({ strikes: [305, 310, 315], spot: 310, strikePremiums: premiums })).toBeNull();
  });

  it("vacío sin strikes", () => {
    expect(wallEntrySignal({ strikes: [], spot: 310, strikePremiums: new Map() })).toBeNull();
  });

  it("target cae en la pared misma si nada del lado de ganancia confirma esa dirección", () => {
    // La pared (put grande) queda ARRIBA del spot -> dirección put -> lado de
    // ganancia es "below", pero todos los strikes de abajo son call-dominantes.
    // Sin nadie que confirme caminando hacia afuera, el target cae en la pared misma.
    const premiums = strikePremiums([
      { strike: 300, callNet: 1000, putNet: 0 },
      { strike: 305, callNet: 2000, putNet: 0 },
      { strike: 310, callNet: 0, putNet: 0 }, // centro, sin datos
      { strike: 320, callNet: 0, putNet: 5000 }, // pared put, arriba del spot
    ]);
    const signal = wallEntrySignal({ strikes: [300, 305, 310, 315, 320], spot: 310, strikePremiums: premiums, count: 4 });
    expect(signal?.type).toBe("put");
    expect(signal?.wallStrike).toBe(320);
    expect(signal?.target1).toEqual({ strike: 320, netPremium: 5000 }); // respaldo: nada del lado "below" confirma put
    expect(signal?.target2).toBeNull();
  });

  it("target2 null cuando solo un strike confirma caminando hacia afuera", () => {
    // Pared put grande ARRIBA del spot (315) -> dirección put, camina hacia
    // abajo: 305 confirma (put), pero 300 ya es call-dominante -> ahí se corta.
    const premiums = strikePremiums([
      { strike: 300, callNet: 500, putNet: 0 }, // no confirma (call)
      { strike: 305, callNet: 0, putNet: 1000 }, // confirma put (target1)
      { strike: 310, callNet: 0, putNet: 0 }, // centro, sin datos
      { strike: 315, callNet: 0, putNet: 5000 }, // pared put, arriba del spot
    ]);
    const signal = wallEntrySignal({ strikes: [300, 305, 310, 315], spot: 310, strikePremiums: premiums, count: 4 });
    expect(signal?.type).toBe("put");
    expect(signal?.wallStrike).toBe(315);
    expect(signal?.target1).toEqual({ strike: 305, netPremium: 1000 });
    expect(signal?.target2).toBeNull();
  });

  it("respeta count (vecindario más ancho encuentra paredes que un count chico no vería)", () => {
    const premiums = strikePremiums([
      { strike: 310, callNet: 100, putNet: 0 }, // centro, chico
      { strike: 340, callNet: 0, putNet: 9000 }, // pared grande, lejos (6to strike)
    ]);
    const strikes = [280, 290, 300, 310, 320, 330, 340];
    expect(wallEntrySignal({ strikes, spot: 310, strikePremiums: premiums, count: 2 })?.type).toBe("call"); // no ve la pared lejana
    expect(wallEntrySignal({ strikes, spot: 310, strikePremiums: premiums, count: 6 })?.wallStrike).toBe(340);
  });

  it("caso real reportado por Carlos: resistencia y target1 no pueden quedar por debajo del spot en un CALL", () => {
    // Spot $7666.86 entre strikes de $5 — el más cercano es $7665, PERO ese
    // strike queda por DEBAJO del spot real. Antes del fix, candidateStrikesForSide
    // metía ese strike central en el lado "above" igual (porque camina desde el
    // strike más cercano, no desde el spot), así que si ahí había la pared más
    // grande, resistencia y target1 salían por debajo del precio actual — sin
    // sentido para un CALL (la resistencia es un techo, el target es a dónde
    // subiría el precio).
    const premiums = strikePremiums([
      { strike: 7640, callNet: 6942105, putNet: 0 }, // pared real: soporte, abajo del spot
      { strike: 7665, callNet: 2129205, putNet: 0 }, // strike más cercano al spot, pero ABAJO
      { strike: 7670, callNet: 1618678, putNet: 0 },
    ]);
    const signal = wallEntrySignal({
      strikes: [7640, 7665, 7670],
      spot: 7666.86,
      strikePremiums: premiums,
      count: 6,
    });
    expect(signal?.type).toBe("call");
    expect(signal?.wallStrike).toBe(7640); // la pared más grande de todo el vecindario sigue siendo esta
    expect(signal?.resistance?.strike).toBeGreaterThan(7666.86); // el techo tiene que estar arriba del spot
    expect(signal?.resistance).toEqual({ strike: 7670, netPremium: 1618678 });
    expect(signal?.target1.strike).toBeGreaterThan(7666.86); // el target de un CALL tiene que estar arriba del spot
    expect(signal?.target1).toEqual({ strike: 7670, netPremium: 1618678 });
  });
});
