import { describe, expect, it } from "vitest";
import { magnetsInBand, stepAt, techCompany, techReading, upsertMinute } from "./visionFuturaContext";

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
