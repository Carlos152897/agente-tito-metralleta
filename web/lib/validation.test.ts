import { describe, expect, it } from "vitest";
import {
  evaluateFlow,
  flowDirection,
  median,
  speedPoints,
  validationPoints,
  validationScore,
  type FlowLite,
  type ValBar,
} from "./validation";

const NOW = new Date("2026-07-24T12:00:00Z");

function flow(p: Partial<FlowLite> = {}): FlowLite {
  return {
    id: 1, timestamp: "2026-07-01T15:00:00Z", type: "call", strike: 100,
    expiration: "2026-12-18", assetPrice: 100, premium: 1_000_000, aggression: "ask",
    ...p,
  };
}

/** Barras planas en 100 salvo las que se pisen. */
function bars(spec: Record<string, [number, number, number]>): ValBar[] {
  return Object.entries(spec).map(([time, [high, low, close]]) => ({ time, high, low, close }));
}

describe("flowDirection — tabla del Proceso Principal", () => {
  it("comprar call = alcista", () => {
    expect(flowDirection("call", "ask")).toBe("alcista");
  });
  it("vender call = bajista (resistencia / muro)", () => {
    expect(flowDirection("call", "bid")).toBe("bajista");
  });
  it("comprar put = bajista", () => {
    expect(flowDirection("put", "ask")).toBe("bajista");
  });
  it("vender put = alcista (soporte)", () => {
    expect(flowDirection("put", "bid")).toBe("alcista");
  });
  it("ejecución en el medio o tipo desconocido = neutral", () => {
    expect(flowDirection("call", "mid")).toBe("neutral");
    expect(flowDirection("unknown", "ask")).toBe("neutral");
  });
});

describe("evaluateFlow", () => {
  it("ignora el día del propio flow (está contaminado por el trade)", () => {
    const o = evaluateFlow(
      flow(),
      bars({ "2026-07-01": [130, 100, 130] }), // mismo día: no cuenta
      NOW,
    );
    expect(o.sessionsObserved).toBe(0);
    expect(o.mfePct).toBe(0);
  });

  it("un call comprado que sube se valida, y dice en qué sesión", () => {
    const o = evaluateFlow(
      flow(),
      bars({
        "2026-07-02": [101, 99.5, 100.5],
        "2026-07-03": [103, 100, 102.5], // +3% → cruza el umbral de 2%
      }),
      NOW,
    );
    expect(o.direction).toBe("alcista");
    expect(o.daysToValidate).toBe(2);
    expect(o.validated).toBe(true);
    expect(o.mfePct).toBeCloseTo(3, 6);
    expect(o.daysToMfe).toBe(2);
  });

  it("mide la excursión adversa aunque termine validando", () => {
    const o = evaluateFlow(
      flow(),
      bars({
        "2026-07-02": [100.5, 96, 97], // −4% en contra primero
        "2026-07-03": [104, 100, 103],
      }),
      NOW,
    );
    expect(o.maePct).toBeCloseTo(4, 6);
    expect(o.daysToInvalidate).toBe(1);
    expect(o.daysToValidate).toBe(2);
    expect(o.validated).toBe(false); // se fue en contra ANTES
  });

  it("un put comprado se valida cuando el precio BAJA", () => {
    const o = evaluateFlow(
      flow({ type: "put", aggression: "ask" }),
      bars({ "2026-07-02": [100.5, 97, 97.5] }),
      NOW,
    );
    expect(o.direction).toBe("bajista");
    expect(o.validated).toBe(true);
    expect(o.mfePct).toBeCloseTo(3, 6);
  });

  it("no juzga un flow demasiado reciente", () => {
    const o = evaluateFlow(
      flow({ timestamp: "2026-07-23T15:00:00Z" }),
      bars({ "2026-07-24": [100.5, 99.8, 100.2] }), // se movió menos del umbral
      NOW,
    );
    expect(o.resolved).toBe(false);
    expect(o.validated).toBe(false);
  });

  it("no mira más allá del vencimiento del contrato", () => {
    const o = evaluateFlow(
      flow({ expiration: "2026-07-02" }),
      bars({
        "2026-07-02": [100.5, 99.9, 100.1],
        "2026-07-03": [140, 100, 139], // ya expiró: no cuenta
      }),
      NOW,
    );
    expect(o.sessionsObserved).toBe(1);
    expect(o.mfePct).toBeLessThan(1);
  });

  it("respeta el horizonte de sesiones", () => {
    const many: Record<string, [number, number, number]> = {};
    for (let i = 2; i <= 28; i++) {
      const d = String(i).padStart(2, "0");
      many[`2026-07-${d}`] = [100.1, 99.9, 100];
    }
    const o = evaluateFlow(flow(), bars(many), NOW, 2, 5);
    expect(o.sessionsObserved).toBe(5);
    expect(o.resolved).toBe(true); // horizonte agotado
  });

  it("un flow neutral no se evalúa", () => {
    const o = evaluateFlow(flow({ aggression: "mid" }), bars({ "2026-07-02": [110, 100, 109] }), NOW);
    expect(o.direction).toBe("neutral");
    expect(o.mfePct).toBe(0);
  });

  it("reporta los días naturales transcurridos desde el flow", () => {
    const o = evaluateFlow(flow({ timestamp: "2026-07-04T12:00:00Z" }), bars({ "2026-07-06": [101, 100, 101] }), NOW);
    expect(o.daysElapsed).toBe(20);
  });
});

