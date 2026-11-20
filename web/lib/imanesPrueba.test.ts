import { describe, expect, it } from "vitest";
import { magnetsAt, observeDay, reachPts, summarize, touch, type PruebaTick } from "./imanesPrueba";

const row = (spx: number, netGex: number, cA = 0, cB = 0, pA = 0, pB = 0) => ({ spx, netGex, callAsk: cA, callBid: cB, putAsk: pA, putBid: pB });

function tick(time: number, spot: number, rows: ReturnType<typeof row>[], levels: { kind: string; spx: number }[] = []): PruebaTick {
  return { time, spot: { spx: spot }, rows, keyLevels: levels, expectedMove: { points: 100 } };
}

describe("imanesPrueba", () => {
  it("touch: toca si el nivel queda entre low y high, solo velas futuras", () => {
    const bars = [{ time: 0, high: 10, low: 5 }, { time: 60, high: 12, low: 9 }, { time: 120, high: 15, low: 11 }];
    expect(touch(bars, 60, 180, 14).hit).toBe(true);
    expect(touch(bars, 60, 120, 14)).toEqual({ hit: false, closest: 2 });
    expect(touch(bars, 60, 180, 6).hit).toBe(false); // la vela de 0 es pasado
  });

  it("reachPts se achica con el tiempo que falta y tiene mínimo", () => {
    const t = tick(0, 7000, []);
    expect(reachPts(t, 390)).toBeCloseTo(100);
    expect(reachPts(t, 97.5)).toBeCloseTo(50);
    expect(reachPts(t, 0)).toBe(5);
  });

  it("imanes actuales y de prueba salen del tick", () => {
    const t0 = tick(0, 7000, [row(7010, 50e6), row(6990, -200e6), row(7100, 900e6)]);
    const t1 = tick(300, 7000, [row(7010, 50e6, 200_000), row(6990, -200e6, 0, 0, 0, 0), row(7100, 900e6)],
      [{ kind: "iman_positivo", spx: 7010 }, { kind: "magneto", spx: 7010 }]);
    const ms = magnetsAt([t0, t1], 1, 30);
    const ids = Object.fromEntries(ms.map((m) => [m.id, m.strike]));
    expect(ids.gex_pos).toBe(7010);
    expect(ids.gex_lado_pos).toBe(7010); // compra agresiva de 5 min en 7010
    expect(ids.ref5_pos).toBe(7010);
    expect(ids.p_confluencia).toBe(7010); // GEX +, Magneto, lado, ref... coinciden
    // Con 30 min al cierre el alcance es ~28 pts: el 7,100 (GEX enorme pero a 100 pts) no gana arriba.
    expect(ids.p_gex_tiempo_arr).toBe(7010);
    expect(ids.p_gex_tiempo_abj).toBe(6990);
  });

  it("observeDay + summarize: acierto, espejo y base", () => {
    const open = 0;
    const close = 390 * 60;
    const ticks: PruebaTick[] = [];
    for (let m = 0; m <= 390; m += 5) ticks.push(tick(m * 60, 7000, [row(7010, 50e6)], [{ kind: "iman_positivo", spx: 7010 }]));
    // El precio sube 0.1 por minuto: toca 7,010 a los 100 min y nunca baja a 6,990.
    const bars = Array.from({ length: 390 }, (_, i) => ({ time: i * 60, low: 7000 + i * 0.1, high: 7000 + i * 0.1 + 0.2 }));
    const obs = observeDay("d", ticks, bars, close, open);
    const st = summarize(obs).find((s) => s.id === "gex_pos" && s.horizon === 60)!;
    expect(st.n).toBeGreaterThan(0);
    expect(st.mirrorPct).toBe(0);
    expect(st.hitPct).toBeGreaterThan(st.basePct);
    expect(st.edge).toBeGreaterThan(0);
  });
});

import { bounceAt, bounceDay, summarizeBounces } from "./imanesPrueba";

