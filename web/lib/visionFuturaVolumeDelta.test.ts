import { describe, expect, it } from "vitest";
import { bareSymbol, positionOf, strikeMinutes, volDeltaRows } from "./visionFuturaVolumeDelta";

describe("volumen delta", () => {
  const call = [{ t: 60, v: 100, a: 70, b: 20 }, { t: 120, v: 50, a: 10, b: 40 }];
  const put = [{ t: 60, v: 30, a: 5, b: 20 }, { t: 180, v: 10, a: 10, b: 0 }];
  const mins = strikeMinutes(call, put);

  it("junta call y put por minuto", () => {
    expect(mins.map((m) => m.t)).toEqual([60, 120, 180]);
    expect(mins[0]).toEqual({ t: 60, cA: 70, cB: 20, cV: 100, pA: 5, pB: 20, pV: 30 });
  });

  it("delta y ventana anterior", () => {
    // Ventana de 1 min que termina en 120 → minuto 60: (70−20) − (5−20) = 65; anterior (0) sin volumen → null.
    const [r] = volDeltaRows(new Map([[7720, mins]]), 120, 60);
    expect(r.delta).toBe(65);
    expect(r.prevDelta).toBeNull();
    // Ventana de 1 min que termina en 180 → minuto 120: (10−40) = −30; anterior = 65.
    const [r2] = volDeltaRows(new Map([[7720, mins]]), 180, 60);
    expect(r2.delta).toBe(-30);
    expect(r2.prevDelta).toBe(65);
    expect(r2.position).toEqual({ kind: "venden_calls", contracts: 30, side: "abajo" });
  });

  it("día completo", () => {
    const [r] = volDeltaRows(new Map([[7720, mins]]), 240, null);
    expect(r.cV + r.pV).toBe(190);
    expect(r.delta).toBe((80 - 60) - (15 - 20));
  });

  it("posición dominante con puts", () => {
    expect(positionOf({ cA: 1, cB: 0, cV: 1, pA: 50, pB: 10, pV: 60 })).toEqual({ kind: "compran_puts", contracts: 40, side: "abajo" });
    expect(positionOf({ cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0 })).toBeNull();
  });

  it("símbolo sin sufijo", () => {
    expect(bareSymbol(".SPXW261029C7720{=m}")).toBe(".SPXW261029C7720");
  });
});

import { detectVolumeSpikes } from "./visionFuturaVolumeDelta";

describe("volumen delta inusual", () => {
  const open = 0;
  // 40 minutos tranquilos (5 calls netas por minuto) y un salto de 400 calls compradas en el minuto 40.
  const quiet = (k: number) => Array.from({ length: 40 }, (_, i) => ({ t: 900 + i * 60, cA: 5 + k, cB: 0, cV: 5 + k, pA: 0, pB: 0, pV: 0 }));
  const spikeT = 900 + 40 * 60;
  it("marca el salto grande y no lo normal", () => {
    const a = [...quiet(0), { t: spikeT, cA: 400, cB: 0, cV: 400, pA: 0, pB: 0, pV: 0 }];
    const b = quiet(1);
    const hits = detectVolumeSpikes(new Map([[100, a], [105, b]]), spikeT + 60, open);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ strike: 100, t: spikeT, kind: "compran_calls", side: "arriba", contracts: 400 });
    expect(hits[0].ratio).toBeGreaterThan(50);
  });
  it("se apaga después de 3 minutos", () => {
    const a = [...quiet(0), { t: spikeT, cA: 400, cB: 0, cV: 400, pA: 0, pB: 0, pV: 0 }];
    expect(detectVolumeSpikes(new Map([[100, a]]), spikeT + 4 * 60, open)).toHaveLength(0);
  });
  it("debajo del mínimo de contratos no cuenta", () => {
    const a = [...quiet(0), { t: spikeT, cA: 40, cB: 0, cV: 40, pA: 0, pB: 0, pV: 0 }];
    expect(detectVolumeSpikes(new Map([[100, a]]), spikeT + 60, open)).toHaveLength(0);
  });
});
