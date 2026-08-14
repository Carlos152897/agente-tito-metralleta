import { describe, expect, it } from "vitest";
import {
  applyPersistence, contratosVecinos3Signal, PERSISTENCE_REQUIRED, summarizeActivity,
  type ActivityLevel, type ContratosVecinos3Signal, type TradeSummaryBucketLike,
} from "./contratosVecinos3";

function bucket(t: string, ask: number, bid: number, mid = 0): TradeSummaryBucketLike {
  return { t, ask_premium: ask, bid_premium: bid, mid_premium: mid };
}

function level(strike: number, type: "call" | "put", totalPremium: number, netPremium: number): ActivityLevel {
  return { strike, type, activity: { totalPremium, netPremium, trend: "estable" } };
}

describe("summarizeActivity", () => {
  it("Premium Traded = ask + bid + mid, sin importar dirección", () => {
    const s = summarizeActivity([bucket("2026-01-01T00:00:00Z", 100, 40, 10)]);
    expect(s.totalPremium).toBe(150);
  });

  it("net premium = ask − bid, el mid queda afuera de la dirección", () => {
    const s = summarizeActivity([bucket("2026-01-01T00:00:00Z", 100, 40, 10)]);
    expect(s.netPremium).toBe(60);
  });

  it("con menos de 4 buckets no hay suficiente historia — tendencia 'estable'", () => {
    const s = summarizeActivity([bucket("2026-01-01T00:00:00Z", 100, 0), bucket("2026-01-01T00:05:00Z", 100, 0)]);
    expect(s.trend).toBe("estable");
  });

  it("actividad creciendo en la mitad reciente → 'subiendo'", () => {
    const s = summarizeActivity([
      bucket("2026-01-01T00:00:00Z", 10, 0), bucket("2026-01-01T00:05:00Z", 10, 0),
      bucket("2026-01-01T00:10:00Z", 100, 0), bucket("2026-01-01T00:15:00Z", 100, 0),
    ]);
    expect(s.trend).toBe("subiendo");
  });

  it("actividad cayendo en la mitad reciente → 'bajando'", () => {
    const s = summarizeActivity([
      bucket("2026-01-01T00:00:00Z", 100, 0), bucket("2026-01-01T00:05:00Z", 100, 0),
      bucket("2026-01-01T00:10:00Z", 10, 0), bucket("2026-01-01T00:15:00Z", 10, 0),
    ]);
    expect(s.trend).toBe("bajando");
  });

  it("sin buckets, todo en cero", () => {
    const s = summarizeActivity([]);
    expect(s).toEqual({ totalPremium: 0, netPremium: 0, trend: "estable" });
  });
});

describe("contratosVecinos3Signal — ejemplo real de Carlos (SPX en 7750)", () => {
  // Arriba: 7760 y 7770 con mucha actividad y net premium positivo (compra
  // agresiva de calls); 7775 con MENOS actividad que 7770 → probable techo.
  // Abajo: 7745 con muy poca actividad y net premium negativo (venta de puts
  // = soporte real).
  const above: ActivityLevel[] = [
    level(7755, "call", 20_000, 5_000),
    level(7760, "call", 500_000, 300_000),
    level(7765, "call", 30_000, 8_000),
    level(7770, "call", 480_000, 250_000),
    level(7775, "call", 100_000, 40_000),
  ];
  const below: ActivityLevel[] = [
    level(7740, "put", 25_000, 6_000),
    level(7745, "put", 8_000, -3_000),
  ];

  it("elige CALL — el lado con más Premium Traded confirmado", () => {
    const signal = contratosVecinos3Signal({ spot: 7750, above, below });
    expect(signal.type).toBe("call");
  });

  it("da target1=7760 y target2=7770, en ese orden", () => {
    const signal = contratosVecinos3Signal({ spot: 7750, above, below });
    expect(signal.target1?.strike).toBe(7760);
    expect(signal.target2?.strike).toBe(7770);
  });

  it("marca 7770 como probable techo porque 7775 tiene menos actividad", () => {
    const signal = contratosVecinos3Signal({ spot: 7750, above, below });
    expect(signal.capStrike).toBe(7770);
  });

  it("usa 7745 (puts, baja actividad + net premium negativo) como stop-loss", () => {
    const signal = contratosVecinos3Signal({ spot: 7750, above, below });
    expect(signal.stopLoss?.strike).toBe(7745);
    expect(signal.stopLoss?.type).toBe("put");
  });
});

