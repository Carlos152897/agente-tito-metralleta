import { describe, expect, it } from "vitest";
import { buildScales, packLabels, smartDomain } from "./chartGeometry";
import type { TfBar } from "./types";

/** Barras planas alrededor de `base`, útiles para aislar la variable bajo prueba. */
function flatBars(n: number, base = 100, spread = 2): TfBar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 86_400,
    open: base,
    high: base + spread,
    low: base - spread,
    close: base,
  }));
}

const PAD = { top: 16, right: 132, bottom: 28, left: 8 };

describe("smartDomain", () => {
  it("cubre el rango de las velas", () => {
    const d = smartDomain({ bars: flatBars(30, 100, 5), spot: 100 });
    expect(d.min).toBeLessThanOrEqual(95);
    expect(d.max).toBeGreaterThanOrEqual(105);
  });

  it("estira el dominio para incluir un target lejano con peso real", () => {
    const d = smartDomain({
      bars: flatBars(30, 100, 2),
      spot: 100,
      targets: [{ price: 130, weight: 0.4 }],
    });
    expect(d.max).toBeGreaterThanOrEqual(130);
  });

  it("ignora un target sin peso para no deformar el encuadre", () => {
    const d = smartDomain({
      bars: flatBars(30, 100, 2),
      spot: 100,
      targets: [{ price: 300, weight: 0.001 }],
    });
    expect(d.max).toBeLessThan(200);
  });

  it("recorta el 2 sigma cuando aplastaria las velas por debajo del 45% del alto", () => {
    const d = smartDomain({
      bars: flatBars(30, 100, 1), // rango de velas: 2 puntos
      spot: 100,
      sigma1: { lower: 98, upper: 102 },
      sigma2: { lower: 40, upper: 160 }, // rango absurdo: 120 puntos
    });
    expect(d.clampedTo2Sigma).toBe(true);
    const candleShare = (102 - 98) / (d.max - d.min);
    expect(candleShare).toBeGreaterThanOrEqual(0.4);
  });

  it("incluye el 2 sigma completo cuando si cabe", () => {
    const d = smartDomain({
      bars: flatBars(30, 100, 10),
      spot: 100,
      sigma1: { lower: 95, upper: 105 },
      sigma2: { lower: 90, upper: 110 },
    });
    expect(d.clampedTo2Sigma).toBe(false);
    expect(d.min).toBeLessThanOrEqual(90);
    expect(d.max).toBeGreaterThanOrEqual(110);
  });

  it("no devuelve un dominio degenerado sin barras", () => {
    const d = smartDomain({ bars: [], spot: 100 });
    expect(d.max).toBeGreaterThan(d.min);
  });
});

