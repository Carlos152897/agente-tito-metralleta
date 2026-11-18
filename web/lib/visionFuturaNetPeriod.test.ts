import { describe, expect, it } from "vitest";
import { fieldsOf, gridNetBars, netBars, pickBase, snapOf, tierBars, type NetSourceRow } from "./visionFuturaNetPeriod";

const row = (spx: number, callAsk: number, callBid: number, putAsk: number, putBid: number, vol = 1000): NetSourceRow => ({
  spx, callFlow: callAsk - callBid, putFlow: putAsk - putBid, callAsk, callBid, putAsk, putBid, callVolume: vol, putVolume: 0,
});

describe("posicionamiento neto por periodo", () => {
  it("neto = calls compradas + puts vendidas − calls vendidas − puts compradas (ejemplo del prompt)", () => {
    const [b] = netBars([row(7500, 1200, 300, 400, 900)], null, "dia");
    expect(b.net).toBe(1400);
  });

  it("fuerte ≥ 10%, tenue ≥ 1%, menos no sale", () => {
    const bars = netBars([row(7500, 10_000, 0, 0, 0), row(7505, 1400, 0, 0, 0), row(7510, 0, 0, 500, 0), row(7515, 50, 0, 0, 0)], null, "dia");
    const t = tierBars(bars);
    expect(t.map((x) => [x.bar.strike, x.tier])).toEqual([[7500, "fuerte"], [7505, "fuerte"], [7510, "tenue"]]);
    expect(t[1].frac).toBeCloseTo(0.14);
  });

  it("periodo: resta la foto de hace N min por campo, sin bajar de 0", () => {
    const old = snapOf([row(7500, 1000, 500, 200, 100, 1000)], 0);
    const [b] = netBars([row(7500, 1500, 400, 300, 100, 1500)], old.rows, 15);
    expect([b.callsBought, b.callsSold, b.putsBought, b.putsSold, b.contracts]).toEqual([500, 0, 100, 0, 500]);
    expect(b.net).toBe(400);
  });

  it("5 min: menos de 300 contratos nuevos no se dibuja", () => {
    const old = snapOf([row(7500, 0, 0, 0, 0, 1000)], 0);
    expect(netBars([row(7500, 9000, 0, 0, 0, 1200)], old.rows, 5)).toEqual([]);
    expect(netBars([row(7500, 9000, 0, 0, 0, 1300)], old.rows, 5)).toHaveLength(1);
  });

  it("pickBase: la foto ≤ ahora − N; si no hay, la más vieja marcada", () => {
    const snaps = [snapOf([], 0), snapOf([], 10 * 60_000), snapOf([], 20 * 60_000)];
    expect(pickBase(snaps, 26 * 60_000, 15)).toEqual({ snap: snaps[1], stale: false });
    expect(pickBase(snaps, 26 * 60_000, 30)).toEqual({ snap: snaps[0], stale: true });
    expect(pickBase(snaps, 26 * 60_000, "dia")).toBeNull();
  });

  it("filas viejas sin ask/bid por tipo usan el neto de cada tipo; la cuadrícula suma", () => {
    expect(fieldsOf({ spx: 1, callFlow: -300, putFlow: 200 })).toEqual({ callAsk: 0, callBid: 300, putAsk: 200, putBid: 0, vol: 0 });
    const g = gridNetBars(netBars([row(100, 10, 0, 0, 0), row(105, 5, 0, 0, 0)], null, "dia"), (s) => Math.floor(s / 10) * 10);
    expect(g).toHaveLength(1);
    expect(g[0].net).toBe(15);
  });
});
