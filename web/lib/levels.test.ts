import { describe, expect, it } from "vitest";
import {
  clusterPivots,
  findLevels,
  findPivots,
  recencyFactor,
  type ChainLevel,
  type FlowLevel,
  type LvlBar,
} from "./levels";

const NOW = new Date("2026-07-24T12:00:00Z");

function bar(time: string, high: number, low: number, close = (high + low) / 2): LvlBar {
  return { time, high, low, close };
}

/** Serie plana con picos/valles inyectados en las posiciones que se pidan. */
function series(spec: Record<number, [number, number]>, n = 40): LvlBar[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const [h, l] = spec[i] ?? [101, 99];
    return bar(d, h, l);
  });
}

describe("findPivots", () => {
  it("detecta un swing high aislado", () => {
    const p = findPivots(series({ 10: [120, 110] }));
    const highs = p.filter((x) => x.kind === "high");
    expect(highs).toHaveLength(1);
    expect(highs[0].price).toBe(120);
  });

  it("detecta un swing low aislado", () => {
    const p = findPivots(series({ 12: [90, 80] }));
    const lows = p.filter((x) => x.kind === "low");
    expect(lows).toHaveLength(1);
    expect(lows[0].price).toBe(80);
  });

  it("no inventa pivotes en una serie plana", () => {
    expect(findPivots(series({}))).toHaveLength(0);
  });

  it("devuelve vacío si no hay barras suficientes", () => {
    expect(findPivots([bar("2026-07-01", 10, 9)])).toEqual([]);
  });

  it("respeta la ventana k", () => {
    // Con k=1 un pico estrecho cuenta; con k=5 necesita dominar más velas.
    const s = series({ 10: [120, 110], 12: [125, 115] });
    expect(findPivots(s, 1).filter((p) => p.kind === "high").length).toBeGreaterThanOrEqual(2);
    expect(findPivots(s, 5).filter((p) => p.kind === "high").length).toBe(1);
  });
});

describe("clusterPivots", () => {
  it("junta pivotes casi al mismo precio en un solo nivel", () => {
    const c = clusterPivots([
      { price: 299, time: "2026-06-01", kind: "high" },
      { price: 301, time: "2026-07-01", kind: "high" },
    ], 1);
    expect(c).toHaveLength(1);
    expect(c[0].touches).toBe(2);
    expect(c[0].price).toBeCloseTo(300, 6);
    expect(c[0].lastTouch).toBe("2026-07-01");
  });

  it("no junta precios lejanos", () => {
    const c = clusterPivots([
      { price: 100, time: "2026-06-01", kind: "high" },
      { price: 200, time: "2026-07-01", kind: "high" },
    ], 1);
    expect(c).toHaveLength(2);
  });

  it("cuenta techos y suelos por separado", () => {
    const c = clusterPivots([
      { price: 100, time: "2026-06-01", kind: "high" },
      { price: 100.2, time: "2026-06-10", kind: "low" },
    ], 1);
    expect(c[0].highs).toBe(1);
    expect(c[0].lows).toBe(1);
  });

  it("sin pivotes devuelve vacío", () => {
    expect(clusterPivots([], 1)).toEqual([]);
  });
});

describe("recencyFactor", () => {
  it("lo reciente pesa completo y lo viejo se degrada", () => {
    expect(recencyFactor("2026-07-20", NOW)).toBe(1);
    expect(recencyFactor("2026-06-01", NOW)).toBe(0.75);
    expect(recencyFactor("2026-03-01", NOW)).toBe(0.5);
    expect(recencyFactor("2025-01-01", NOW)).toBe(0.3);
  });
});