describe("contratosVecinos3Signal — casos límite", () => {
  it("sin actividad real en ningún lado, no da dirección", () => {
    const signal = contratosVecinos3Signal({ spot: 100, above: [], below: [] });
    expect(signal.type).toBeNull();
    expect(signal.target1).toBeNull();
  });

  it("actividad alta pero VENDIDA (net premium negativo) es una pared, no un target — frena el camino", () => {
    const above: ActivityLevel[] = [
      level(105, "call", 500_000, -300_000), // pared real: mucha actividad, pero vendida
      level(110, "call", 400_000, 200_000), // no debería contarse: el camino ya se frenó antes
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.type).toBe("call");
    expect(signal.wallStrike).toBe(105);
    expect(signal.target1).toBeNull();
  });

  it("el lado PUT usa la misma lógica de forma simétrica", () => {
    const below: ActivityLevel[] = [
      level(95, "put", 500_000, 300_000),
      level(90, "put", 480_000, 250_000),
    ];
    const above: ActivityLevel[] = [level(105, "call", 5_000, 500)];
    const signal = contratosVecinos3Signal({ spot: 100, above, below });
    expect(signal.type).toBe("put");
    expect(signal.target1?.strike).toBe(95);
    expect(signal.target2?.strike).toBe(90);
  });

  it("con un solo target confirmado, target2 queda null", () => {
    const above: ActivityLevel[] = [level(105, "call", 500_000, 300_000)];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.target1?.strike).toBe(105);
    expect(signal.target2).toBeNull();
  });
});

describe("contratosVecinos3Signal — stop-loss acotado a los strikes más cercanos", () => {
  it("un strike de baja actividad DENTRO del tope sí cuenta como stop-loss", () => {
    // Caso real del ejemplo: below gana con actividad fuerte, above (perdedor)
    // tiene su primer strike de baja actividad dentro de STOP_LOSS_MAX_STRIKES (4).
    const below: ActivityLevel[] = [level(95, "put", 500_000, 300_000), level(90, "put", 480_000, 250_000)];
    const above: ActivityLevel[] = [level(105, "call", 1_000, -500)]; // baja actividad, vendida — strike #1, dentro del tope
    const signal = contratosVecinos3Signal({ spot: 100, above, below });
    expect(signal.stopLoss?.strike).toBe(105);
  });

  it("un strike de baja actividad MÁS ALLÁ del tope no cuenta — mejor sin stop-loss que uno inútil", () => {
    // Backtest real (SPX, 2026-08-13, 12:15 ET): el único strike de baja
    // actividad del lado perdedor quedaba a 49 puntos — matemáticamente
    // "correcto" pero inservible como gestión de riesgo real.
    const below: ActivityLevel[] = [level(95, "put", 500_000, 300_000), level(90, "put", 480_000, 250_000)];
    const above: ActivityLevel[] = [
      level(105, "call", 400_000, 200_000), // strike #1: mucha actividad Y comprada — no es de baja actividad
      level(110, "call", 380_000, 150_000), // strike #2: ídem
      level(115, "call", 350_000, 100_000), // strike #3: ídem
      level(120, "call", 300_000, 50_000),  // strike #4: ídem (el tope son los primeros 4)
      level(125, "call", 1_000, -500),      // strike #5: baja actividad vendida — FUERA del tope
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below });
    expect(signal.stopLoss).toBeNull();
  });
});

describe("contratosVecinos3Signal — un target confirmado gana sobre una pared más grande", () => {
  // Caso real: SPX, 2026-08-13, 10:35 ET, pico del día en $7816. El call de
  // arriba solo tenía una PARED en $7820 (mucho dinero acumulado, pero
  // vendido) mientras el put de abajo ya tenía DOS targets confirmados
  // (compra agresiva real) en $7810 y $7805, con MENOS dinero acumulado.
  const above: ActivityLevel[] = [level(7820, "call", 17_588_043, -23_112)]; // pared: mucha plata, pero vendida
  const below: ActivityLevel[] = [
    level(7810, "put", 12_135_426, 995_264), // confirmado: comprado agresivamente
    level(7805, "put", 11_787_894, 37_687),  // confirmado también
  ];

  it("elige PUT (targets confirmados) aunque la pared de CALL tenga más dólares acumulados", () => {
    const signal = contratosVecinos3Signal({ spot: 7816.31, above, below });
    expect(signal.type).toBe("put");
    expect(signal.target1?.strike).toBe(7810);
  });

  it("expone la pared de CALL como resistencia que refuerza la tesis PUT", () => {
    const signal = contratosVecinos3Signal({ spot: 7816.31, above, below });
    expect(signal.supportingWall?.strike).toBe(7820);
    expect(signal.supportingWall?.label).toBe("resistencia");
  });
});

