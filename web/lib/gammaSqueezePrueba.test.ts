import { describe, expect, it } from "vitest";
import { intrinsic, pnlPerDollar, squeezeCandidates, straddleSigma, summarizeSqueeze, type Contract, type SqTick } from "./gammaSqueezePrueba";

const OPEN = 0;
const m = (min: number) => OPEN + min * 60;

describe("gammaSqueezePrueba", () => {
  it("intrínseco y resultado por $1", () => {
    expect(intrinsic("call", 7010, 7025)).toBe(15);
    expect(intrinsic("put", 7010, 7025)).toBe(0);
    expect(pnlPerDollar(0.5, 3, 0, 5)).toBe(4); // llegó a 6× → vende en 5×
    expect(pnlPerDollar(0.5, 1, 0, 5)).toBe(-1); // no llegó y venció sin valor
    expect(pnlPerDollar(0.5, 2, 1.5, 5)).toBe(2); // no llegó a 5×, vence con $1.50
  });

  it("straddle ATM real → σ", () => {
    const flat = (p: number) => [{ time: m(329), open: p, high: p, low: p, close: p }];
    const cs: Contract[] = [{ type: "call", strike: 7000, bars: flat(4) }, { type: "put", strike: 7000, bars: flat(4) }];
    expect(straddleSigma(cs, 7001, m(330))).toBeCloseTo(10);
  });

  it("call barato que explota: entrada después de la lectura, máximo y condiciones", () => {
    // SPX sube de 7,000 (15:00) a 7,020 (16:00).
    const spx = Array.from({ length: 390 }, (_, i) => {
      const p = i < 330 ? 7000 - (330 - i) * 0.0 : 7000 + (i - 330) / 3;
      return { time: m(i), high: p + 0.1, low: p - 0.1, close: p };
    });
    const ticks: SqTick[] = [{ time: m(325), spot: { spx: 7000 }, netGex: -1e9, rows: [{ spx: 7005, netGex: -5e7 }, { spx: 7010, netGex: -1e7 }] }];
    const call: Contract = {
      type: "call", strike: 7010,
      bars: [
        { time: m(300), open: 0.3, high: 0.3, low: 0.3, close: 0.3, volume: 10, askVolume: 5, bidVolume: 5 },
        { time: m(328), open: 0.4, high: 0.4, low: 0.4, close: 0.4, volume: 200, askVolume: 180, bidVolume: 20 },
        { time: m(330), open: 0.45, high: 0.6, low: 0.45, close: 0.55, volume: 50 },
        { time: m(385), open: 6, high: 9, low: 6, close: 8, volume: 30 },
      ],
    };
    const cands = squeezeCandidates("d", OPEN, ticks, spx, [call], { ...summaryTune, readings: [330] });
    expect(cands).toHaveLength(1);
    const c = cands[0];
    expect(c.entry).toBeCloseTo(0.5); // apertura 0.45 + 0.05
    expect(c.maxMult).toBeCloseTo(18);
    expect(c.expiryValue).toBeCloseTo(10 - 0.3333, 1);
    expect(c.pnlPerDollar).toBe(4);
    expect(c.cond.gex_neg).toBe(true);
    expect(c.cond.camino_neg).toBe(true);
    expect(c.cond.compran).toBe(true);
    expect(c.cond.volumen).toBe(true);
    const s = summarizeSqueeze(cands);
    expect(s.base.hit[10]).toBe(1);
  });
});

import { SQUEEZE_TUNING } from "./gammaSqueezePrueba";
const summaryTune = SQUEEZE_TUNING;

import { paperSqueezeDay, type SqCandidate } from "./gammaSqueezePrueba";

describe("gammaSqueezePrueba · en papel", () => {
  const base = (o: Partial<SqCandidate>): SqCandidate => ({
    date: "d", readMin: 330, type: "call", strike: 7010, spot: 7000, dist: 10, sigma: 10, lastPrice: 0.6, entry: 0.65, entryT: 0,
    maxPrice: 1.5, maxMult: 1.5 / 0.65, maxT: 0, expiryValue: 0, pnlPerDollar: 0, cond: {} as SqCandidate["cond"], score: 4, ...o,
  });
  it("primera señal por día y lado, vende en 3× o vence", () => {
    const tr = paperSqueezeDay([
      base({ readMin: 340, maxPrice: 3, maxMult: 3 / 0.65 }),
      base({ readMin: 335 }), // la primera del lado call → esta
      base({ type: "put", strike: 6990, readMin: 345, score: 3 }), // no llega a 4 condiciones
      base({ type: "put", strike: 6985, readMin: 350, maxPrice: 2.5, maxMult: 2.5 / 0.65, dist: 15 }),
    ]).filter((t) => t.rule === "v1");
    expect(tr).toHaveLength(2);
    expect(tr[0]).toMatchObject({ type: "call", readMin: 335, salida: "vencimiento" });
    expect(tr[0].pnlUsd).toBeCloseTo(-65);
    expect(tr[1].type).toBe("put");
    expect(tr[1].salida).toBe("vendido");
    expect(tr[1].pnlUsd).toBeCloseTo(130);
  });
});
