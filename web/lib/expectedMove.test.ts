import { describe, expect, it } from "vitest";
import {
  conePoints,
  expectedMove,
  levelProbabilities,
  normCdf,
  predictionPath,
  probAbove,
  probInBand,
  probTouch,
} from "./expectedMove";

describe("normCdf", () => {
  it("es 0.5 en el centro y simétrica", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1) + normCdf(-1)).toBeCloseTo(1, 6);
  });
  it("reproduce los valores de tabla", () => {
    expect(normCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-2)).toBeCloseTo(0.0228, 3);
  });
});

describe("expectedMove", () => {
  it("σ = S · IV · √(T/365)", () => {
    const em = expectedMove(100, 0.5, 365);
    expect(em.sigma).toBeCloseTo(50, 6);
    expect(em.sigmaPct).toBeCloseTo(50, 6);
  });

  it("el movimiento escala con la raíz del tiempo, no lineal", () => {
    const a = expectedMove(100, 0.5, 30);
    const b = expectedMove(100, 0.5, 120); // 4× el tiempo
    expect(b.sigma / a.sigma).toBeCloseTo(2, 3); // → 2× el movimiento
  });

  it("2σ está más lejos que 1σ y el suelo nunca cruza cero", () => {
    const em = expectedMove(100, 1.5, 365);
    expect(em.upper2).toBeGreaterThan(em.upper1);
    expect(em.lower2).toBeLessThan(em.lower1);
    expect(em.lower2).toBeGreaterThan(0);
  });

  it("a 0 días no hay movimiento", () => {
    const em = expectedMove(100, 0.5, 0);
    expect(em.sigma).toBeCloseTo(0, 9);
    expect(em.upper1).toBeCloseTo(100, 9);
  });
});

describe("conePoints", () => {
  it("empieza pegado al spot y se abre con el tiempo", () => {
    const c = conePoints(100, 0.5, 30, 10);
    expect(c).toHaveLength(11);
    expect(c[0].upper1).toBeCloseTo(100, 6);
    expect(c[10].upper1).toBeGreaterThan(c[5].upper1);
    expect(c[10].lower1).toBeLessThan(c[5].lower1);
  });

  it("se abre en √t: a la mitad del tiempo, no la mitad del ancho", () => {
    const c = conePoints(100, 0.5, 100, 100);
    const half = c[50].upper1 - 100;
    const full = c[100].upper1 - 100;
    expect(half / full).toBeGreaterThan(0.6); // ~0.707, no 0.5
  });
});

describe("probAbove", () => {
  it("un strike en el dinero está cerca del 50%", () => {
    expect(probAbove(100, 100, 0.4, 30)).toBeGreaterThan(0.42);
    expect(probAbove(100, 100, 0.4, 30)).toBeLessThan(0.5);
  });
  it("cuanto más lejos el strike, menos probable", () => {
    const cerca = probAbove(100, 105, 0.4, 30);
    const lejos = probAbove(100, 130, 0.4, 30);
    expect(lejos).toBeLessThan(cerca);
  });
  it("más volatilidad hace más probable el strike lejano", () => {
    expect(probAbove(100, 120, 0.9, 30)).toBeGreaterThan(probAbove(100, 120, 0.2, 30));
  });
});

describe("probInBand", () => {
  it("la banda alrededor del spot concentra más probabilidad que una lejana", () => {
    const centro = probInBand(100, 98, 102, 0.4, 30);
    const lejos = probInBand(100, 138, 142, 0.4, 30);
    expect(centro).toBeGreaterThan(lejos);
  });
  it("una banda enorme se acerca a 1", () => {
    expect(probInBand(100, 1, 10_000, 0.4, 30)).toBeGreaterThan(0.98);
  });
  it("no depende del orden de los límites", () => {
    expect(probInBand(100, 95, 105, 0.4, 30)).toBeCloseTo(probInBand(100, 105, 95, 0.4, 30), 9);
  });
});

