import { describe, expect, it } from "vitest";
import { buildPremarket, gradePremarket, maxPain, premarketTarget, prevWeekday, nextWeekday, type PremarketInput, type PremarketStrike } from "./visionFuturaPremarket";

const chain = (over: Record<number, Partial<PremarketStrike>> = {}): PremarketStrike[] => {
  const out: PremarketStrike[] = [];
  for (let k = 7500; k <= 7760; k += 10) out.push({ strike: k, callOi: 200, putOi: 200, callIv: 0.18, putIv: 0.18, ...over[k] });
  return out;
};

const base = (over: Partial<PremarketInput> = {}): PremarketInput => ({
  inst: "SPX", targetDate: "2026-10-26", expiration: "2026-10-26",
  now: Date.parse("2026-10-26T08:00:00-04:00"),
  prevClose: 7623.68, spot: 7631.18, spotSource: "/ES",
  future: { symbol: "/ESZ6", last: 7670, atPrevClose: 7662.5, onHigh: 7675, onLow: 7655 },
  prevDay: { high: 7700, low: 7610, close: 7623.68 },
  sigma: { points: 60, source: "straddle ATM" },
  strikes: chain({ 7600: { putOi: 6000 }, 7680: { callOi: 6000 } }),
  yearsToExpiry: 8 / (24 * 365), fallbackIv: 0.18, oiPrev: null, events: [],
  ...over,
});

describe("buildPremarket", () => {
  it("toma piso y techo de las paredes de puts y calls", () => {
    const r = buildPremarket(base());
    expect(r.piso.price).toBe(7600);
    expect(r.techo.price).toBe(7680);
    expect(r.range).toEqual({ low: 7600, high: 7680 });
    expect(r.levels.putWall).toBe(7600);
    expect(r.levels.callWall).toBe(7680);
    expect(r.extended.low).toBeLessThanOrEqual(7600);
    expect(r.extended.high).toBeGreaterThanOrEqual(7680);
    expect(r.gap).toBeCloseTo(7.5, 1);
  });

  it("sin paredes cerca usa ±1σ", () => {
    const r = buildPremarket(base({ strikes: chain() }));
    // con OI parejo la "pared" más cercana dentro de banda puede existir; forzamos lejos:
    const empty = Object.fromEntries(Array.from({ length: 27 }, (_, i) => [7500 + i * 10, { callOi: 0, putOi: 0 }]));
    const far = buildPremarket(base({ strikes: chain({ ...empty, 7500: { callOi: 0, putOi: 9000 }, 7760: { callOi: 9000, putOi: 0 } }), sigma: { points: 40, source: "IV" } }));
    expect(far.range.low).toBeCloseTo(7631.18 - 40, 1);
    expect(far.range.high).toBeCloseTo(7631.18 + 40, 1);
    expect(far.confidence).not.toBe("alta");
    expect(r.positions.length).toBeGreaterThan(0);
  });

  it("evento ensancha σ y baja la confianza", () => {
    const a = buildPremarket(base());
    const b = buildPremarket(base({ events: ["FOMC"] }));
    expect(b.sigma).toBeCloseTo(a.sigma * 1.25, 1);
    expect(["media", "baja"]).toContain(b.confidence);
  });

  it("marca posiciones nuevas contra el OI anterior", () => {
    const r = buildPremarket(base({ oiPrev: { capturedAt: "2026-10-23T20:00:00Z", byStrike: { "7680": [1000, 200], "7600": [200, 6000] } } }));
    expect(r.newPositions[0].strike).toBe(7680);
    expect(r.newPositions[0].dCall).toBe(5000);
    const p7600 = r.positions.find((p) => p.strike === 7600)!;
    expect(p7600.dPut).toBe(0);
  });

  it("noche del futuro se pasa al instrumento", () => {
    const r = buildPremarket(base());
    const hi = r.marks.find((m) => m.label === "Máx. de la noche")!;
    expect(hi.price).toBeCloseTo(7623.68 + 12.5, 2);
    expect(r.futBasis).toBeCloseTo(7670 - 7631.18, 2);
  });
});

describe("gradePremarket", () => {
  it("día dentro del rango con el techo aguantando", () => {
    const r = buildPremarket(base());
    const g = gradePremarket(r, { date: "2026-10-26", open: 7630, high: 7679, low: 7605, close: 7650 });
    expect(g.insideRange).toBe(true);
    expect(g.techoHeld).toBe(true);
    expect(g.closeInside).toBe(true);
  });
  it("rompe el piso", () => {
    const r = buildPremarket(base());
    const g = gradePremarket(r, { date: "2026-10-26", open: 7630, high: 7640, low: 7570, close: 7575 });
    expect(g.insideRange).toBe(false);
    expect(g.pisoHeld).toBe(false);
    expect(g.notes.join(" ")).toContain("perforó el piso");
  });
});

describe("fechas", () => {
  it("fin de semana → lunes en pre", () => {
    expect(premarketTarget(Date.parse("2026-10-25T23:00:00-04:00"))).toEqual({ date: "2026-10-26", phase: "pre" });
  });
  it("8 am → hoy pre; 10 am → sesión; 5 pm → mañana", () => {
    expect(premarketTarget(Date.parse("2026-10-27T08:00:00-04:00"))).toEqual({ date: "2026-10-27", phase: "pre" });
    expect(premarketTarget(Date.parse("2026-10-27T10:00:00-04:00"))).toEqual({ date: "2026-10-27", phase: "sesion" });
    expect(premarketTarget(Date.parse("2026-10-27T17:00:00-04:00"))).toEqual({ date: "2026-10-28", phase: "pre" });
    expect(premarketTarget(Date.parse("2026-10-30T17:00:00-04:00"))).toEqual({ date: "2026-11-02", phase: "pre" });
  });
  it("día hábil anterior/siguiente", () => {
    expect(prevWeekday("2026-10-26")).toBe("2026-10-23");
    expect(nextWeekday("2026-10-23")).toBe("2026-10-26");
  });
  it("max pain", () => {
    expect(maxPain([{ strike: 100, callOi: 10, putOi: 0, callIv: null, putIv: null }, { strike: 110, callOi: 5, putOi: 5, callIv: null, putIv: null }, { strike: 120, callOi: 0, putOi: 10, callIv: null, putIv: null }])).toBe(110);
  });
});
