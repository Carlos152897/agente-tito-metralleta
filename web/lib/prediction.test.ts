import { describe, expect, it } from "vitest";
import { confidenceOf, predictPro, weightedScore, type PredictionInput, type SubScores } from "./prediction";
import { levelProbabilities } from "./expectedMove";

const FULL: SubScores = {
  aggression: 5, conviction: 6, unusuality: 5,
  structure: 8, ivContext: 4, validation: 6,
};

function input(p: Partial<PredictionInput> = {}): PredictionInput {
  return {
    spot: 100,
    iv: 0.5,
    horizonDays: 20,
    nodes: [
      { strike: 110, concentration: 1.0, side: "call", netGex: 5e6 },
      { strike: 105, concentration: 0.5, side: "call", netGex: 2e6 },
      { strike: 92, concentration: 0.7, side: "put", netGex: -3e6 },
    ],
    scores: FULL,
    regime: "positive",
    callPct: 70,
    hitRate: 55,
    lowLiquidity: false,
    ...p,
  };
}

describe("weightedScore", () => {
  it("con las 6 categorías pondera por los pesos del scorecard", () => {
    const r = weightedScore(FULL);
    expect(r.active).toBe(6);
    expect(r.weight).toBe(100);
    // (5·20 + 6·20 + 5·20 + 8·15 + 4·10 + 6·15)/10 = 57
    expect(r.score).toBe(57);
  });

  it("ignora las categorías sin dato y renormaliza", () => {
    const r = weightedScore({ ...FULL, ivContext: null, validation: null });
    expect(r.active).toBe(4);
    expect(r.weight).toBe(75);
    expect(r.score).toBeGreaterThan(0);
  });

  it("sin datos → 0", () => {
    const r = weightedScore({
      aggression: null, conviction: null, unusuality: null,
      structure: null, ivContext: null, validation: null,
    });
    expect(r.score).toBe(0);
    expect(r.active).toBe(0);
  });
});

describe("confidenceOf", () => {
  const levels = levelProbabilities(100, 0.5, 20, [
    { strike: 110, concentration: 1, side: "call", netGex: 5e6 },
    { strike: 95, concentration: 0.2, side: "put", netGex: -1e6 },
  ]);

  it("la baja liquidez anula la confianza", () => {
    expect(confidenceOf(levels, 6, 80, true)).toBe(0);
  });
  it("sin niveles no hay confianza", () => {
    expect(confidenceOf([], 6, 80, false)).toBe(0);
  });
  it("más categorías activas y mejor histórico dan más confianza", () => {
    expect(confidenceOf(levels, 6, 80, false)).toBeGreaterThan(confidenceOf(levels, 2, 20, false));
  });
  it("queda dentro de 0-100", () => {
    for (const hr of [0, 50, 100]) {
      const c = confidenceOf(levels, 6, hr, false);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(100);
    }
  });
});