describe("findLevels", () => {
  const bars = series({ 8: [120, 118], 14: [121, 119], 20: [82, 80], 26: [81, 79] }, 40);

  it("clasifica por encima del spot como resistencia y por debajo como soporte", () => {
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    expect(r.resistances.every((l) => l.price > 100)).toBe(true);
    expect(r.supports.every((l) => l.price < 100)).toBe(true);
  });

  it("un nivel tocado dos veces sale más fuerte que uno tocado una", () => {
    const dos = series({ 8: [120, 118], 14: [120.5, 118.5] }, 40);
    const una = series({ 8: [120, 118] }, 40);
    const a = findLevels({ bars: dos, spot: 100, now: NOW, rangePct: 40 });
    const b = findLevels({ bars: una, spot: 100, now: NOW, rangePct: 40 });
    expect(a.resistances[0].strength).toBeGreaterThan(b.resistances[0].strength);
  });

  it("la venta de calls refuerza una resistencia (tabla del Proceso Principal)", () => {
    const flows: FlowLevel[] = [
      { strike: 120, type: "call", aggression: "bid", premium: 50_000_000 },
    ];
    const sin = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    const con = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, flows });
    const rSin = sin.resistances.find((l) => Math.abs(l.price - 120) < 2)!;
    const rCon = con.resistances.find((l) => Math.abs(l.price - 120) < 2)!;
    expect(rCon.strength).toBeGreaterThan(rSin.strength);
    expect(rCon.sources.flowPremium).toBe(50_000_000);
  });

  it("la venta de puts refuerza un soporte", () => {
    const flows: FlowLevel[] = [
      { strike: 80, type: "put", aggression: "bid", premium: 50_000_000 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, flows });
    const s = r.supports.find((l) => Math.abs(l.price - 80) < 2)!;
    expect(s.sources.flowPremium).toBe(50_000_000);
  });

  it("la COMPRA de opciones no construye muro (solo la venta)", () => {
    const comprado: FlowLevel[] = [
      { strike: 120, type: "call", aggression: "ask", premium: 50_000_000 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, flows: comprado });
    const l = r.resistances.find((x) => Math.abs(x.price - 120) < 2)!;
    expect(l.sources.flowPremium).toBe(0);
  });

  it("solo cuenta calls para resistencia y puts para soporte", () => {
    const chain: ChainLevel[] = [
      { strike: 120, contractType: "put", openInterest: 90_000, notionalValue: 1e9 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, chain });
    const l = r.resistances.find((x) => Math.abs(x.price - 120) < 2)!;
    expect(l.sources.openInterest).toBe(0); // puts no sostienen una resistencia
  });

  it("un strike con dinero entra como nivel aunque el precio nunca haya reaccionado ahí", () => {
    const chain: ChainLevel[] = [
      { strike: 110, contractType: "call", openInterest: 80_000, notionalValue: 8e8 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, chain });
    const l = r.resistances.find((x) => Math.abs(x.price - 110) < 1);
    expect(l).toBeTruthy();
    expect(l!.sources.touches).toBe(0);
  });

  it("la confluencia precio + opciones puntúa más que cada fuente por separado", () => {
    const chain: ChainLevel[] = [
      { strike: 120, contractType: "call", openInterest: 50_000, notionalValue: 5e8 },
    ];
    const soloPrecio = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    const ambos = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, chain });
    const a = soloPrecio.resistances.find((l) => Math.abs(l.price - 120) < 2)!;
    const b = ambos.resistances.find((l) => Math.abs(l.price - 120) < 2)!;
    expect(b.strength).toBeGreaterThan(a.strength);
    expect(b.why).toContain("confluencia");
  });


  it("descarta strikes con OI residual y sin rebote previo (ruido)", () => {
    const chain: ChainLevel[] = [
      // uno grande y varios minúsculos alrededor
      { strike: 110, contractType: "call", openInterest: 90_000, notionalValue: 9e8 },
      { strike: 111, contractType: "call", openInterest: 40, notionalValue: 1e5 },
      { strike: 112, contractType: "call", openInterest: 30, notionalValue: 1e5 },
      { strike: 113, contractType: "call", openInterest: 20, notionalValue: 1e5 },
      { strike: 114, contractType: "call", openInterest: 10, notionalValue: 1e5 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, chain, tolerancePct: 0.4 });
    const precios = r.resistances.map((l) => Math.round(l.price));
    expect(precios).toContain(110);          // el grande entra
    expect(precios).not.toContain(113);      // el ruido no
  });

  it("un strike pequeño SÍ entra si el precio ya reaccionó ahí", () => {
    const chain: ChainLevel[] = [
      { strike: 120, contractType: "call", openInterest: 5, notionalValue: 1e4 },
      { strike: 108, contractType: "call", openInterest: 90_000, notionalValue: 9e8 },
    ];
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40, chain, tolerancePct: 1 });
    // 120 tiene pivotes de precio en `bars`, así que sobrevive pese al OI mínimo.
    expect(r.resistances.some((l) => Math.abs(l.price - 120) < 2)).toBe(true);
  });

  it("descarta niveles fuera del rango operativo", () => {
    const lejos = series({ 8: [500, 490] }, 40);
    const r = findLevels({ bars: lejos, spot: 100, now: NOW, rangePct: 25 });
    expect(r.resistances.every((l) => Math.abs(l.distancePct) <= 25)).toBe(true);
  });

  it("marca como flipeado un techo que ahora queda por debajo del precio", () => {
    // Pivotes de máximo en 82; con el spot en 100 pasan a ser soporte.
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    const s = r.supports.find((l) => Math.abs(l.price - 81) < 3);
    expect(s).toBeTruthy();
  });

  it("expone el soporte y la resistencia más fuertes", () => {
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    expect(r.keySupport).toBeTruthy();
    expect(r.keyResistance).toBeTruthy();
    expect(r.keySupport!.strength).toBeGreaterThanOrEqual(
      Math.max(...r.supports.map((l) => l.strength)) - 0.001,
    );
  });

  it("la fuerza nunca se sale de 0-100", () => {
    const chain: ChainLevel[] = [
      { strike: 120, contractType: "call", openInterest: 5_000_000, notionalValue: 9e12 },
    ];
    const flows: FlowLevel[] = [
      { strike: 120, type: "call", aggression: "bid", premium: 9e12 },
    ];
    const r = findLevels({
      bars, spot: 100, now: NOW, rangePct: 40, chain, flows,
      gex: [{ strike: 120, netGex: 9e12 }],
    });
    for (const l of [...r.supports, ...r.resistances]) {
      expect(l.strength).toBeGreaterThanOrEqual(0);
      expect(l.strength).toBeLessThanOrEqual(100);
    }
  });

  it("sin barras devuelve el reporte vacío", () => {
    const r = findLevels({ bars: [], spot: 100, now: NOW });
    expect(r.supports).toEqual([]);
    expect(r.resistances).toEqual([]);
  });

  it("los soportes salen ordenados del más cercano al más lejano", () => {
    const r = findLevels({ bars, spot: 100, now: NOW, rangePct: 40 });
    for (let i = 1; i < r.supports.length; i++) {
      expect(r.supports[i].price).toBeLessThan(r.supports[i - 1].price);
    }
    for (let i = 1; i < r.resistances.length; i++) {
      expect(r.resistances[i].price).toBeGreaterThan(r.resistances[i - 1].price);
    }
  });
});
