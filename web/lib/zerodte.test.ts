// Tests del motor GEX/Max Pain del Agente 0DTE — cubren el port desde el
// proyecto standalone (ago 2026): imán por |NET GEX| (no total), flip
// interpolado más cercano al spot, régimen por spot-vs-flip, y Max Pain.

import { describe, expect, it } from "vitest";
import { closingForecast, maxPainStrike, zeroDteGex, type ZeroDteGex } from "./zerodte";
import type { ZRow } from "./zerodteTypes";

const EXP = "2026-08-28";

function row(type: "call" | "put", strike: number, over: Partial<ZRow> = {}): ZRow {
  return {
    optionTicker: `X${strike}`, contractType: type, expiration: EXP, strike,
    openInterest: 100, volume: 50, bid: null, ask: null,
    greeks: { delta: null, gamma: 0.01, theta: null, vega: null, iv: 0.2 },
    ...over,
  };
}

describe("zeroDteGex — imán por |NET GEX|, no por total", () => {
  it("elige el strike de mayor NET GEX aunque otro tenga más gamma TOTAL (call+put balanceado)", () => {
    // Strike 100: mucho call Y mucho put (se cancelan casi todo -> NET GEX chico,
    // pero TOTAL alto). Strike 102: solo calls -> NET GEX alto, TOTAL más bajo.
    // Ambos strikes dentro de la ventana ±3% de GEX_NEAR_PCT alrededor de spot=100.
    const rows: ZRow[] = [
      row("call", 100, { openInterest: 500 }),
      row("put", 100, { openInterest: 480 }),
      row("call", 102, { openInterest: 300 }),
    ];
    const gex = zeroDteGex(rows, 100);
    // NET GEX(100) = pequeño (500-480 escalado); NET GEX(102) = grande (300, sin cancelar).
    expect(gex.kingStrike).toBe(102);
  });
});

describe("zeroDteGex — flip interpolado, más cercano al spot", () => {
  it("interpola entre dos strikes y toma el cruce de signo más cercano al spot", () => {
    // Ambos strikes dentro de la ventana ±3% alrededor de spot=96 ([93.1, 98.9]).
    const rows: ZRow[] = [
      row("put", 94, { openInterest: 400 }),  // netGex negativo
      row("call", 97, { openInterest: 50 }),  // netGex positivo -> cruce entre 94 y 97
    ];
    const gex = zeroDteGex(rows, 96);
    expect(gex.flipStrike).not.toBeNull();
    expect(gex.flipStrike as number).toBeGreaterThan(94);
    expect(gex.flipStrike as number).toBeLessThan(97);
  });

  it("régimen sigue la posición del SPOT respecto al flip, no el signo del total", () => {
    // netGex(87) = +10k (call chico), netGex(90) = -1000k (put grande) -> el
    // TOTAL es negativo, pero el flip interpolado cae cerca de 87 y el spot (89)
    // queda ARRIBA de él -> régimen debe ser POSITIVO pese al total negativo.
    const rows: ZRow[] = [
      row("call", 87, { openInterest: 10 }),
      row("put", 90, { openInterest: 1000 }),
    ];
    const gex: ZeroDteGex = zeroDteGex(rows, 89);
    expect(gex.totalNetGex).toBeLessThan(0);
    expect(gex.flipStrike).not.toBeNull();
    expect(gex.flipStrike as number).toBeLessThan(89);
    expect(gex.regime).toBe("positive");
  });
});

describe("maxPainStrike", () => {
  it("elige el strike de menor dolor total (holders pierden más ahí)", () => {
    // Todo el OI concentrado en 100 (calls) y 100 (puts) -> el mínimo dolor es 100.
    const rows: ZRow[] = [
      row("call", 100, { openInterest: 1000 }),
      row("put", 100, { openInterest: 1000 }),
      row("call", 105, { openInterest: 10 }),
      row("put", 95, { openInterest: 10 }),
    ];
    expect(maxPainStrike(rows, 100)).toBe(100);
  });

  it("null sin OI en la ventana", () => {
    const rows: ZRow[] = [row("call", 100, { openInterest: 0 })];
    expect(maxPainStrike(rows, 100)).toBeNull();
  });
});

describe("closingForecast — Max Pain y confluencia", () => {
  const now = new Date("2026-08-28T19:45:00.000Z"); // 15:45 ET, dentro de la ventana 3-4pm

  it("agrega nota de confluencia cuando Max Pain coincide con el imán en γ+", () => {
    const gex: ZeroDteGex = {
      nodes: [], kingStrike: 100, flipStrike: 95, regime: "positive",
      totalNetGex: 1, realGammaShare: 1, n: 3,
    };
    const fc = closingForecast(100, 0.2, gex, now, 5, 100);
    expect(fc).not.toBeNull();
    expect(fc!.maxPain).toBe(100);
    expect(fc!.note).toMatch(/confluencia/);
  });

  it("no promete confluencia si Max Pain diverge del imán", () => {
    const gex: ZeroDteGex = {
      nodes: [], kingStrike: 100, flipStrike: 95, regime: "positive",
      totalNetGex: 1, realGammaShare: 1, n: 3,
    };
    const fc = closingForecast(100, 0.2, gex, now, 5, 60);
    expect(fc!.maxPain).toBe(60);
    expect(fc!.note).not.toMatch(/confluencia/);
    expect(fc!.note).toMatch(/Max Pain \(OI\) en 60/);
  });

  it("sin Max Pain, la nota no lo menciona", () => {
    const gex: ZeroDteGex = {
      nodes: [], kingStrike: 100, flipStrike: 95, regime: "positive",
      totalNetGex: 1, realGammaShare: 1, n: 3,
    };
    const fc = closingForecast(100, 0.2, gex, now, 5, null);
    expect(fc!.maxPain).toBeNull();
    expect(fc!.note).not.toMatch(/Max Pain/);
  });
});