describe("imanesPrueba · rebote", () => {
  const bar = (i: number, low: number, high: number) => ({ time: i * 60, low, high });

  it("sube, toca 7,010 y regresa 3 pts → rebote", () => {
    const bars = [bar(0, 7000, 7004), bar(1, 7004, 7008), bar(2, 7008, 7010.5), bar(3, 7008, 7010), bar(4, 7006, 7008)];
    expect(bounceAt(bars, 0, 600, 7010, "abajo", 3, 1800)).toEqual({ touchT: 120, outcome: "rebote" });
  });

  it("sube, toca y sigue 3 pts arriba → atraviesa (también en la misma vela del toque)", () => {
    const a = [bar(0, 7000, 7005), bar(1, 7005, 7010), bar(2, 7010, 7014)];
    expect(bounceAt(a, 0, 600, 7010, "abajo", 3, 1800)?.outcome).toBe("atraviesa");
    const b = [bar(0, 7000, 7005), bar(1, 7005, 7014)];
    expect(bounceAt(b, 0, 600, 7010, "abajo", 3, 1800)?.outcome).toBe("atraviesa");
  });

  it("baja hacia un piso: rebote = vuelve a subir", () => {
    const bars = [bar(0, 6995, 7000), bar(1, 6990, 6996), bar(2, 6991, 6994)];
    expect(bounceAt(bars, 0, 600, 6990, "arriba", 3, 1800)?.outcome).toBe("rebote");
  });

  it("no lo toca → null; se queda pegado → nada", () => {
    expect(bounceAt([bar(0, 7000, 7005)], 0, 600, 7010, "abajo", 3, 1800)).toBeNull();
    expect(bounceAt([bar(0, 7008, 7010), bar(1, 7009, 7011)], 0, 600, 7010, "abajo", 3, 1800)?.outcome).toBe("nada");
  });

  it("bounceDay cuenta cada toque una vez y arma la base", () => {
    const ticks: PruebaTick[] = [];
    for (let m = 0; m <= 390; m += 5) ticks.push(tick(m * 60, 7000, [row(7010, 50e6)], [{ kind: "iman_positivo", spx: 7010 }]));
    // Sube a 7,010 en el minuto 30, rebota a 7,000 y se queda.
    const bars = Array.from({ length: 390 }, (_, i) => {
      const p = i <= 30 ? 7000 + i / 3 : Math.max(7000, 7010 - (i - 30));
      return bar(i, p - 0.2, p + 0.2);
    });
    const ev = bounceDay("d", ticks, bars, 390 * 60, 0);
    const mine = ev.filter((e) => e.id === "gex_pos" && e.x === 3);
    expect(mine).toHaveLength(1);
    expect(mine[0].outcome).toBe("rebote");
    const st = summarizeBounces(ev).find((s) => s.id === "gex_pos" && s.x === 3)!;
    expect(st.toques).toBe(1);
    expect(st.rebotePct).toBe(1);
  });
});

import { breakoutTrade, favorOf } from "./imanesPrueba";

describe("imanesPrueba · ruptura", () => {
  const bar = (i: number, low: number, high: number) => ({ time: i * 60, low, high });

  it("a favor / en contra solo para imanes de flujo", () => {
    expect(favorOf("ref5_pos", "abajo")).toBe("a_favor");
    expect(favorOf("ref5_pos", "arriba")).toBe("en_contra");
    expect(favorOf("gex_lado_neg", "arriba")).toBe("a_favor");
    expect(favorOf("gex_pos", "abajo")).toBe("sin_lado");
    expect(favorOf("magneto", "abajo")).toBe("sin_lado");
  });

  it("largo en la ruptura: objetivo, stop y salida por tiempo", () => {
    const win = [bar(0, 7008, 7010), bar(1, 7009, 7013), bar(2, 7012, 7016)];
    expect(breakoutTrade(win, 0, 7010, "abajo", 3, 5, 1800)).toMatchObject({ outcome: "objetivo", pts: 5, mfe: 6, exitT: 180 });
    const loss = [bar(0, 7008, 7010), bar(1, 7006, 7011)];
    expect(breakoutTrade(loss, 0, 7010, "abajo", 3, 5, 1800)?.outcome).toBe("stop");
    // Misma vela con stop y objetivo → stop (conservador).
    expect(breakoutTrade([bar(0, 7009, 7010), bar(1, 7006, 7016)], 0, 7010, "abajo", 3, 5, 1800)?.outcome).toBe("stop");
    const flat = [bar(0, 7009, 7010), bar(1, 7009, 7012)];
    expect(breakoutTrade(flat, 0, 7010, "abajo", 3, 5, 1800)).toMatchObject({ outcome: "tiempo", pts: 0.5, mfe: 2 });
  });

  it("corto en la ruptura de un piso", () => {
    const bars = [bar(0, 6990, 6992), bar(1, 6984, 6991)];
    expect(breakoutTrade(bars, 0, 6990, "arriba", 3, 5, 1800)?.outcome).toBe("objetivo");
  });
});

import { paperDay } from "./imanesPrueba";

describe("imanesPrueba · en papel", () => {
  it("corto en la ruptura del Imán flujo 15m + bajando, una operación a la vez", () => {
    const row = (spx: number, cA: number) => ({ spx, netGex: 0, callAsk: cA, callBid: 0, putAsk: 0, putBid: 0 });
    const ticks: PruebaTick[] = [];
    // 6,990 acumula compra de calls (flujo alcista) cada paso de 5 min; precio arriba en 7,000.
    for (let m = 0; m <= 390; m += 5) ticks.push({ time: m * 60, spot: { spx: 7000 }, rows: [row(6990, m * 100_000), row(7010, 0)], keyLevels: [], expectedMove: { points: 100 } });
    // Baja hasta 6,990 en el minuto 40 y sigue cayendo 1 pt por minuto.
    const bars = Array.from({ length: 390 }, (_, i) => {
      const p = i < 30 ? 7000 : 7000 - (i - 30);
      return { time: i * 60, low: p - 0.2, high: p + 0.2, close: p };
    });
    const tr = paperDay("d", ticks, bars, 390 * 60, 0).filter((t) => t.rule === "flujo15_obj5");
    expect(tr.length).toBe(1);
    expect(tr[0]).toMatchObject({ strike: 6990, side: "corto", outcome: "objetivo", pts: 5, target: 6985, stop: 6993 });
  });
});
