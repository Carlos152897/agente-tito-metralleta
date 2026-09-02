import { describe, it, expect } from "vitest";
import {
  analyzeMarket, buildSignals, breadthWarning, buildKidSimpleSummary, vixBand,
  classifyHeadline, buildDailyAlerts, buildInstrumentLevels, eventImpacts, type MacroReading,
} from "./marketAnalysis";
import type { LvlBar } from "./levels";

function reading(key: MacroReading["key"], changePct: number, last = 100): MacroReading {
  const prevClose = last / (1 + changePct / 100);
  return { key, label: key, last, prevClose, changePct };
}

describe("vixBand", () => {
  it("classifies calma below 15", () => {
    expect(vixBand(13).lean).toBe("risk_on");
  });
  it("classifies pánico above 25", () => {
    expect(vixBand(30).lean).toBe("risk_off");
  });
  it("classifies normal 15-20 as neutral", () => {
    expect(vixBand(17).lean).toBe("neutral");
  });
});

describe("analyzeMarket — risk_on scenario", () => {
  const readings: MacroReading[] = [
    reading("NQ", 1.2),
    reading("ES", 0.8),
    reading("YM", 0.5),
    reading("RTY", 1.0),
    reading("VIX", -8, 13),
    reading("ZN", 0.3),
    reading("DXY", -0.4),
    reading("CL", 0.7),
    reading("BTC", 1.5),
  ];

  it("scores risk_on when most signals point that way", () => {
    const result = analyzeMarket(readings);
    expect(result.regime).toBe("risk_on");
  });

  it("mentions the Nasdaq move in the one-liner", () => {
    const result = analyzeMarket(readings);
    expect(result.oneLiner).toContain("NQ");
    expect(result.oneLiner).toContain("alcista");
  });
});

describe("analyzeMarket — risk_off scenario (regla #1: yields subiendo)", () => {
  const readings: MacroReading[] = [
    reading("NQ", -1.5),
    reading("ES", -1.0),
    reading("YM", -0.6),
    reading("RTY", -1.8),
    reading("VIX", 15, 24),
    reading("ZN", -0.6), // precio del bono cae -> yields suben
    reading("DXY", 0.6),
    reading("CL", -0.8),
    reading("BTC", -2.0),
  ];

  it("scores risk_off", () => {
    const result = analyzeMarket(readings);
    expect(result.regime).toBe("risk_off");
  });

  it("flags yields rising as a warning for NQ", () => {
    const signals = buildSignals(readings);
    const yieldsSignal = signals.find((s) => s.label.includes("10 años"));
    expect(yieldsSignal?.lean).toBe("risk_off");
    expect(yieldsSignal?.detail).toContain("SUBIENDO");
  });
});

describe("breadthWarning — regla #4: rally angosto", () => {
  it("flags when Nasdaq rallies but Russell lags far behind", () => {
    const readings: MacroReading[] = [reading("NQ", 1.5), reading("RTY", 0.1)];
    expect(breadthWarning(readings)).toMatch(/rally/i);
  });

  it("stays null when both move together", () => {
    const readings: MacroReading[] = [reading("NQ", 1.0), reading("RTY", 0.9)];
    expect(breadthWarning(readings)).toBeNull();
  });

  it("stays null when missing an instrument", () => {
    expect(breadthWarning([reading("NQ", 1.5)])).toBeNull();
  });
});

describe("buildKidSimpleSummary — sin jerga ni tickers", () => {
  const readings: MacroReading[] = [
    reading("NQ", 1.2), reading("VIX", -8, 13), reading("ZN", 0.3), reading("DXY", -0.4),
  ];

  it("no menciona nombres de instrumentos ni porcentajes", () => {
    const text = buildKidSimpleSummary("risk_on", readings, null, false);
    for (const jargon of ["NQ", "VIX", "DXY", "ZN", "%"]) {
      expect(text).not.toContain(jargon);
    }
  });

  it("termina con una dirección probable acorde al régimen", () => {
    const on = buildKidSimpleSummary("risk_on", readings, null, false);
    expect(on).toMatch(/ganas de subir/);
    const off = buildKidSimpleSummary("risk_off", readings, null, false);
    expect(off).toMatch(/ca(er|yendo)|cuidadoso/);
  });

  it("menciona el aviso de rally angosto en palabras simples cuando existe", () => {
    const text = buildKidSimpleSummary("risk_on", readings, "aviso técnico", false);
    expect(text).toMatch(/pocas empresas muy grandes/);
  });
});

describe("analyzeMarket — incluye simpleSummary", () => {
  it("el resultado trae la explicación simple ya armada", () => {
    const readings: MacroReading[] = [reading("NQ", 0.8), reading("VIX", -5, 14)];
    const result = analyzeMarket(readings);
    expect(result.simpleSummary.length).toBeGreaterThan(0);
    expect(result.simpleSummary).not.toContain("NQ");
  });
});

describe("classifyHeadline", () => {
  it("marca guerra en zona petrolera como war_oil (ejemplo real de Carlos)", () => {
    expect(classifyHeadline("Israel launches strike on Iran amid rising Middle East tensions")).toBe("war_oil");
  });

  it("marca guerra fuera de zona petrolera como war_other", () => {
    expect(classifyHeadline("Ukraine reports new missile attack overnight")).toBe("war_other");
  });

  it("marca menciones de la Fed/Powell", () => {
    expect(classifyHeadline("Powell says Fed could cut rates in September")).toBe("fed");
  });

  it("marca menciones de Trump/aranceles", () => {
    expect(classifyHeadline("Trump announces new tariff on Chinese imports")).toBe("trump");
  });

  it("titulares normales no caen en ninguna categoría", () => {
    expect(classifyHeadline("Apple unveils new iPhone lineup at fall event")).toBeNull();
  });
});

