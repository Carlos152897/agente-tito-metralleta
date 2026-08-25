import { describe, expect, it } from "vitest";
import {
  applyPersistence, contratosVecinos3Signal, evaluateCapCandidate, orderBookSentiment, PERSISTENCE_REQUIRED, summarizeActivity,
  type ActivityLevel, type ContratosVecinos3Signal, type TradeSummaryBucketLike,
} from "./contratosVecinos3";

/** Nivel con ask/bid/mid explícitos (para `orderBookSentiment`) — `level()` de abajo no los setea. */
function rawLevel(
  strike: number, type: "call" | "put", parts: { ask: number; bid: number; mid?: number },
): ActivityLevel {
  const mid = parts.mid ?? 0;
  return {
    strike, type,
    activity: {
      totalPremium: parts.ask + parts.bid + mid, netPremium: parts.ask - parts.bid, trend: "estable",
      askPremium: parts.ask, bidPremium: parts.bid, midPremium: mid,
    },
  };
}

function bucket(t: string, ask: number, bid: number, mid = 0): TradeSummaryBucketLike {
  return { t, ask_premium: ask, bid_premium: bid, mid_premium: mid };
}

function level(
  strike: number, type: "call" | "put", totalPremium: number, netPremium: number,
  trend: "subiendo" | "bajando" | "estable" = "estable",
): ActivityLevel {
  return { strike, type, activity: { totalPremium, netPremium, trend } };
}

/** Como `level`, pero con el tipo CONTRARIO también presente en el mismo strike (para `capReversal`). */
function levelWithOther(strike: number, type: "call" | "put", totalPremium: number, netPremium: number, otherNetPremium: number): ActivityLevel {
  return {
    strike, type, activity: { totalPremium, netPremium, trend: "estable" },
    otherActivity: { totalPremium: Math.abs(otherNetPremium), netPremium: otherNetPremium, trend: "estable" },
  };
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

  it("net premium NO se acumula — es solo el ÚLTIMO bucket (pedido explícito de Carlos, 2026-08-24)", () => {
    // Caso real: SPX 2026-08-21, call $7670, 9:30-9:40am ET. El acumulado del
    // día venía vendido (mañana con más bid que ask), pero el bucket de las
    // 9:40 solo fue comprador (ask 696,232 vs bid 320,166). El acumulado daba
    // -351,493 — invisible que ESE bucket puntual ya era comprador. Con
    // netPremium = solo el último bucket, se ve la compra real de AHORA.
    const s = summarizeActivity([
      bucket("2026-08-21T13:30:00.000Z", 552_969, 913_261), // apertura, vendido
      bucket("2026-08-21T13:35:00.000Z", 796_901, 988_929), // vendido
      bucket("2026-08-21T14:35:00.000Z", 569_844, 438_455), // comprado
      bucket("2026-08-21T14:40:00.000Z", 696_232, 320_166), // último bucket: comprado fuerte
    ]);
    expect(s.netPremium).toBe(696_232 - 320_166);
    expect(s.netPremium).not.toBe(552_969 - 913_261 + 796_901 - 988_929 + 569_844 - 438_455 + 696_232 - 320_166); // no es la suma acumulada
  });

  it("el orden de los buckets no importa — siempre usa el más reciente por timestamp, no el último del array", () => {
    const s = summarizeActivity([
      bucket("2026-01-01T00:10:00Z", 50, 200), // el más reciente por tiempo, pero PRIMERO en el array
      bucket("2026-01-01T00:00:00Z", 999, 1), // más viejo, pero ÚLTIMO en el array
    ]);
    expect(s.netPremium).toBe(50 - 200);
  });

  it("sin buckets, net premium es 0 (no hay lectura que dar)", () => {
    const s = summarizeActivity([]);
    expect(s.netPremium).toBe(0);
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
    expect(s).toEqual({ totalPremium: 0, netPremium: 0, trend: "estable", askPremium: 0, bidPremium: 0, midPremium: 0 });
  });

  it("salto repentino en los últimos 10 min NO se diluye con muchas horas de historia previa plana", () => {
    // 20 buckets planos (100 c/u, ritmo base = 100/bucket) + un salto real
    // (500, 500) en los últimos dos — comparar mitad-del-día-vs-mitad-del-día
    // (versión vieja) hubiera promediado el salto contra 10 buckets de
    // historia y no hubiera cruzado el umbral. Comparando ritmo reciente vs.
    // ritmo previo sí lo detecta.
    const flat = Array.from({ length: 20 }, (_, i) => bucket(`2026-01-01T${String(i).padStart(2, "0")}:00:00Z`, 100, 0));
    const spike = [bucket("2026-01-01T20:00:00Z", 500, 0), bucket("2026-01-01T21:00:00Z", 500, 0)];
    const s = summarizeActivity([...flat, ...spike]);
    expect(s.trend).toBe("subiendo");
  });

  it("acumulación lenta y pareja de TODO el día ya NO cuenta como 'subiendo' (no es repentina)", () => {
    // Cada bucket un poquito más grande que el anterior, sin ningún salto —
    // el ritmo reciente (últimos 2) es apenas mayor al ritmo base, muy por
    // debajo del umbral de salto (2x).
    const gradual = Array.from({ length: 10 }, (_, i) => bucket(`2026-01-01T${String(i).padStart(2, "0")}:00:00Z`, 100 + i * 5, 0));
    const s = summarizeActivity(gradual);
    expect(s.trend).toBe("estable");
  });

  it("contrato sin actividad previa que de golpe empieza a operarse cuenta como 'subiendo' (el salto más repentino posible)", () => {
    const dead = Array.from({ length: 8 }, (_, i) => bucket(`2026-01-01T${String(i).padStart(2, "0")}:00:00Z`, 0, 0));
    const sudden = [bucket("2026-01-01T08:00:00Z", 50_000, 0), bucket("2026-01-01T09:00:00Z", 50_000, 0)];
    const s = summarizeActivity([...dead, ...sudden]);
    expect(s.trend).toBe("subiendo");
  });
});