describe("probTouch", () => {
  it("tocar es más probable que cerrar más allá", () => {
    const cierra = probAbove(100, 110, 0.5, 30);
    expect(probTouch(100, 110, 0.5, 30)).toBeGreaterThan(cierra);
  });
  it("el nivel donde ya está el precio se toca seguro", () => {
    expect(probTouch(100, 100, 0.5, 30)).toBe(1);
  });
  it("nunca pasa de 1", () => {
    expect(probTouch(100, 100.01, 0.9, 90)).toBeLessThanOrEqual(1);
  });
  it("funciona hacia abajo igual que hacia arriba", () => {
    expect(probTouch(100, 90, 0.5, 30)).toBeGreaterThan(0);
    expect(probTouch(100, 110, 0.5, 30)).toBeGreaterThan(0);
  });

  it("la caída al nivel espejo es algo más probable que la subida (lognormal)", () => {
    // 90 y 111.11 son espejo en log (90/100 = 100/111.11), pero el término −½σ²T
    // de d2 inclina la distribución: por eso el suelo se toca antes que el techo.
    const abajo = probTouch(100, 90, 0.5, 30);
    const arriba = probTouch(100, 111.11, 0.5, 30);
    expect(abajo).toBeGreaterThan(arriba);
    expect(abajo - arriba).toBeLessThan(0.15); // pero sin dispararse
  });
});

describe("levelProbabilities", () => {
  const levels = [
    { strike: 95, concentration: 0.2, side: "put" as const, netGex: -1e6 },
    { strike: 100, concentration: 0.5, side: "call" as const, netGex: 2e6 },
    { strike: 105, concentration: 1.0, side: "call" as const, netGex: 5e6 },
  ];

  it("los pesos del heatmap suman 100%", () => {
    const p = levelProbabilities(100, 0.5, 30, levels);
    expect(p.reduce((s, l) => s + l.magnet, 0)).toBeCloseTo(1, 6);
  });

  it("un muro grande gana a un nivel cercano vacío", () => {
    const p = levelProbabilities(100, 0.5, 30, levels);
    expect(p[0].strike).toBe(105); // el de mayor concentración manda
  });

  it("devuelve toque y banda además del imán", () => {
    const p = levelProbabilities(100, 0.5, 30, levels);
    const l = p.find((x) => x.strike === 105)!;
    expect(l.touch).toBeGreaterThan(0);
    expect(l.band).toBeGreaterThan(0);
    expect(l.concentration).toBe(1);
  });

  it("sin niveles devuelve vacío", () => {
    expect(levelProbabilities(100, 0.5, 30, [])).toEqual([]);
  });

  it("ordena de mayor a menor peso", () => {
    const p = levelProbabilities(100, 0.5, 30, levels);
    for (let i = 1; i < p.length; i++) expect(p[i].magnet).toBeLessThanOrEqual(p[i - 1].magnet);
  });
});

describe("predictionPath", () => {
  it("va del spot al objetivo", () => {
    const p = predictionPath(100, 110, 0.5, 30, 10);
    expect(p.points[0].price).toBeCloseTo(100, 6);
    expect(p.points[p.points.length - 1].price).toBeCloseTo(110, 6);
    expect(p.clamped).toBe(false);
  });

  it("avanza rápido al principio y se aplana (√t)", () => {
    const p = predictionPath(100, 110, 0.5, 30, 100);
    const mitadTiempo = p.points[50].price - 100;
    const total = 10;
    expect(mitadTiempo / total).toBeGreaterThan(0.6); // ~0.707
  });

  it("recorta un objetivo que la volatilidad no alcanza", () => {
    const p = predictionPath(100, 500, 0.2, 5, 5); // 500 está fuera de 2σ
    expect(p.clamped).toBe(true);
    expect(p.target).toBeLessThan(500);
    expect(p.target).toBeCloseTo(expectedMove(100, 0.2, 5).upper2, 6);
  });

  it("recorta también hacia abajo", () => {
    const p = predictionPath(100, 1, 0.2, 5, 5);
    expect(p.clamped).toBe(true);
    expect(p.target).toBeGreaterThan(1);
  });
});