describe("buildDailyAlerts", () => {
  it("prioriza guerra (danger) antes que Fed/Trump (warning/info)", () => {
    const alerts = buildDailyAlerts(
      [
        { title: "Trump announces new tariff plan", url: "https://x/1" },
        { title: "Israel strikes Iran, oil markets on edge", url: "https://x/2" },
      ],
      [],
    );
    expect(alerts[0].level).toBe("danger");
    expect(alerts[0].message).toContain("petróleo");
  });

  it("agrega una alerta de resultados por cada ticker que reporta hoy", () => {
    const alerts = buildDailyAlerts([], ["NVDA", "AAPL"]);
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.level === "info")).toBe(true);
    expect(alerts.map((a) => a.message).join(" ")).toContain("NVDA");
  });

  it("no repite la misma categoría dos veces aunque haya varios titulares", () => {
    const alerts = buildDailyAlerts(
      [
        { title: "Fed's Powell speaks on inflation outlook", url: "https://x/1" },
        { title: "Fed officials signal caution on rate cuts", url: "https://x/2" },
      ],
      [],
    );
    expect(alerts).toHaveLength(1);
  });

  it("devuelve vacío sin noticias relevantes ni resultados hoy", () => {
    expect(buildDailyAlerts([{ title: "Local bakery wins award", url: "https://x/1" }], [])).toHaveLength(0);
  });
});

describe("analyzeMarket — mixed scenario", () => {
  it("lands on mixto when signals are evenly split", () => {
    const readings: MacroReading[] = [
      reading("NQ", 0.05),
      reading("ES", 0.02),
      reading("YM", -0.03),
      reading("VIX", 0, 17),
    ];
    const result = analyzeMarket(readings);
    expect(result.regime).toBe("mixto");
  });
});

describe("eventImpacts", () => {
  it("devuelve vacío sin guerra en las noticias", () => {
    expect(eventImpacts(false, false)).toHaveLength(0);
  });

  it("marca risk-off en índices y BTC, risk-on en refugios, cuando hay guerra", () => {
    const impacts = eventImpacts(false, true);
    const byKey = Object.fromEntries(impacts.map((i) => [i.key, i.lean]));
    expect(byKey.NQ).toBe("down");
    expect(byKey.ES).toBe("down");
    expect(byKey.BTC).toBe("down");
    expect(byKey.VIX).toBe("up");
    expect(byKey.GC).toBe("up");
    expect(byKey.ZN).toBe("up");
    expect(byKey.DXY).toBe("up");
  });

  it("solo agrega petróleo (CL) cuando la guerra toca una zona petrolera", () => {
    expect(eventImpacts(false, true).some((i) => i.key === "CL")).toBe(false);
    const withOil = eventImpacts(true, false);
    expect(withOil.find((i) => i.key === "CL")?.lean).toBe("up");
  });
});

describe("buildInstrumentLevels", () => {
  const now = new Date("2026-08-15T20:00:00Z");

  function makeBars(prices: number[]): LvlBar[] {
    return prices.map((p, i) => ({
      time: `2026-07-${String(i + 1).padStart(2, "0")}`,
      high: p * 1.01, low: p * 0.99, close: p,
    }));
  }

  it("VIX usa las bandas fijas de la guía, sin necesidad de barras", () => {
    const report = buildInstrumentLevels("VIX", null, [], 22, now);
    expect(report.supports.map((s) => s.price)).toEqual([15]);
    expect(report.resistances.map((r) => r.price)).toEqual([20, 25]);
    expect(report.chart).toHaveLength(0);
  });

  it("devuelve vacío si no hay suficientes barras del proxy", () => {
    const report = buildInstrumentLevels("NQ", "QQQ", makeBars([480, 481]), 21000, now);
    expect(report.supports).toHaveLength(0);
    expect(report.resistances).toHaveLength(0);
    expect(report.proxyTicker).toBe("QQQ");
  });

  it("escala los niveles del proxy al precio real del instrumento (NQ vs QQQ)", () => {
    // Precios de QQQ oscilando 470-490, con un pivote claro en 490.
    const prices = [470, 475, 480, 485, 490, 485, 480, 478, 480, 482, 480, 478,
      480, 482, 484, 486, 484, 482, 480, 481, 480, 482, 483, 481, 480];
    const bars = makeBars(prices);
    const spot = 21000; // NQ real, muy distinto de QQQ (~480)
    const report = buildInstrumentLevels("NQ", "QQQ", bars, spot, now);
    expect(report.proxyTicker).toBe("QQQ");
    expect(report.isRealAsset).toBe(false);
    // Los niveles deben quedar en la escala de NQ (miles), no en la de QQQ (cientos).
    for (const lvl of [...report.supports, ...report.resistances]) {
      expect(lvl.price).toBeGreaterThan(1000);
    }
    expect(report.chart.length).toBe(bars.length);
    expect(report.chart[report.chart.length - 1].close).toBeGreaterThan(1000);
  });

  it("BTC no escala — usa el precio real directamente (mismo activo)", () => {
    const prices = Array.from({ length: 25 }, (_, i) => 60000 + i * 200);
    const bars = makeBars(prices);
    const spot = prices[prices.length - 1];
    const report = buildInstrumentLevels("BTC", "X:BTCUSD", bars, spot, now);
    expect(report.isRealAsset).toBe(true);
    expect(report.chart[report.chart.length - 1].close).toBe(spot);
  });
});
