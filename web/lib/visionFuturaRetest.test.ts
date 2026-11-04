import { describe, expect, it } from "vitest";
import { atrAt, retestSummary, runRetestDay, type RetestAlertIn, type RetestBar } from "./visionFuturaRetest";

const T0 = 1_800_000_000; // segundos, múltiplo de 300 no hace falta
const t0 = Math.floor(T0 / 300) * 300;

/** 40 velas planas de rango 2 (ATR ≈ 2) alrededor de `px`, luego las que se pasen. */
function bars(px: number, extra: [number, number, number, number][] = []): RetestBar[] {
  const out: RetestBar[] = [];
  for (let i = 0; i < 40; i++) out.push({ time: t0 + i * 60, open: px, high: px + 1, low: px - 1, close: px });
  extra.forEach(([o, h, l, c], i) => out.push({ time: t0 + (40 + i) * 60, open: o, high: h, low: l, close: c }));
  return out;
}

const alertAt = (min: number, over: Partial<RetestAlertIn> = {}): RetestAlertIn => ({
  id: "defensa_piso:100", kind: "defensa_piso", title: "Defensa de PISO 100", side: "largo", level: 100,
  firedAt: (t0 + min * 60) * 1000 + 5_000, price: 100.2, riskPts: 3, rewardPts: 3, levels: [110], ...over,
});

describe("motores retest y v3", () => {
  it("ATR de velas de 5 min", () => {
    expect(atrAt(bars(100), (t0 + 40 * 60) * 1000)).toBeCloseTo(2, 5);
  });

  it("espera alejarse, regresar a la zona y una vela a favor; luego objetivo", () => {
    // alerta en la vela 39; se aleja (102), regresa a 100.5 con vela verde, y sube a 104
    const b = bars(100, [[101, 102, 100.8, 101.8], [101.8, 101.9, 100.4, 101.0], [100.8, 101.2, 100.3, 101.1], [101.1, 104.5, 101, 104.2]]);
    const { retest, v3 } = runRetestDay({ alerts: [alertAt(39)], bars: b, nowMs: (t0 + 50 * 60) * 1000, final: false });
    // entrada en la vela 42 (verde, en zona, arriba del nivel) a 101.1
    expect(retest[0]).toMatchObject({ status: "cerrada", entry: 101.1, outcome: "objetivo", points: 3 });
    // v3: stop = 100 − 0.75×2 = 98.5 → R 2.6; t1 = 103.05; t2 = 110 no (≥0.8R sí: 8.9) → 110 → no llega: abierta con stop en la entrada
    expect(v3[0]).toMatchObject({ status: "abierta", entry: 101.1, stop: 98.5, t1Hit: true, stopNow: 101.1, t2: 110 });
    expect(retestSummary(retest)).toMatchObject({ entries: 1, wins: 1, losses: 0 });
  });

  it("v3 sale en cero si toca el objetivo 1 y regresa", () => {
    const b = bars(100, [[101, 102, 100.8, 101.8], [101.8, 101.9, 100.4, 101.0], [100.8, 101.2, 100.3, 101.1], [101.1, 103.2, 101, 103], [103, 103.1, 100.9, 101]]);
    const { v3 } = runRetestDay({ alerts: [alertAt(39)], bars: b, nowMs: (t0 + 60 * 60) * 1000, final: true });
    expect(v3[0]).toMatchObject({ outcome: "en cero", points: 0 });
  });

  it("se cancela si el nivel falla o pasa el tiempo; queda armada mientras espera", () => {
    const fail = bars(100, [[101, 102, 100.8, 101.8], [101, 101, 99, 99.3]]);
    expect(runRetestDay({ alerts: [alertAt(39)], bars: fail, nowMs: (t0 + 60 * 60) * 1000, final: false }).retest[0]).toMatchObject({ status: "cancelada", reason: "el nivel falló" });
    const wait = bars(100, [[101, 102, 100.8, 101.8]]);
    expect(runRetestDay({ alerts: [alertAt(39)], bars: wait, nowMs: (t0 + 42 * 60) * 1000, final: false }).retest[0].status).toBe("armada");
    expect(runRetestDay({ alerts: [alertAt(39)], bars: wait, nowMs: (t0 + 42 * 60) * 1000, final: true }).retest[0].status).toBe("cancelada");
  });

  it("solo usa velas terminadas antes de ahora", () => {
    const b = bars(100, [[101, 102, 100.8, 101.8], [101.8, 101.9, 100.4, 101.0], [100.8, 101.2, 100.3, 101.1]]);
    // a mitad de la vela 42 todavía no hay confirmación
    expect(runRetestDay({ alerts: [alertAt(39)], bars: b, nowMs: (t0 + 42 * 60 + 30) * 1000, final: false }).retest[0].status).toBe("armada");
  });
});