describe("buildScales", () => {
  const base = {
    bars: flatBars(40, 100, 2),
    domain: { min: 90, max: 110, clampedTo2Sigma: false },
    horizonDays: 20,
    width: 1000,
    height: 400,
    padding: PAD,
  };

  it("reparte el ancho util 60/40 entre historico y futuro", () => {
    const s = buildScales({ ...base, futureRatio: 0.4 });
    const usable = s.plotRight - s.plotLeft;
    expect(s.xNow - s.plotLeft).toBeCloseTo(usable * 0.6, 5);
    expect(s.plotRight - s.xNow).toBeCloseTo(usable * 0.4, 5);
  });

  it("reserva el gutter derecho para los chips y el eje", () => {
    const s = buildScales({ ...base, futureRatio: 0.4 });
    expect(s.plotRight).toBe(base.width - PAD.right);
  });

  it("mapea el futuro de 0 dias en xNow hasta el horizonte en plotRight", () => {
    const s = buildScales({ ...base, futureRatio: 0.4 });
    expect(s.xOfFuture(0)).toBeCloseTo(s.xNow, 5);
    expect(s.xOfFuture(20)).toBeCloseTo(s.plotRight, 5);
  });

  it("mapea el dominio de precio a todo el alto util, invertido", () => {
    const s = buildScales({ ...base, futureRatio: 0.4 });
    expect(s.yOfPrice(110)).toBeCloseTo(s.plotTop, 5);
    expect(s.yOfPrice(90)).toBeCloseTo(s.plotBottom, 5);
    expect(s.yOfPrice(110)).toBeLessThan(s.yOfPrice(90));
  });

  it("deja la ultima vela justo antes de xNow", () => {
    const s = buildScales({ ...base, futureRatio: 0.4 });
    const last = s.candles[s.candles.length - 1];
    expect(last.x).toBeLessThanOrEqual(s.xNow);
    expect(last.x + last.w).toBeLessThanOrEqual(s.xNow + 1);
  });

  it("recorta el historico conservando las velas mas recientes cuando no caben", () => {
    const many = flatBars(2000, 100, 2);
    const s = buildScales({ ...base, bars: many, futureRatio: 0.4 });
    expect(s.candles.length).toBeLessThan(2000);
    expect(s.visibleBars[s.visibleBars.length - 1].time).toBe(many[many.length - 1].time);
    for (const c of s.candles) expect(c.w).toBeGreaterThanOrEqual(3);
  });

  it("marca las velas alcistas y bajistas", () => {
    const bars: TfBar[] = [
      { time: 1, open: 100, high: 105, low: 99, close: 104 },
      { time: 2, open: 104, high: 106, low: 98, close: 99 },
    ];
    const s = buildScales({ ...base, bars, futureRatio: 0.4 });
    expect(s.candles[0].up).toBe(true);
    expect(s.candles[1].up).toBe(false);
  });

  it("el cuerpo de la vela nunca tiene alto cero", () => {
    const doji: TfBar[] = [{ time: 1, open: 100, high: 100, low: 100, close: 100 }];
    const s = buildScales({ ...base, bars: doji, futureRatio: 0.4 });
    expect(s.candles[0].yClose - s.candles[0].yOpen).not.toBe(0);
  });
});

describe("packLabels", () => {
  const opts = { top: 0, bottom: 400, labelH: 26, gap: 4 };

  it("separa dos chips que caen en el mismo precio", () => {
    const out = packLabels([{ y: 200 }, { y: 200 }], opts);
    expect(Math.abs(out[0].y - out[1].y)).toBeGreaterThanOrEqual(opts.labelH + opts.gap);
  });

  it("conserva el ancla en el precio real aunque el chip se mueva", () => {
    const out = packLabels([{ y: 200 }, { y: 202 }], opts);
    expect(out[0].yAnchor).toBe(200);
    expect(out[1].yAnchor).toBe(202);
    expect(out.some((l) => l.y !== l.yAnchor)).toBe(true);
  });

  it("no deja ningun chip fuera del area de dibujo", () => {
    const crowded = Array.from({ length: 10 }, () => ({ y: 390 }));
    const out = packLabels(crowded, opts);
    for (const l of out) {
      expect(l.y - opts.labelH / 2).toBeGreaterThanOrEqual(opts.top - 0.001);
      expect(l.y + opts.labelH / 2).toBeLessThanOrEqual(opts.bottom + 0.001);
    }
  });

  it("nunca solapa chips, ni con 10 apinados", () => {
    const crowded = Array.from({ length: 10 }, (_, i) => ({ y: 200 + i }));
    const out = packLabels(crowded, opts).sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].y - out[i - 1].y).toBeGreaterThanOrEqual(opts.labelH + opts.gap - 0.001);
    }
  });

  it("deja quieto un chip que no colisiona con nadie", () => {
    const out = packLabels([{ y: 100 }, { y: 300 }], opts);
    expect(out[0].y).toBe(100);
    expect(out[1].y).toBe(300);
  });

  it("conserva los datos originales de cada item", () => {
    const out = packLabels([{ y: 200, price: 312.5, label: "muro" }], opts);
    expect(out[0].price).toBe(312.5);
    expect(out[0].label).toBe("muro");
  });

  it("devuelve los items en el orden de entrada", () => {
    const out = packLabels([{ y: 300, id: "a" }, { y: 100, id: "b" }], opts);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
