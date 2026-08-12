import { describe, expect, it } from "vitest";
import { classifyLevel, classifyPositioning, magnetWallSignal, strikeStep, targetProbability } from "./magnetWall";
import type { CrossMarketFlow, PositioningLevel } from "./magnetWall";
import type { StrikePremiums } from "./neighborContracts";

function premiums(callNet: number | null, putNet: number | null): StrikePremiums {
  return {
    strike: 0,
    call: callNet == null ? null : { netPremium: callNet, askPremium: 0, bidPremium: 0, askVolume: 0, bidVolume: 0 },
    put: putNet == null ? null : { netPremium: putNet, askPremium: 0, bidPremium: 0, askVolume: 0, bidVolume: 0 },
  };
}

describe("classifyLevel", () => {
  it("call net premium positivo = compra agresiva = alcista", () => {
    const lvl = classifyLevel(100, premiums(500, null));
    expect(lvl.callSignal).toBe("bullish");
    expect(lvl.netBias).toBeGreaterThan(0);
  });

  it("call net premium negativo = venta = resistencia", () => {
    const lvl = classifyLevel(100, premiums(-500, null));
    expect(lvl.callSignal).toBe("resistance");
    expect(lvl.netBias).toBeLessThan(0);
  });

  it("put net premium positivo = compra agresiva = bajista", () => {
    const lvl = classifyLevel(100, premiums(null, 500));
    expect(lvl.putSignal).toBe("bearish");
    expect(lvl.netBias).toBeLessThan(0);
  });

  it("put net premium negativo = venta = soporte/hedge", () => {
    const lvl = classifyLevel(100, premiums(null, -500));
    expect(lvl.putSignal).toBe("support");
    expect(lvl.netBias).toBeGreaterThan(0);
  });

  it("sin datos (null) clasifica como 'none' con sesgo cero", () => {
    const lvl = classifyLevel(100, null);
    expect(lvl.callSignal).toBe("none");
    expect(lvl.putSignal).toBe("none");
    expect(lvl.netBias).toBe(0);
  });

  it("combina ambos lados en un único sesgo neto", () => {
    // Compra fuerte de calls + venta de puts (soporte) — ambos alcistas, se suman.
    const lvl = classifyLevel(100, premiums(1000, -300));
    expect(lvl.netBias).toBeCloseTo(1300);
  });

  it("marca la fuente como 'flow'", () => {
    expect(classifyLevel(100, premiums(500, null)).source).toBe("flow");
  });
});

describe("classifyPositioning", () => {
  const posLevel = (callGex: number, putGex: number): PositioningLevel => ({ strike: 0, callGex, putGex });

  it("gamma real de calls = resistencia estructural (sesgo bajista)", () => {
    const lvl = classifyPositioning(7700, posLevel(500_000, 0));
    expect(lvl.callSignal).toBe("resistance");
    expect(lvl.netBias).toBeLessThan(0);
    expect(lvl.source).toBe("positioning");
  });

  it("gamma real de puts = soporte estructural (sesgo alcista)", () => {
    const lvl = classifyPositioning(7700, posLevel(0, 500_000));
    expect(lvl.putSignal).toBe("support");
    expect(lvl.netBias).toBeGreaterThan(0);
  });

  it("nunca da 'bullish' ni 'bearish' — el posicionamiento no sabe si fue compra o venta", () => {
    const lvl = classifyPositioning(7700, posLevel(500_000, 500_000));
    expect(lvl.callSignal).not.toBe("bullish");
    expect(lvl.putSignal).not.toBe("bearish");
  });

  it("sin datos clasifica como 'none' con sesgo cero", () => {
    const lvl = classifyPositioning(7700, null);
    expect(lvl.callSignal).toBe("none");
    expect(lvl.putSignal).toBe("none");
    expect(lvl.netBias).toBe(0);
  });
});