describe("validationPoints (propuesta)", () => {
  it("respeta las bandas", () => {
    expect(validationPoints(75).points).toBe(10);
    expect(validationPoints(70).points).toBe(10);
    expect(validationPoints(65).points).toBe(8);
    expect(validationPoints(55).points).toBe(6);
    expect(validationPoints(45).points).toBe(4);
    expect(validationPoints(35).points).toBe(2);
    expect(validationPoints(10).points).toBe(0);
  });
  it("sin datos → 0", () => {
    expect(validationPoints(null).points).toBe(0);
  });
});

describe("speedPoints (propuesta)", () => {
  it("premia la reacción rápida", () => {
    expect(speedPoints(1).points).toBe(10);
    expect(speedPoints(4).points).toBe(8);
    expect(speedPoints(8).points).toBe(6);
    expect(speedPoints(13).points).toBe(4);
    expect(speedPoints(19).points).toBe(2);
  });
  it("decrece de forma monótona", () => {
    const t = [2, 5, 10, 15, 20].map((d) => speedPoints(d).points);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThan(t[i - 1]);
  });
});

describe("median", () => {
  it("impares y pares", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("vacío → null", () => {
    expect(median([])).toBeNull();
  });
});

describe("validationScore", () => {
  const upBars = bars({
    "2026-07-02": [101, 99.5, 100.8],
    "2026-07-03": [104, 100.5, 103.5],
    "2026-07-06": [105, 102, 104],
  });

  it("sin flows → reporte vacío", () => {
    expect(validationScore({ flows: [], bars: upBars, now: NOW }).score).toBe(0);
  });

  it("calcula la tasa de validación sobre los flows ya juzgados", () => {
    const s = validationScore({
      flows: [
        flow({ id: 1, type: "call", aggression: "ask" }), // sube → valida
        flow({ id: 2, type: "put", aggression: "ask" }),  // sube → falla
      ],
      bars: upBars,
      now: NOW,
    });
    expect(s.hitRate.resolved).toBe(2);
    expect(s.hitRate.validated).toBe(1);
    expect(s.hitRate.value).toBeCloseTo(50, 6);
  });

  it("pondera por premium: el acierto del dinero grande pesa más", () => {
    const s = validationScore({
      flows: [
        flow({ id: 1, type: "call", aggression: "ask", premium: 10_000_000 }), // acierta
        flow({ id: 2, type: "put", aggression: "ask", premium: 100_000 }),     // falla
      ],
      bars: upBars,
      now: NOW,
    });
    expect(s.hitRate.value).toBeCloseTo(50, 6);
    expect(s.weightedHitRate!).toBeGreaterThan(95); // el grande acertó
  });

  it("separa el acierto por dirección", () => {
    const s = validationScore({
      flows: [
        flow({ id: 1, type: "call", aggression: "ask" }),
        flow({ id: 2, type: "call", aggression: "ask" }),
        flow({ id: 3, type: "put", aggression: "ask" }),
      ],
      bars: upBars,
      now: NOW,
    });
    const alcista = s.byDirection.find((d) => d.direction === "alcista")!;
    const bajista = s.byDirection.find((d) => d.direction === "bajista")!;
    expect(alcista.hitRate).toBeCloseTo(100, 6);
    expect(bajista.hitRate).toBeCloseTo(0, 6);
  });

  it("marca cuando el historial no llega a los 60 días del documento", () => {
    const s = validationScore({ flows: [flow()], bars: upBars, now: NOW });
    expect(s.coverage.belowTarget).toBe(true);
    expect(s.coverage.flows).toBe(1);
  });

  it("no marca belowTarget cuando el historial ya cubre 60+ días", () => {
    const s = validationScore({
      flows: [
        flow({ id: 1, timestamp: "2026-05-01T15:00:00Z" }),
        flow({ id: 2, timestamp: "2026-07-01T15:00:00Z" }),
      ],
      bars: upBars,
      now: NOW,
    });
    expect(s.coverage.days).toBeGreaterThanOrEqual(60);
    expect(s.coverage.belowTarget).toBe(false);
  });

  it("cuenta como pendientes los flows demasiado recientes", () => {
    const s = validationScore({
      flows: [flow({ id: 9, timestamp: "2026-07-06T15:00:00Z" })], // sin barras después
      bars: upBars,
      now: NOW,
    });
    expect(s.coverage.pending).toBe(1);
    expect(s.hitRate.resolved).toBe(0);
  });

  it("el score es el promedio de los dos parámetros y cae en 0-10", () => {
    const s = validationScore({
      flows: [flow({ id: 1 }), flow({ id: 2 }), flow({ id: 3 })],
      bars: upBars,
      now: NOW,
    });
    expect(s.score).toBe(Math.round((s.hitRate.points + s.speed.points) / 2));
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(10);
  });

  it("los flows neutrales quedan fuera del cómputo", () => {
    const s = validationScore({
      flows: [flow({ id: 1, aggression: "mid" }), flow({ id: 2, aggression: "ask" })],
      bars: upBars,
      now: NOW,
    });
    expect(s.coverage.flows).toBe(1);
  });
});