describe("contratosVecinos3Signal — pared del lado contrario refuerza la tesis (supportingWall)", () => {
  // Caso real: SPX, 2026-08-13, 09:36 ET, señal CALL con venta real de puts
  // en $7780 — soporte que reforzaba la tesis alcista.
  it("venta de puts abajo aparece como soporte cuando la señal es CALL", () => {
    const above: ActivityLevel[] = [level(7785, "call", 4_793_756, 96_127)];
    const below: ActivityLevel[] = [level(7780, "put", 2_769_963, -124_782)];
    const signal = contratosVecinos3Signal({ spot: 7783.57, above, below });
    expect(signal.type).toBe("call");
    expect(signal.supportingWall?.strike).toBe(7780);
    expect(signal.supportingWall?.type).toBe("put");
    expect(signal.supportingWall?.label).toBe("soporte");
  });

  it("sin pared real del lado contrario, supportingWall queda null", () => {
    const above: ActivityLevel[] = [level(105, "call", 500_000, 300_000)];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.supportingWall).toBeNull();
  });
});

describe("applyPersistence", () => {
  const call: ContratosVecinos3Signal = {
    type: "call", target1: { strike: 105, totalPremium: 500_000, netPremium: 300_000 }, target2: null,
    capStrike: null, wallStrike: null, stopLoss: null, supportingWall: null, reason: "call",
  };
  const callUpgraded: ContratosVecinos3Signal = {
    ...call, target1: { strike: 110, totalPremium: 480_000, netPremium: 250_000 },
  };
  const put: ContratosVecinos3Signal = {
    type: "put", target1: { strike: 95, totalPremium: 500_000, netPremium: 300_000 }, target2: null,
    capStrike: null, wallStrike: null, stopLoss: null, supportingWall: null, reason: "put",
  };
  const noTarget: ContratosVecinos3Signal = {
    type: null, target1: null, target2: null, capStrike: null, wallStrike: null, stopLoss: null,
    supportingWall: null, reason: "nada",
  };

  it(`con menos de ${PERSISTENCE_REQUIRED} lecturas, nunca está confirmado`, () => {
    const history = Array(PERSISTENCE_REQUIRED - 1).fill(call);
    expect(applyPersistence(history).confirmed).toBe(false);
  });

  it(`con ${PERSISTENCE_REQUIRED} lecturas seguidas de la misma dirección, confirma`, () => {
    const history = Array(PERSISTENCE_REQUIRED).fill(call);
    expect(applyPersistence(history).confirmed).toBe(true);
  });

  it("dejar correr una posición (el target sube) NO resetea la confirmación", () => {
    const history = [call, call, callUpgraded];
    const result = applyPersistence(history);
    expect(result.confirmed).toBe(true);
    expect(result.target1?.strike).toBe(110);
  });

  it("un cambio de dirección reinicia la cuenta — no confirma de inmediato", () => {
    const history = [call, call, call, put];
    expect(applyPersistence(history).confirmed).toBe(false);
  });

  it("una lectura real de 2026-08-13: un PUT suelto de 1 minuto invalida la confirmación, incluso al volver a call", () => {
    // Reproduce el caso real: call, call, call (confirmado), un PUT suelto,
    // vuelve a call — pero recién con UNA lectura de vuelta, todavía no
    // alcanza para volver a confirmar (hacen falta 3 limpias de nuevo).
    const history = [call, call, call, put, call];
    expect(applyPersistence(history.slice(0, 3)).confirmed).toBe(true); // antes del parpadeo, sí estaba confirmado
    expect(applyPersistence(history.slice(0, 4)).confirmed).toBe(false); // justo en el minuto del PUT suelto, no confirma
    expect(applyPersistence(history).confirmed).toBe(false); // recién 1 lectura después de volver, todavía no alcanza
  });

  it("sin dirección (type null), nunca confirma aunque se repita", () => {
    const history = Array(PERSISTENCE_REQUIRED).fill(noTarget);
    expect(applyPersistence(history).confirmed).toBe(false);
  });

  it("historial vacío no revienta — devuelve la señal vacía sin confirmar", () => {
    const result = applyPersistence([]);
    expect(result.confirmed).toBe(false);
    expect(result.type).toBeNull();
  });
});