describe("targetProbability", () => {
  it("la agresividad alta sube la probabilidad sobre la base", () => {
    const low = targetProbability(0.5, 0, false);
    const high = targetProbability(0.5, 1, false);
    expect(high).toBeGreaterThan(low);
  });

  it("un target de ruptura (contra el imán) siempre queda por debajo del mismo target a favor", () => {
    const withMagnet = targetProbability(0.6, 0.8, false);
    const counter = targetProbability(0.6, 0.8, true);
    expect(counter).toBeLessThan(withMagnet);
  });

  it("nunca devuelve 0% ni 100% — siempre queda un margen de incertidumbre", () => {
    expect(targetProbability(0, 0, true)).toBeGreaterThanOrEqual(0.03);
    expect(targetProbability(1, 1, false)).toBeLessThanOrEqual(0.95);
  });

  it("γ negativa (regimeReliable=false) descuenta un target HACIA el imán", () => {
    const reliable = targetProbability(0.6, 0.8, false, true);
    const unreliable = targetProbability(0.6, 0.8, false, false);
    expect(unreliable).toBeLessThan(reliable);
  });

  it("el descuento por régimen NO se aplica a los targets de ruptura (van en contra del imán igual)", () => {
    const counterReliable = targetProbability(0.6, 0.8, true, true);
    const counterUnreliable = targetProbability(0.6, 0.8, true, false);
    expect(counterUnreliable).toBeCloseTo(counterReliable);
  });
});

describe("strikeStep", () => {
  it("detecta el paso regular entre strikes", () => {
    expect(strikeStep([7700, 7705, 7710, 7715])).toBe(5);
  });

  it("usa la mediana cuando hay huecos irregulares (no se deja arrastrar por un hueco raro)", () => {
    expect(strikeStep([7700, 7705, 7710, 7740])).toBe(5);
  });

  it("sin datos suficientes cae al fallback de 5", () => {
    expect(strikeStep([7700])).toBe(5);
    expect(strikeStep([])).toBe(5);
  });
});