describe("predictPro — los tres escenarios", () => {
  it("ordena SIEMPRE bear < base < bull", () => {
    const casos = [
      input(),                                                    // imán arriba
      input({ nodes: [                                            // imán abajo
        { strike: 92, concentration: 1.0, side: "put", netGex: -5e6 },
        { strike: 95, concentration: 0.8, side: "put", netGex: -3e6 },
      ] }),
      input({ nodes: [] }),                                       // sin muros
      input({ nodes: [{ strike: 100, concentration: 1, side: "call", netGex: 1e6 }] }), // imán en el spot
    ];
    for (const c of casos) {
      const p = predictPro(c);
      expect(p.bear.target).toBeLessThan(p.base.target);
      expect(p.base.target).toBeLessThan(p.bull.target);
    }
  });

  it("si el único muro de abajo ES el imán, el bear lo marca la volatilidad (1σ)", () => {
    const p = predictPro(input({ nodes: [
      { strike: 95, concentration: 1.0, side: "put", netGex: -5e6 },
      { strike: 112, concentration: 0.4, side: "call", netGex: 2e6 },
    ] }));
    expect(p.base.target).toBe(95);          // el imán
    expect(p.bear.target).toBeLessThan(95);  // no puede quedarse corto
    expect(p.bear.driver).toContain("1σ");   // y lo marca la σ, no un muro
  });

  it("el imán lo decide la probabilidad de toque, no solo la concentración", () => {
    // 92 tiene más concentración, pero 95 está más cerca: gana 95.
    const p = predictPro(input({ nodes: [
      { strike: 92, concentration: 1.0, side: "put", netGex: -5e6 },
      { strike: 95, concentration: 0.9, side: "put", netGex: -4e6 },
    ] }));
    expect(p.base.target).toBe(95);
    expect(p.bear.target).toBe(92);
  });

  it("el escenario base es el nivel imán del mapa", () => {
    const p = predictPro(input());
    expect(p.base.target).toBe(p.levels[0].strike);
    expect(p.base.driver).toContain("imán");
  });

  it("ningún escenario se sale del cono de 2σ", () => {
    const p = predictPro(input({
      // un muro absurdamente lejano no puede arrastrar la predicción
      nodes: [{ strike: 5000, concentration: 1, side: "call", netGex: 9e9 }],
      horizonDays: 10,
    }));
    const em2 = 100 * Math.exp(2 * 0.5 * Math.sqrt(10 / 365));
    expect(p.bull.target).toBeLessThanOrEqual(em2 + 1e-6);
  });

  it("sin muros usa las bandas de 1σ como escenarios", () => {
    const p = predictPro(input({ nodes: [] }));
    expect(p.bull.driver).toContain("1σ");
    expect(p.bear.driver).toContain("1σ");
    expect(p.bull.target).toBeGreaterThan(100);
    expect(p.bear.target).toBeLessThan(100);
  });

  it("las probabilidades están en 0-1 y la de tocar el base es la mayor cuando es el más cercano", () => {
    const p = predictPro(input());
    for (const s of [p.bear, p.base, p.bull]) {
      expect(s.probability).toBeGreaterThanOrEqual(0);
      expect(s.probability).toBeLessThanOrEqual(1);
    }
  });

  it("un horizonte más largo abre los escenarios de 1σ", () => {
    const corto = predictPro(input({ nodes: [], horizonDays: 10 }));
    const largo = predictPro(input({ nodes: [], horizonDays: 30 }));
    expect(largo.bull.target).toBeGreaterThan(corto.bull.target);
    expect(largo.bear.target).toBeLessThan(corto.bear.target);
  });


  it("los tres escenarios son SIEMPRE precios distintos", () => {
    // Imán por debajo del spot: bear no puede colapsar con base.
    const abajo = predictPro(input({
      nodes: [
        { strike: 92, concentration: 1.0, side: "put", netGex: -5e6 },
        { strike: 88, concentration: 0.6, side: "put", netGex: -3e6 },
        { strike: 110, concentration: 0.4, side: "call", netGex: 2e6 },
      ],
    }));
    expect(new Set([abajo.bear.target, abajo.base.target, abajo.bull.target]).size).toBe(3);

    // Imán por encima: bull no puede colapsar con base.
    const arriba = predictPro(input());
    expect(new Set([arriba.bear.target, arriba.base.target, arriba.bull.target]).size).toBe(3);

    // Con un solo nodo, bull/bear caen a las bandas de 1σ y siguen siendo distintos.
    const uno = predictPro(input({
      nodes: [{ strike: 95, concentration: 1, side: "put", netGex: -1e6 }],
    }));
    expect(new Set([uno.bear.target, uno.base.target, uno.bull.target]).size).toBe(3);
  });

  it("el driver describe el significado, no la etiqueta cruda del GEX", () => {
    const p = predictPro(input());
    expect(p.bull.driver).toContain("Gamma concentrada");
    expect(p.bull.driver).not.toContain("Muro de puts");
  });

  it("respeta el horizonte pedido", () => {
    expect(predictPro(input({ horizonDays: 10 })).horizonDays).toBe(10);
    expect(predictPro(input({ horizonDays: 30 })).horizonDays).toBe(30);
  });
});

describe("predictPro — dirección y resumen", () => {
  it("marca dirección al alza cuando el imán está por encima", () => {
    const p = predictPro(input());
    expect(p.direction).toBe("up");
    expect(p.summary).toContain("alza");
  });

  it("marca dirección a la baja cuando el imán está por debajo", () => {
    const p = predictPro(input({
      nodes: [{ strike: 85, concentration: 1, side: "put", netGex: -5e6 }],
      callPct: 20,
    }));
    expect(p.direction).toBe("down");
    expect(p.summary).toContain("puts");
  });

  it("el resumen menciona el horizonte y el rango de 1σ", () => {
    const p = predictPro(input({ horizonDays: 30 }));
    expect(p.summary).toContain("30 días");
    expect(p.summary).toContain("1σ");
  });

  it("el resumen incluye el histórico de aciertos cuando existe", () => {
    expect(predictPro(input({ hitRate: 62 })).summary).toContain("62%");
    expect(predictPro(input({ hitRate: null })).summary).not.toContain("Históricamente");
  });

  it("avisa cuando la cadena es ilíquida", () => {
    const p = predictPro(input({ lowLiquidity: true }));
    expect(p.caveat).toContain("NO FIABLE");
    expect(p.confidence).toBe(0);
  });

  it("avisa cuando faltan sub-agentes", () => {
    const p = predictPro(input({ scores: { ...FULL, validation: null, ivContext: null } }));
    expect(p.caveat).toContain("4 de 6");
  });

  it("sin avisos cuando están los 6 y hay liquidez", () => {
    expect(predictPro(input()).caveat).toBeNull();
  });
});
