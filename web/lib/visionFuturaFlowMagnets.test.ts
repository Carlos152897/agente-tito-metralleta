import { describe, expect, it } from "vitest";
import { CUMULATIVE_MAGNET_TUNING, flowMagnetHistory, flowMagnetsAt, fmtFuerza, SOFIA_MAGNET_TUNING, withMagnetTrend } from "./visionFuturaFlowMagnets";
import type { StrikeMinute } from "./visionFuturaVolumeDelta";

const m = (t: number, cA = 0, cB = 0, pA = 0, pB = 0): StrikeMinute => ({ t, cA, cB, cV: cA + cB, pA, pB, pV: pA + pB });

describe("flowMagnetsAt", () => {
  it("Imán + = más compra de calls + venta de puts; Imán − = lo contrario", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 1000, 0, 0, 1600)]], // +2,600
      [7555, [m(0, 0, 300, 291, 0)]], // −591
      [7560, [m(0, 100, 0, 0, 0)]], // +100
    ]);
    const r = flowMagnetsAt(by, 60, 7571);
    expect(r.pos).toEqual({ strike: 7550, fuerza: 2600 });
    expect(r.neg).toEqual({ strike: 7555, fuerza: 591 });
  });
  it("solo la ventana de 15 min y solo ±70 pts", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 5000), m(1200, 30)]], // los 5,000 quedaron fuera de la ventana a las 1,260
      [7700, [m(1200, 9000)]], // fuera del radio
    ]);
    const r = flowMagnetsAt(by, 1260, 7571);
    expect(r.pos).toEqual({ strike: 7550, fuerza: 30 });
    expect(r.neg).toBeNull();
  });
  it("nada si no llega al mínimo de contratos", () => {
    const by = new Map<number, StrikeMinute[]>([[7550, [m(0, 10)]]]);
    expect(flowMagnetsAt(by, 60, 7550).pos).toBeNull();
  });
});

describe("flowMagnetHistory", () => {
  it("tramos seguidos por strike, igual que calcular minuto a minuto", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7550, [m(0, 100), m(60, 100)]],
      [7560, [m(120, 500)]],
    ]);
    const segs = flowMagnetHistory(by, 0, 240, () => 7555, { windowSec: 120 });
    expect(segs.filter((s) => s.kind === "pos").map((s) => [s.strike, s.start, s.end, s.fuerza])).toEqual([
      [7550, 60, 120, 200],
      [7560, 180, 240, 500],
    ]);
    // mismo resultado que flowMagnetsAt en cada minuto
    for (const t of [60, 120, 180, 240]) {
      const seg = segs.find((s) => s.kind === "pos" && s.start <= t && s.end >= t);
      expect(seg?.strike).toBe(flowMagnetsAt(by, t, 7555, { windowSec: 120 }).pos?.strike);
    }
  });
  it("formato de fuerza", () => {
    expect(fmtFuerza(2600)).toBe("2.6K");
    expect(fmtFuerza(591)).toBe("591");
  });
});

describe("imanesSofia (último minuto)", () => {
  const o = { windowSec: SOFIA_MAGNET_TUNING.windowSec, minContracts: SOFIA_MAGNET_TUNING.minContracts, radius: SOFIA_MAGNET_TUNING.radiusPts };
  it("solo cuenta el último minuto cerrado: el imán cambia de strike cada minuto", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7560, [m(0, 5000), m(60, 212)]], // los 5,000 del minuto anterior ya no cuentan
      [7585, [m(60, 0, 130)]], // −130
      [7590, [m(120, 999)]], // minuto en curso: todavía no cuenta
    ]);
    const r = flowMagnetsAt(by, 120, 7560, o);
    expect(r.pos).toEqual({ strike: 7560, fuerza: 212 });
    expect(r.neg).toEqual({ strike: 7585, fuerza: 130 });
  });
  it("±75 pts y mínimo 10 contratos", () => {
    const by = new Map<number, StrikeMinute[]>([
      [7640, [m(0, 900)]], // a 80 pts: fuera
      [7550, [m(0, 9)]], // menos de 10
    ]);
    const r = flowMagnetsAt(by, 60, 7560, o);
    expect(r.pos).toBeNull();
  });
});

describe("imán acumulado (todo el día) con tendencia", () => {
  const T = CUMULATIVE_MAGNET_TUNING;
  const o = { windowSec: T.windowSec, minContracts: T.minContracts, radius: T.radiusPts };
  // Caso del video de SofIA: el mismo strike junta compras netas minuto a minuto y su fuerza crece.
  const by = new Map<number, StrikeMinute[]>([
    [7600, Array.from({ length: 40 }, (_, i) => m(i * 60, 20))], // +20 por minuto, 40 min
    [7590, [m(0, 300)]], // un golpe grande al inicio y nada más
    [7550, [m(600, 0, 50)]], // −50
  ]);
  it("suma desde la apertura (no se olvida de lo viejo como la ventana de 15 min)", () => {
    const r = flowMagnetsAt(by, 2400, 7580, o);
    expect(r.pos).toEqual({ strike: 7600, fuerza: 800 });
    expect(r.neg).toEqual({ strike: 7550, fuerza: 50 });
    expect(flowMagnetsAt(by, 2400, 7580).pos?.strike).toBe(7600); // 15 min: 300 de 7590 ya salió
  });
  it("tendencia: fuerza hace 15 min y desde cuándo está fijo", () => {
    const toT = 2400;
    const hist = flowMagnetHistory(by, 0, toT, () => 7580, o);
    const now = withMagnetTrend(by, flowMagnetsAt(by, toT, 7580, o), hist, toT);
    expect(now.pos?.fuerza).toBe(800);
    expect(now.pos?.prevFuerza).toBe(500); // minutos 0..1440 → 25 × 20
    // 7590 (300) fue el imán hasta que 7600 lo pasó: a las 960 s 7600 suma 320 > 300 → fijo desde ahí.
    expect(now.pos?.since).toBe(900);
    expect(now.neg?.prevFuerza).toBe(50);
  });
  it("sin imán no inventa tendencia", () => {
    const r = withMagnetTrend(by, { pos: null, neg: null }, [], 2400);
    expect(r).toEqual({ pos: null, neg: null });
  });
});