describe("orderBookSentiment", () => {
  it("bid y ask casi iguales → balanceado, mensaje de posible rebote", () => {
    const above = [rawLevel(105, "call", { ask: 100_000, bid: 95_000 })];
    const below = [rawLevel(95, "put", { ask: 90_000, bid: 100_000 })];
    const s = orderBookSentiment({ spot: 100, above, below });
    expect(s.balanced).toBe(true);
    expect(s.message).toMatch(/rebote/);
  });

  it("ejemplo de Carlos: puts dominan Y se compran agresivamente al ask → 'desangrando BAJISTA'", () => {
    const above = [rawLevel(105, "call", { ask: 10_000, bid: 10_000 })]; // calls chicos y parejos
    const below = [rawLevel(95, "put", { ask: 500_000, bid: 50_000 })]; // puts grandes, comprados fuerte al ask
    const s = orderBookSentiment({ spot: 100, above, below });
    expect(s.balanced).toBe(false);
    expect(s.dominantSide).toBe("put");
    expect(s.dominantNetPremium).toBeGreaterThan(0);
    expect(s.message).toMatch(/BAJISTA/);
  });

  it("calls dominan y se compran al ask → 'To the moon' (no 'desangrando', eso es solo bajista)", () => {
    const above = [rawLevel(105, "call", { ask: 500_000, bid: 50_000 })];
    const below = [rawLevel(95, "put", { ask: 10_000, bid: 10_000 })];
    const s = orderBookSentiment({ spot: 100, above, below });
    expect(s.dominantSide).toBe("call");
    expect(s.message).toMatch(/moon/i);
    expect(s.message).not.toMatch(/Desangrando/);
  });

  it("desbalanceado pero el lado dominante se está VENDIENDO (net negativo) — no confirma dirección", () => {
    const above = [rawLevel(105, "call", { ask: 10_000, bid: 10_000 })];
    const below = [rawLevel(95, "put", { ask: 50_000, bid: 500_000 })]; // puts dominan pero VENDIDOS
    const s = orderBookSentiment({ spot: 100, above, below });
    expect(s.balanced).toBe(false);
    expect(s.dominantSide).toBe("put");
    expect(s.dominantNetPremium).toBeLessThan(0);
    expect(s.message).not.toMatch(/Desangrando/);
    expect(s.message).toMatch(/sin compra agresiva/);
  });

  it("suma el tipo CONTRARIO en cada strike (otherActivity) al order book y al sentiment del lado que corresponde", () => {
    const above: ActivityLevel[] = [
      { ...rawLevel(105, "call", { ask: 10_000, bid: 10_000 }), otherActivity: { totalPremium: 200_000, netPremium: 150_000, trend: "estable", askPremium: 175_000, bidPremium: 25_000, midPremium: 0 } },
    ];
    const below: ActivityLevel[] = [rawLevel(95, "put", { ask: 10_000, bid: 10_000 })];
    const s = orderBookSentiment({ spot: 100, above, below });
    // El "otherActivity" de arriba (105) es PUT (contrario de call) — debe sumar al lado put.
    expect(s.putPremium).toBe(200_000 + 20_000); // 200k del otherActivity + 20k del put de abajo
    expect(s.askPremium).toBe(10_000 + 175_000 + 10_000); // los 3 asks del vecindario
  });

  it("sin actividad en ningún lado — sin lectura", () => {
    const s = orderBookSentiment({ spot: 100, above: [], below: [] });
    expect(s.dominantSide).toBeNull();
    expect(s.message).toMatch(/Sin actividad/);
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

describe("contratosVecinos3Signal — compra real detrás de la pared del lado GANADOR (breakoutWatch)", () => {
  it("sigue mirando detrás de la pared y expone la compra real como breakoutWatch, sin ascenderla a target", () => {
    // Mismos números reales del caso de abajo (SPX 2026-08-14, 10:05 ET),
    // pero con `above` vacío para aislar el comportamiento de UN solo lado
    // (para que ese lado gane trivialmente, sin entrar en pickWinner).
    const below: ActivityLevel[] = [
      level(7805, "put", 11_355_381, -703_519), // pared: mucha plata, vendida
      level(7800, "put", 13_608_254, 36_778), // detrás de la pared: compra real
    ];
    const signal = contratosVecinos3Signal({ spot: 7807.01, above: [], below });
    expect(signal.type).toBe("put");
    expect(signal.wallStrike).toBe(7805);
    expect(signal.target1).toBeNull(); // sigue sin ser un target — la pared no se rompió
    expect(signal.breakoutWatch?.strike).toBe(7800);
    expect(signal.breakoutWatch?.netPremium).toBe(36_778);
  });

  it("sin compra real detrás de la pared, breakoutWatch queda null (comportamiento de antes, sin cambios)", () => {
    const above: ActivityLevel[] = [
      level(105, "call", 500_000, -300_000), // pared
      level(110, "call", 400_000, -200_000), // también vendida, no confirma nada
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.wallStrike).toBe(105);
    expect(signal.breakoutWatch).toBeNull();
  });

  it("con un target ya confirmado antes de la pared, breakoutWatch se sigue exponiendo aparte", () => {
    const above: ActivityLevel[] = [
      level(105, "call", 500_000, 300_000), // target confirmado
      level(110, "call", 400_000, -250_000), // pared después del target
      level(115, "call", 350_000, 150_000), // compra real detrás de esa pared
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.target1?.strike).toBe(105);
    expect(signal.wallStrike).toBe(110);
    expect(signal.breakoutWatch?.strike).toBe(115);
  });
});

describe("contratosVecinos3Signal — compra real detrás de la pared del lado PERDEDOR (reversalWatch)", () => {
  // Caso real: SPX 2026-08-14, 10:05 ET, spot $7807.01. El motor elige CALL
  // porque la pared en $7810 (calls) acumuló más dólares ($14.2M) que la
  // pared en $7805 (puts, $11.3M) — ninguno de los dos lados tenía target
  // confirmado, así que ganó por magnitud de la pared. Pero DETRÁS de la
  // pared de puts, en $7800, ya había compra real y CRECIENTE (net
  // +$36,778, subió a +$425,017 hacia las 10:15) — antes esto era invisible
  // porque solo se miraba el lado ganador.
  it("expone la compra real del lado perdedor como reversalWatch, sin cambiar el veredicto principal", () => {
    const above: ActivityLevel[] = [level(7810, "call", 14_221_439, -67_351)]; // gana por magnitud de la pared
    const below: ActivityLevel[] = [
      level(7805, "put", 11_355_381, -703_519), // pared del lado perdedor
      level(7800, "put", 13_608_254, 36_778), // compra real detrás de ESA pared
    ];
    const signal = contratosVecinos3Signal({ spot: 7807.01, above, below });
    expect(signal.type).toBe("call"); // el veredicto no cambia
    expect(signal.wallStrike).toBe(7810);
    expect(signal.breakoutWatch).toBeNull(); // el lado ganador no tiene nada detrás de su propia pared
    expect(signal.reversalWatch?.strike).toBe(7800);
    expect(signal.reversalWatch?.type).toBe("put");
    expect(signal.reversalWatch?.netPremium).toBe(36_778);
  });

  it("sin compra real detrás de la pared del perdedor, reversalWatch queda null", () => {
    const above: ActivityLevel[] = [level(105, "call", 500_000, -300_000)]; // gana, sin nada raro
    const below: ActivityLevel[] = [level(95, "put", 400_000, -200_000)]; // pierde, pared sin compra detrás
    const signal = contratosVecinos3Signal({ spot: 100, above, below });
    expect(signal.reversalWatch).toBeNull();
  });
});

describe("contratosVecinos3Signal — actividad inusual (Premium Traded subiendo AHORA)", () => {
  it("marca target1.unusual cuando el Premium Traded del strike venía subiendo", () => {
    const above: ActivityLevel[] = [level(105, "call", 500_000, 300_000, "subiendo")];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.target1?.unusual).toBe(true);
    expect(signal.reason).toContain("Actividad inusual");
    expect(signal.reason).toContain("$105");
  });

  it("target1.unusual queda false con actividad alta pero estable/bajando (dinero acumulado, no repentino)", () => {
    const above: ActivityLevel[] = [level(105, "call", 500_000, 300_000, "bajando")];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.target1?.unusual).toBe(false);
    expect(signal.reason).not.toContain("Actividad inusual");
  });

  it("beyondWall/reversalWatch también llevan el flag (comparten el tipo ContratosVecinos3Target)", () => {
    const below: ActivityLevel[] = [
      level(7805, "put", 11_355_381, -703_519), // pared
      level(7800, "put", 13_608_254, 36_778, "subiendo"), // compra real y repentina detrás
    ];
    const signal = contratosVecinos3Signal({ spot: 7807.01, above: [], below });
    expect(signal.breakoutWatch?.unusual).toBe(true);
  });
});

describe("contratosVecinos3Signal — capReversal (confirmación de punto máximo con Net Premium)", () => {
  it("contraSideAggressive: el put también entra al ask en el MISMO strike del target call → posible agotamiento", () => {
    // 105 es el único target (nada más lejos que compare Premium Traded, así
    // que capStrike por volumen no dispara) — pero el put ahí también está
    // siendo comprado agresivamente (net premium positivo).
    const above: ActivityLevel[] = [levelWithOther(105, "call", 500_000, 300_000, 50_000)];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.capReversal?.strike).toBe(105);
    expect(signal.capReversal?.contraSideAggressive).toBe(true);
    expect(signal.capReversal?.nextStrikeSelling).toBe(false);
    expect(signal.reason).toContain("Posible agotamiento en $105");
  });

  it("nextStrikeSelling: el siguiente strike (mismo tipo) ya tiene net premium negativo → confirma resistencia justo después", () => {
    const above: ActivityLevel[] = [
      level(105, "call", 500_000, 300_000), // target
      level(110, "call", 200_000, -80_000), // siguiente: ya se vende
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.capReversal?.strike).toBe(105);
    expect(signal.capReversal?.nextStrikeSelling).toBe(true);
    expect(signal.capReversal?.contraSideAggressive).toBe(false);
  });

  it("sin tensión en el mismo strike NI venta en el siguiente, capReversal queda null", () => {
    const above: ActivityLevel[] = [
      levelWithOther(105, "call", 500_000, 300_000, -20_000), // put vendiendo ahí, no comprando — sin tensión
      level(110, "call", 200_000, 100_000), // siguiente sigue comprado (positivo), no vendiendo
    ];
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.capReversal).toBeNull();
  });

  it("detrás de una pared real (wallStrike), capReversal no se calcula — la pared ya frenó el camino", () => {
    const above: ActivityLevel[] = [levelWithOther(105, "call", 500_000, -300_000, 50_000)]; // pared, no target
    const signal = contratosVecinos3Signal({ spot: 100, above, below: [] });
    expect(signal.wallStrike).toBe(105);
    expect(signal.target1).toBeNull();
    expect(signal.capReversal).toBeNull();
  });
});

