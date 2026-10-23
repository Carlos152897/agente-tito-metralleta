import { describe, expect, it } from "vitest";
import {
  calibrateMomentum,
  defaultGrid,
  evaluateParams,
  MIN_SAMPLES_FOR_TRUST,
  simulateMomentumDay,
  type MomentumRawSnap,
} from "./momentumCalibration";
import type { MomentumParams } from "./zerodteAlt";

// Parámetros elegidos para que un flujo alcista fuerte con spot sobre el imán
// (pivote) confirme un long hacia el Call Wall, con números redondos fáciles
// de verificar a mano: entry 100, target 110 (wall), stop 95.
const PARAMS: MomentumParams = {
  minRR: 1, reachSigmaK: 3, stopSigmaK: 0.5, minStopPts: 2, minStrength: 0.3, fallbackSigmaK: 1,
};

function bullSnap(sec: number, spot: number, regime: "positive" | "negative" = "negative"): MomentumRawSnap {
  return {
    sec, spot, regime,
    cvd: null, cvdDom: null, velocity: 3, // velC = 1 → fuerza plena
    burstBull: 100, burstBear: 0,          // 100% alcista → confirma long
    netGex: null,
    magnet: 95,        // pivote: spot >= 95 habilita el long
    sigma: 10,
    flip: null,
    callWall: 110,     // objetivo del long
    putWall: null,
  };
}

describe("simulateMomentumDay", () => {
  it("resuelve WIN cuando el spot toca el target antes que el stop", () => {
    // Al llegar a 111 (más allá del Call Wall en 110) `momentumEntry` recalcula
    // con `wallOk=false` y arma una SEGUNDA señal (fallback ±σ) en ese mismo
    // instante — comportamiento real del motor, no un artefacto del harness.
    // Lo que importa acá es que la PRIMERA señal (target=110) resuelva "win".
    const day = [bullSnap(0, 100), bullSnap(60, 105), bullSnap(120, 111)];
    const { signals, results } = simulateMomentumDay(day, PARAMS);
    expect(signals[0]).toMatchObject({ d: "long", tgt: 110, stop: 95, entrySpot: 100 });
    expect(results[0]).toBe("win");
  });

  it("resuelve LOSS cuando el spot toca el stop antes que el target", () => {
    const day = [bullSnap(0, 100), bullSnap(60, 97), bullSnap(120, 90)];
    const { results } = simulateMomentumDay(day, PARAMS);
    expect(results).toEqual(["loss"]);
  });

  it("deja el trade OPEN si no toca ninguno de los dos antes del cierre", () => {
    const day = [bullSnap(0, 100), bullSnap(60, 102), bullSnap(120, 101)];
    const { results } = simulateMomentumDay(day, PARAMS);
    expect(results).toEqual(["open"]);
  });

  it("no cuenta la misma señal repetida como trades nuevos (target ≈ igual)", () => {
    // Todos los spots se quedan por debajo del Call Wall (110) — el target no
    // cambia en ningún tick, así que las 4 lecturas son UNA sola racha.
    const day = [bullSnap(0, 100), bullSnap(60, 101), bullSnap(120, 102), bullSnap(180, 103)];
    const { signals } = simulateMomentumDay(day, PARAMS);
    expect(signals).toHaveLength(1); // una sola racha, no 4
  });

  it("no genera señal fuera de γ− (regimen positivo)", () => {
    const day = [bullSnap(0, 100, "positive"), bullSnap(60, 111, "positive")];
    const { signals } = simulateMomentumDay(day, PARAMS);
    expect(signals).toHaveLength(0);
  });

  it("no genera señal si el flujo no alcanza minStrength", () => {
    const weak: MomentumRawSnap = { ...bullSnap(0, 100), velocity: 1, burstBull: 0, burstBear: 0 };
    const strict: MomentumParams = { ...PARAMS, minStrength: 0.9 };
    const { signals } = simulateMomentumDay([weak], strict);
    expect(signals).toHaveLength(0);
  });
});

describe("evaluateParams", () => {
  it("agrega resultados de varios días (1 win + 1 loss → 50% win-rate)", () => {
    // winDay genera una 2ª señal (fallback) al cruzar el Call Wall en el mismo
    // tick del win (ver nota en simulateMomentumDay) — queda "open", no cuenta.
    const winDay = [bullSnap(0, 100), bullSnap(60, 111)];
    const lossDay = [bullSnap(0, 100), bullSnap(60, 90)];
    const res = evaluateParams([winDay, lossDay], PARAMS);
    expect(res.signals).toBe(3);
    expect(res.resolved).toBe(2);
    expect(res.wins).toBe(1);
    expect(res.winRate).toBe(50);
    expect(res.avgRR).toBeCloseTo(2, 5); // (110-100)/(100-95) = 2, igual en ambos días
  });

  it("no cuenta trades abiertos en el win-rate", () => {
    const openDay = [bullSnap(0, 100), bullSnap(60, 102)];
    const res = evaluateParams([openDay], PARAMS);
    expect(res.signals).toBe(1);
    expect(res.resolved).toBe(0);
    expect(res.winRate).toBeNull();
  });

  it("con cero señales, todo sale en null/0 (nunca NaN)", () => {
    const quietDay = [bullSnap(0, 100, "positive")];
    const res = evaluateParams([quietDay], PARAMS);
    expect(res).toMatchObject({ signals: 0, resolved: 0, wins: 0, winRate: null, avgRR: null });
  });
});

describe("defaultGrid", () => {
  it("cubre el producto cartesiano completo con minStopPts/fallbackSigmaK fijos", () => {
    const grid = defaultGrid();
    expect(grid.length).toBe(5 * 3 * 4 * 3);
    for (const p of grid) {
      expect(p.minStopPts).toBe(8);
      expect(p.fallbackSigmaK).toBe(1.2);
    }
  });
});

describe("calibrateMomentum", () => {
  it("deja `trusted` vacío por debajo de MIN_SAMPLES_FOR_TRUST aunque el win-rate sea perfecto", () => {
    const winDay = [bullSnap(0, 100), bullSnap(60, 111)];
    const { trusted, all } = calibrateMomentum([winDay], [PARAMS]);
    expect(trusted).toHaveLength(0); // 1 resuelto < MIN_SAMPLES_FOR_TRUST
    expect(all).toHaveLength(1);
    expect(all[0].resolved).toBeLessThan(MIN_SAMPLES_FOR_TRUST);
    expect(all[0].winRate).toBe(100);
  });

  it("ordena `all` por cantidad de trades resueltos desc", () => {
    const busyDay = [bullSnap(0, 100), bullSnap(60, 111)];
    const quietDay = [bullSnap(0, 100, "positive")];
    const strict: MomentumParams = { ...PARAMS, minStrength: 0.99 }; // nunca confirma
    const { all } = calibrateMomentum([busyDay, quietDay], [PARAMS, strict]);
    expect(all[0].resolved).toBeGreaterThanOrEqual(all[1].resolved);
  });
});
