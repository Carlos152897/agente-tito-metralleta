import { describe, expect, it } from "vitest";
import { buildSpreads, type SpreadQuoteRow } from "./visionFuturaSpreads";
import type { DealerLevel, KeyLevel } from "./visionFutura";

const lv = (spx: number) => ({ spx, spy: spx / 10, es: null });
const key = (kind: KeyLevel["kind"], label: string, spx: number): KeyLevel => ({ kind, label, fuente: "", distance: 0, ...lv(spx) });
const q = (type: "call" | "put", strike: number, bid: number, ask: number, delta: number): SpreadQuoteRow =>
  ({ type, strike, bid, ask, delta, iv: 0.15, openInterest: 100, volume: 100 });

const base = {
  spot: 7700,
  days: 0.25,
  keyLevels: [key("resistencia", "Resistencia (Call Wall)", 7720), key("piso", "Piso (Put Wall)", 7680), key("magneto", "Magneto", 7715)],
  dealerLevels: [] as DealerLevel[],
  expectedMove: { points: 40, low: lv(7660), high: lv(7740) },
  fallbackIv: 0.18,
};

describe("buildSpreads", () => {
  it("call credit: vende al bid, compra al ask, arriba de la Call Wall", () => {
    const rows = [q("call", 7710, 4.0, 4.3, 0.3), q("call", 7730, 1.2, 1.4, 0.12), q("call", 7735, 0.8, 1.0, 0.09)];
    const r = buildSpreads({ ...base, rows });
    const s = r.callCredit[0];
    expect(s.id).toBe("call_credit:7730:5");
    expect(s.legs[0]).toMatchObject({ action: "VENDER", type: "call", strike: 7730, price: 1.2, side: "bid" });
    expect(s.legs[1]).toMatchObject({ action: "COMPRAR", type: "call", strike: 7735, price: 1.0, side: "ask" });
    expect(s.netPrice).toBe(0.2);
    expect(s.maxGainUsd).toBe(20);
    expect(s.maxLossUsd).toBe(480);
    expect(s.breakevens).toEqual([7730.2]);
    expect(s.levels).toEqual(["Magneto 7,715", "Resistencia (Call Wall) 7,720"]);
    expect(s.pop).toBeGreaterThanOrEqual(0.8);
    expect(r.callCredit.some((x) => x.legs[0].strike === 7710)).toBe(false); // delta 0.30 y sin protección
  });

  it("put credit: debajo del piso, probabilidad en el breakeven", () => {
    const rows = [q("put", 7670, 1.1, 1.3, -0.11), q("put", 7665, 0.7, 0.85, -0.08)];
    const s = buildSpreads({ ...base, rows }).putCredit[0];
    expect(s.legs[0]).toMatchObject({ action: "VENDER", type: "put", strike: 7670, price: 1.1 });
    expect(s.legs[1]).toMatchObject({ action: "COMPRAR", type: "put", strike: 7665, price: 0.85 });
    expect(s.netPrice).toBe(0.25);
    expect(s.breakevens).toEqual([7669.75]);
  });

  it("call debit: vende en el objetivo (Magneto) y respeta la pérdida máxima de $200", () => {
    const rows = [
      q("call", 7700, 9.0, 9.5, 0.5), // ATM: 7700/7715 costaría $6.50 → fuera del tope
      q("call", 7710, 4.6, 4.8, 0.35),
      q("call", 7715, 3.0, 3.3, 0.25),
      q("call", 7720, 2.0, 2.2, 0.2),
    ];
    const r = buildSpreads({ ...base, rows });
    expect(r.bias).toBe("alcista");
    expect(r.callDebit.every((x) => x.maxLossUsd <= 200)).toBe(true);
    expect(r.callDebit.some((x) => x.legs[0].strike === 7700)).toBe(false);
    const s = r.callDebit.find((x) => x.id === "call_debit:7710:7715")!;
    expect(s.legs[0]).toMatchObject({ action: "COMPRAR", strike: 7710, price: 4.8, side: "ask" });
    expect(s.legs[1]).toMatchObject({ action: "VENDER", strike: 7715, price: 3.0, side: "bid" });
    expect(s.netPrice).toBe(-1.8);
    expect(s.maxLossUsd).toBe(180);
    expect(s.maxGainUsd).toBe(320);
    expect(s.breakevens).toEqual([7711.8]);
    expect(s.withBias).toBe(true);
    expect(s.levels[0]).toBe("Objetivo: Magneto 7,715");
  });

  it("iron condor junta el mejor de cada lado del mismo ancho", () => {
    const rows = [
      q("call", 7730, 1.2, 1.4, 0.12), q("call", 7735, 0.8, 1.0, 0.09),
      q("put", 7670, 1.1, 1.3, -0.11), q("put", 7665, 0.7, 0.85, -0.08),
    ];
    const ic = buildSpreads({ ...base, rows }).ironCondor!;
    expect(ic.legs).toHaveLength(4);
    expect(ic.netPrice).toBe(0.45);
    expect(ic.breakevens).toEqual([7669.55, 7730.45]);
    expect(ic.pop).toBeGreaterThan(0.6);
  });

  it("sin nivel que proteja ese lado → no sugiere crédito de ese lado", () => {
    const r = buildSpreads({ ...base, keyLevels: [], rows: [q("call", 7730, 1.2, 1.4, 0.12), q("call", 7735, 0.8, 1.0, 0.09)] });
    expect(r.callCredit).toHaveLength(0);
    expect(r.note).toMatch(/Ningún spread/);
  });
});

describe("spreadPnlAtExpiry", () => {
  const legs = (a: "VENDER" | "COMPRAR", t: "call" | "put", k: number) => ({ action: a, type: t, strike: k, price: 0, side: "bid" as const });
  it("call credit: gana el crédito completo si cierra abajo; pierde si cierra entre strikes", async () => {
    const { spreadPnlAtExpiry } = await import("./visionFuturaSpreads");
    const s = { netPrice: 0.5, legs: [legs("VENDER", "call", 7735), legs("COMPRAR", "call", 7740)] };
    expect(spreadPnlAtExpiry(s, 7700)).toBe(0.5);
    expect(spreadPnlAtExpiry(s, 7738)).toBe(-2.5);
    expect(spreadPnlAtExpiry(s, 7800)).toBe(-4.5);
  });
  it("call debit: pierde el costo si cierra abajo; gana el ancho − costo arriba", async () => {
    const { spreadPnlAtExpiry } = await import("./visionFuturaSpreads");
    const s = { netPrice: -15.6, legs: [legs("COMPRAR", "call", 7665), legs("VENDER", "call", 7700)] };
    expect(spreadPnlAtExpiry(s, 7650)).toBe(-15.6);
    expect(spreadPnlAtExpiry(s, 7710)).toBe(19.4);
  });
});
