import { describe, expect, it } from "vitest";
import { fillMagnets, fillTech, magnetsInBand, stepAt, techCompany, techReading, upsertMinute } from "./visionFuturaContext";

const gex = (pairs: [number, number][]) => new Map(pairs.map(([s, g]) => [s, { netGex: g }]));

describe("magnetsInBand", () => {
  it("toma el mayor GEX positivo y el más negativo dentro de la banda", () => {
    const m = magnetsInBand(gex([[95, -50], [99, 30], [100, 80], [101, -20], [110, 999]]), 100, 0.05);
    expect(m.pos).toBe(100);
    expect(m.neg).toBe(95);
  });
  it("sin GEX del signo → null", () => {
    expect(magnetsInBand(gex([[100, 10]]), 100, 0.01).neg).toBeNull();
  });
});

describe("techReading", () => {
  it("cuenta arriba, pesa el balance y el jalón", () => {
    const g = gex([[105, 10], [96, 5]]);
    const up = techCompany("NVDA", 100, 99, g, "2026-10-30"); // imán 105 arriba
    const down = techCompany("NFLX", 100, 99, gex([[96, 5]]), "2026-10-30"); // imán 96 abajo
    const none = techCompany("AMD", 100, 99, null, null);
    expect(up.dir).toBe(1);
    expect(down.dir).toBe(-1);
    const r = techReading([up, down, none], "SPX")!;
    expect(r.count).toBe(1);
    expect(r.n).toBe(2);
    // NVDA 7.8 arriba, NFLX 0.4 abajo → (7.8 − 0.4) / 8.2
    expect(r.balance).toBeCloseTo(((7.8 - 0.4) / 8.2) * 100, 5);
    expect(r.pull).toBeCloseTo((7.8 * 5 + 0.4 * -4) / 8.2, 5);
  });
  it("sin lecturas → null", () => {
    expect(techReading([techCompany("NVDA", null, null, null, null)], "SPX")).toBeNull();
  });
});

describe("upsertMinute / stepAt", () => {
  it("reemplaza el mismo minuto y agrega el siguiente", () => {
    let s = upsertMinute([], { t: 60, v: 1 });
    s = upsertMinute(s, { t: 60, v: 2 });
    s = upsertMinute(s, { t: 120, v: 3 });
    expect(s).toEqual([{ t: 60, v: 2 }, { t: 120, v: 3 }]);
    expect(stepAt(s, 100)?.v).toBe(2);
    expect(stepAt(s, 30)).toBeNull();
  });
});

describe("fillMagnets (imanes reconstruidos)", () => {
  const chain = [
    { strike: 100, type: "call" as const, oi: 5000, iv: 0.2 },
    { strike: 99, type: "put" as const, oi: 8000, iv: 0.2 },
    { strike: 101, type: "call" as const, oi: 100, iv: 0.2 },
  ];
  const close = 10_000 * 60;
  it("llena los minutos sin grabación y respeta lo grabado", () => {
    const line = [{ t: 60, v: 100 }, { t: 120, v: 100.2 }, { t: 180, v: 99.9 }];
    const rec = [{ t: 120, price: 100.2, pos: 101, neg: 98 }];
    const out = fillMagnets(rec, line, chain, 0.02, close);
    expect(out.map((p) => p.t)).toEqual([60, 120, 180]);
    expect(out[1]).toEqual(rec[0]);
    expect(out[0]).toMatchObject({ pos: 100, neg: 99, rebuilt: true });
  });
  it("sin cadena válida devuelve lo grabado tal cual", () => {
    const rec = [{ t: 60, price: 1, pos: null, neg: null }];
    expect(fillMagnets(rec, [{ t: 120, v: 1 }], [], 0.01, close)).toBe(rec);
  });
});

describe("fillTech (Vigía reconstruido)", () => {
  // Imán + muy arriba del precio para NVDA (call grande en 105) y abajo para AAPL (call grande en 95).
  const close = 10_000 * 60;
  const inputs = [
    { ticker: "NVDA", line: [{ t: 60, v: 100 }, { t: 120, v: 100 }], chain: [{ strike: 103, type: "call" as const, oi: 9000, iv: 0.3 }], expCloseSec: close },
    { ticker: "AAPL", line: [{ t: 60, v: 100 }, { t: 120, v: 100 }], chain: [{ strike: 97, type: "call" as const, oi: 9000, iv: 0.3 }], expCloseSec: close },
  ];
  it("arma conteo por minuto y respeta lo grabado", () => {
    const rec = { SPX: [{ t: 120, count: 2, n: 2, balance: 100, pull: 1 }], NDX: [] };
    const out = fillTech(rec, inputs);
    expect(out.SPX.map((p) => p.t)).toEqual([60, 120]);
    expect(out.SPX[0]).toMatchObject({ count: 1, n: 2, rebuilt: true });
    expect(out.SPX[1]).toEqual(rec.SPX[0]);
    expect(out.NDX).toHaveLength(2);
  });
});