describe("evaluateCapCandidate — ejemplo real de Carlos (SPX en 7700, actividad explotando en 7725)", () => {
  // Camino limpio: 7705→7710→7715→7720 todos comprados y en aumento, puts
  // vendiendo en esos mismos strikes; 7725 explota (trend "subiendo"); 7730
  // confirma (menos plata, vendido); abajo del spot los puts no agreden.
  const cleanPath: ActivityLevel[] = [
    levelWithOther(7705, "call", 1_000_000, 200_000, -50_000),
    levelWithOther(7710, "call", 1_500_000, 300_000, -80_000),
    levelWithOther(7715, "call", 2_000_000, 400_000, -100_000),
    levelWithOther(7720, "call", 2_500_000, 600_000, -150_000),
    level(7725, "call", 8_000_000, 3_000_000, "subiendo"),
    level(7730, "call", 1_200_000, -200_000),
  ];
  const cleanBelow: ActivityLevel[] = [level(7695, "put", 900_000, -100_000), level(7690, "put", 700_000, -50_000)];

  it("confirma el candidato cuando los cinco chequeos pasan", () => {
    const result = evaluateCapCandidate(cleanPath, cleanBelow);
    expect(result?.strike).toBe(7725);
    expect(result?.pathAllPositive).toBe(true);
    expect(result?.pathBuildingUp).toBe(true);
    expect(result?.pathOppositeClean).toBe(true);
    expect(result?.nextStrikeConfirms).toBe(true);
    expect(result?.opposingSideClean).toBe(true);
    expect(result?.confirmed).toBe(true);
  });

  it("sin tendencia 'subiendo' en el strike de más actividad, no hay candidato (null)", () => {
    const flat = cleanPath.map((l) => (l.strike === 7725 ? { ...l, activity: { ...l.activity, trend: "estable" as const } } : l));
    expect(evaluateCapCandidate(flat, cleanBelow)).toBeNull();
  });

  it("un strike del camino vendido (net premium negativo) rompe pathAllPositive", () => {
    const broken = cleanPath.map((l) => (l.strike === 7715 ? { ...l, activity: { ...l.activity, netPremium: -50_000 } } : l));
    const result = evaluateCapCandidate(broken, cleanBelow);
    expect(result?.pathAllPositive).toBe(false);
    expect(result?.confirmed).toBe(false);
  });

  it("un bajón en medio del camino (no viene en aumento parejo) rompe pathBuildingUp", () => {
    const dip = cleanPath.map((l) => (l.strike === 7715 ? { ...l, activity: { ...l.activity, totalPremium: 100_000 } } : l));
    const result = evaluateCapCandidate(dip, cleanBelow);
    expect(result?.pathBuildingUp).toBe(false);
    expect(result?.confirmed).toBe(false);
  });

  it("el tipo contrario comprando en algún strike del camino rompe pathOppositeClean", () => {
    const contested = cleanPath.map((l) =>
      l.strike === 7710 ? { ...l, otherActivity: { totalPremium: 90_000, netPremium: 90_000, trend: "estable" as const } } : l,
    );
    const result = evaluateCapCandidate(contested, cleanBelow);
    expect(result?.pathOppositeClean).toBe(false);
    expect(result?.confirmed).toBe(false);
  });

  it("el strike siguiente (7730) todavía comprado o con más plata que el candidato rompe nextStrikeConfirms", () => {
    const noConfirm = cleanPath.map((l) => (l.strike === 7730 ? { ...l, activity: { ...l.activity, netPremium: 50_000 } } : l));
    const result = evaluateCapCandidate(noConfirm, cleanBelow);
    expect(result?.nextStrikeConfirms).toBe(false);
    expect(result?.confirmed).toBe(false);
  });

  it("agresión del lado opuesto del tablero (puts abajo del spot comprando) rompe opposingSideClean", () => {
    const aggressiveBelow = [level(7695, "put", 900_000, 500_000), level(7690, "put", 700_000, -50_000)];
    const result = evaluateCapCandidate(cleanPath, aggressiveBelow);
    expect(result?.opposingSideClean).toBe(false);
    expect(result?.confirmed).toBe(false);
  });

  it("sin levels del lado ganador, devuelve null", () => {
    expect(evaluateCapCandidate([], cleanBelow)).toBeNull();
  });

  it("funciona simétrico para el lado PUT (ejemplo bajista de Carlos: actividad explotando en 7680 abajo)", () => {
    const putPath: ActivityLevel[] = [
      levelWithOther(7695, "put", 1_000_000, 200_000, -50_000),
      levelWithOther(7690, "put", 1_500_000, 350_000, -90_000),
      levelWithOther(7685, "put", 2_200_000, 500_000, -120_000),
      level(7680, "put", 7_500_000, 2_800_000, "subiendo"),
      level(7675, "put", 900_000, -180_000),
    ];
    const callsAbove: ActivityLevel[] = [level(7705, "call", 800_000, -90_000), level(7710, "call", 600_000, -40_000)];
    const result = evaluateCapCandidate(putPath, callsAbove);
    expect(result?.strike).toBe(7680);
    expect(result?.confirmed).toBe(true);
  });

  it("integrado en contratosVecinos3Signal: capCandidate viaja en la señal completa y suma al texto de razón", () => {
    const signal = contratosVecinos3Signal({ spot: 7700, above: cleanPath, below: cleanBelow });
    expect(signal.capCandidate?.strike).toBe(7725);
    expect(signal.capCandidate?.confirmed).toBe(true);
    expect(signal.reason).toContain("Actividad explotando en $7725");
    expect(signal.reason).toContain("candidato fuerte a punto máximo real");
  });
});

describe("applyPersistence", () => {
  const call: ContratosVecinos3Signal = {
    type: "call", target1: { strike: 105, totalPremium: 500_000, netPremium: 300_000, unusual: false }, target2: null,
    capStrike: null, capReversal: null, wallStrike: null, stopLoss: null, supportingWall: null, breakoutWatch: null, reversalWatch: null, capCandidate: null, reason: "call",
  };
  const callUpgraded: ContratosVecinos3Signal = {
    ...call, target1: { strike: 110, totalPremium: 480_000, netPremium: 250_000, unusual: false },
  };
  const put: ContratosVecinos3Signal = {
    type: "put", target1: { strike: 95, totalPremium: 500_000, netPremium: 300_000, unusual: false }, target2: null,
    capStrike: null, capReversal: null, wallStrike: null, stopLoss: null, supportingWall: null, breakoutWatch: null, reversalWatch: null, capCandidate: null, reason: "put",
  };
  const noTarget: ContratosVecinos3Signal = {
    type: null, target1: null, target2: null, capStrike: null, capReversal: null, wallStrike: null, stopLoss: null,
    supportingWall: null, breakoutWatch: null, reversalWatch: null, capCandidate: null, reason: "nada",
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