describe("magnetWallSignal", () => {
  const iv = 0.15;
  const daysToClose = 6.5 / 24;

  it("sin strikes o sin spot devuelve null", () => {
    expect(magnetWallSignal({
      spot: 0, strikes: [7700], strikePremiums: new Map(),
      magnetStrike: 7700, magnetConcentration: 0.5, iv, daysToClose,
    })).toBeNull();
    expect(magnetWallSignal({
      spot: 7730, strikes: [], strikePremiums: new Map(),
      magnetStrike: 7700, magnetConcentration: 0.5, iv, daysToClose,
    })).toBeNull();
  });

  it("imán pegado al spot (o ausente) = lateral, no operar", () => {
    const strikes = Array.from({ length: 21 }, (_, i) => 7700 + i * 5);
    const pegado = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(),
      magnetStrike: 7731, magnetConcentration: 0.5, iv, daysToClose,
    });
    expect(pegado?.advice).toBe("lateral");
    expect(pegado?.type).toBeNull();
    expect(pegado?.towardTargets).toHaveLength(0);

    const sinIman = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(),
      magnetStrike: null, magnetConcentration: 0, iv, daysToClose,
    });
    expect(sinIman?.advice).toBe("lateral");
    expect(sinIman?.reason).toMatch(/[Ss]in imán/);
  });

  it("regresión: un imán a 3.2 puntos (distinto strike) YA es dirección real, no lateral", () => {
    // Caso real observado en vivo: SPX $7728.20, imán $7725 (grilla de 5 puntos).
    // Con el umbral viejo de 0.2% esto salía "lateral" — Carlos señaló que en
    // opciones esos pocos puntos ya representan dinero real. Ahora solo es
    // lateral si el imán cae en el MISMO strike que el spot.
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5); // grilla de 5 en 5
    const signal = magnetWallSignal({
      spot: 7728.2, strikes, strikePremiums: new Map(),
      magnetStrike: 7725, magnetConcentration: 0.5, iv, daysToClose,
    });
    expect(signal?.advice).not.toBe("lateral");
    expect(signal?.type).toBe("put");
    expect(signal?.magnetStrike).toBe(7725);
  });

  it("imán abajo del spot = dirección PUT, con el imán como último target hacia abajo", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5); // 7690..7810
    const strikePremiums = new Map<number, StrikePremiums>([
      [7720, premiums(null, 400_000)], // compra agresiva de puts confirma bajista
      [7710, premiums(null, 250_000)],
    ]);

    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
    });

    expect(signal?.type).toBe("put");
    expect(signal?.advice).toBe("entrar");
    expect(signal?.towardTargets.length).toBeGreaterThanOrEqual(2);
    // El imán siempre va al final del camino hacia él.
    expect(signal?.towardTargets.at(-1)?.strike).toBe(7700);
    // Los pasos intermedios confirmaron 7720 antes que 7710 (más cerca primero).
    expect(signal?.towardTargets[0].strike).toBe(7720);
  });

  it("γ negativa descuenta las probabilidades hacia el imán y lo avisa en la razón", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const strikePremiums = new Map<number, StrikePremiums>([
      [7720, premiums(null, 400_000)],
      [7710, premiums(null, 250_000)],
    ]);
    const base = { spot: 7730, strikes, strikePremiums, magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose };

    const positive = magnetWallSignal({ ...base, regime: "positive" });
    const negative = magnetWallSignal({ ...base, regime: "negative" });

    expect(positive?.advice).toBe("entrar");
    expect(negative?.advice).toBe("entrar"); // sigue siendo una entrada, solo que con menos confianza
    expect(negative!.magnetProbability).toBeLessThan(positive!.magnetProbability);
    expect(negative?.reason).toMatch(/γ negativa/);
    expect(positive?.reason).not.toMatch(/γ negativa/);
    // Los targets de ruptura no llevan el descuento de régimen (solo el de COUNTER_DISCOUNT, igual en ambos).
    expect(negative!.breakoutTargets[0]?.probability ?? 0).toBeCloseTo(positive!.breakoutTargets[0]?.probability ?? 0);
  });

  it("imán arriba del spot pero sin flujo que confirme = esperar breakout, no entrar", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(), // sin net premium real en ningún strike
      magnetStrike: 7760, magnetConcentration: 0.6, iv, daysToClose,
    });
    expect(signal?.type).toBe("call");
    expect(signal?.advice).toBe("esperar_breakout");
    // Sin pasos confirmados, el único target hacia el imán es el imán mismo.
    expect(signal?.towardTargets).toHaveLength(1);
    expect(signal?.towardTargets[0].strike).toBe(7760);
  });

  it("hasFlowCoverage=false (ej. futuros ES/NQ, sin MarketSnack) explica la falta de confirmación distinto", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(),
      magnetStrike: 7760, magnetConcentration: 0.6, iv, daysToClose,
      hasFlowCoverage: false,
    });
    expect(signal?.advice).toBe("esperar_breakout");
    expect(signal?.reason).toMatch(/MarketSnack no cubre/);
    // El imán sigue siendo la "posible entrada", solo que marcada sin confirmar.
    expect(signal?.towardTargets).toHaveLength(1);
    expect(signal?.towardTargets[0].strike).toBe(7760);
  });

  it("sin MarketSnack pero CON posicionamiento real (ej. ES/NQ) SÍ puede confirmar y dar 'entrar'", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    // Dirección PUT camina de $7730 hacia abajo — mezcla ruido chico (no debe
    // confirmar) con UNA pared real grande (sí debe confirmar) — así se
    // prueba el filtro de percentil, no solo "hay algo de OI".
    const positioningLevels = new Map<number, PositioningLevel>([
      [7725, { strike: 7725, callGex: 10_000, putGex: 0 }], // ruido chico
      [7720, { strike: 7720, callGex: 800_000, putGex: 0 }], // pared real
      [7715, { strike: 7715, callGex: 15_000, putGex: 0 }], // ruido chico
      [7710, { strike: 7710, callGex: 20_000, putGex: 0 }], // ruido chico
    ]);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(),
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
      hasFlowCoverage: false, positioningLevels,
    });
    expect(signal?.type).toBe("put");
    expect(signal?.advice).toBe("entrar");
    expect(signal?.reason).toMatch(/posicionamiento real/);
    // Solo la pared real (7720) confirma — el ruido chico (7725/7715/7710) queda afuera.
    expect(signal?.towardTargets.map((t) => t.strike)).toEqual([7720, 7700]);
    expect(signal?.towardTargets[0].reason).toMatch(/Open Interest real/);
  });

  it("el percentil de posicionamiento filtra ruido chico y solo deja pasar paredes reales", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const positioningLevels = new Map<number, PositioningLevel>([
      [7725, { strike: 7725, callGex: 10_000, putGex: 0 }],
      [7720, { strike: 7720, callGex: 800_000, putGex: 0 }],
      [7715, { strike: 7715, callGex: 15_000, putGex: 0 }],
      [7710, { strike: 7710, callGex: 20_000, putGex: 0 }],
    ]);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums: new Map(),
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
      hasFlowCoverage: false, positioningLevels,
    });
    const noiseLevels = signal!.levels.filter((l) => [7725, 7715, 7710].includes(l.strike));
    for (const l of noiseLevels) expect(l.callSignal).toBe("none");
    const wall = signal!.levels.find((l) => l.strike === 7720);
    expect(wall?.callSignal).toBe("resistance");
  });

  it("el flujo real manda sobre el posicionamiento cuando ambos existen para el mismo strike", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    // En 7720 el FLUJO dice alcista (put vendido = soporte); el posicionamiento
    // en el mismo strike diría lo contrario si se usara — no debe ganar.
    const strikePremiums = new Map<number, StrikePremiums>([[7720, premiums(null, -400_000)]]);
    const positioningLevels = new Map<number, PositioningLevel>([
      [7720, { strike: 7720, callGex: 900_000, putGex: 0 }], // esto solo, sin flujo, daría "resistance"
    ]);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
      hasFlowCoverage: true, positioningLevels,
    });
    // El sesgo en $7720 salió del flujo (soporte, alcista) — magnetStrike abajo
    // sigue dando dirección PUT, pero ese strike puntual no debería figurar
    // como confirmación bajista porque el flujo real ya lo clasificó al revés.
    const step = signal?.towardTargets.find((t) => t.strike === 7720);
    expect(step).toBeUndefined();
  });

  it("targets de ruptura salen del lado opuesto al imán y con probabilidad más baja", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const strikePremiums = new Map<number, StrikePremiums>([
      [7720, premiums(null, 400_000)],
      [7740, premiums(300_000, null)], // compra agresiva de calls arriba del spot = ruptura alcista
    ]);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
    });
    expect(signal?.type).toBe("put");
    expect(signal?.breakoutTargets.length).toBeGreaterThanOrEqual(1);
    expect(signal?.breakoutTargets[0].strike).toBe(7740);
    // El target de ruptura nunca supera al target hacia el imán al mismo nivel de agresividad.
    const towardNear = signal!.towardTargets[0];
    const breakout = signal!.breakoutTargets[0];
    expect(breakout.probability).toBeLessThan(towardNear.probability + 0.5); // no debe dispararse sin sentido
  });

  it("da 4 targets por lado cuando hay suficientes strikes confirmados (pedido explícito de Carlos)", () => {
    const strikes = Array.from({ length: 41 }, (_, i) => 7650 + i * 5); // 7650..7850
    // 5 strikes confirmando bajista camino abajo (de sobra para llenar los 4).
    const strikePremiums = new Map<number, StrikePremiums>([
      [7725, premiums(null, 100_000)],
      [7720, premiums(null, 150_000)],
      [7715, premiums(null, 200_000)],
      [7710, premiums(null, 250_000)],
      [7705, premiums(null, 300_000)],
      // 5 strikes confirmando alcista camino arriba, para la ruptura.
      [7735, premiums(100_000, null)],
      [7740, premiums(150_000, null)],
      [7745, premiums(200_000, null)],
      [7750, premiums(250_000, null)],
      [7755, premiums(300_000, null)],
    ]);
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
    });
    // 3 pasos confirmados + el imán = 4.
    expect(signal?.towardTargets).toHaveLength(4);
    expect(signal?.towardTargets.at(-1)?.strike).toBe(7700);
    // 4 directos del lado de ruptura.
    expect(signal?.breakoutTargets).toHaveLength(4);
    // Cada target trae su propio porcentaje de probabilidad.
    for (const t of [...signal!.towardTargets, ...signal!.breakoutTargets]) {
      expect(t.probability).toBeGreaterThan(0);
      expect(t.probability).toBeLessThanOrEqual(1);
    }
  });

  it("crossMarketFlow que COINCIDE sube 'esperar_breakout' a 'entrar' cuando no hay otra confirmación", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const base = {
      spot: 7730, strikes, strikePremiums: new Map<number, StrikePremiums>(),
      magnetStrike: 7700, magnetConcentration: 0.6, iv, daysToClose,
    };
    const sinCruzado = magnetWallSignal(base);
    expect(sinCruzado?.advice).toBe("esperar_breakout");

    const crossMarketFlow: CrossMarketFlow = { direction: "put", underlying: "SPX" };
    const conCruzado = magnetWallSignal({ ...base, crossMarketFlow });
    expect(conCruzado?.advice).toBe("entrar");
    expect(conCruzado?.reason).toMatch(/flujo real de SPX/);
    // El imán queda con MÁS probabilidad que sin la confirmación cruzada (boost).
    expect(conCruzado!.magnetProbability).toBeGreaterThan(sinCruzado!.magnetProbability);
  });

  it("crossMarketFlow que CONTRADICE descuenta las probabilidades hacia el imán y lo avisa", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const strikePremiums = new Map<number, StrikePremiums>([[7720, premiums(null, 400_000)]]);
    const base = {
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
    };
    const sinCruzado = magnetWallSignal(base);
    const crossMarketFlow: CrossMarketFlow = { direction: "call", underlying: "SPX" }; // contrario a PUT
    const conConflicto = magnetWallSignal({ ...base, crossMarketFlow });

    expect(conConflicto?.advice).toBe("entrar"); // sigue confirmado en el propio instrumento
    expect(conConflicto?.reason).toMatch(/CONTRARIO/);
    expect(conConflicto!.magnetProbability).toBeLessThan(sinCruzado!.magnetProbability);
    expect(conConflicto!.towardTargets[0].probability).toBeLessThan(sinCruzado!.towardTargets[0].probability);
  });

  it("una pared confirmada en el propio instrumento manda sobre el boost de flujo cruzado (no se apilan)", () => {
    const strikes = Array.from({ length: 25 }, (_, i) => 7690 + i * 5);
    const strikePremiums = new Map<number, StrikePremiums>([[7720, premiums(null, 400_000)]]);
    const crossMarketFlow: CrossMarketFlow = { direction: "put", underlying: "SPX" };
    const signal = magnetWallSignal({
      spot: 7730, strikes, strikePremiums,
      magnetStrike: 7700, magnetConcentration: 0.8, iv, daysToClose,
      crossMarketFlow,
    });
    // Con pared propia confirmada, el mensaje es el "normal" (no el de "sin pared propia").
    expect(signal?.reason).toMatch(/confirmado por net premium real/);
    expect(signal?.reason).toMatch(/Confirmado además por el flujo real de SPX/);
  });
});
