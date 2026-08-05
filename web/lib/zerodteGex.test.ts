import { describe, expect, it } from "vitest";
import { bsCharm, bsVanna, chainIV, MAX_SANE_IV } from "./zerodteGex";
import type { ZRow } from "./zerodteTypes";

function row(strike: number, iv: number | null, oi = 1000): ZRow {
  return {
    optionTicker: `SPXW${strike}`, contractType: "call", expiration: "2026-07-31",
    strike, openInterest: oi, volume: 0, bid: null, ask: null,
    greeks: { delta: null, gamma: null, theta: null, vega: null, iv },
  };
}

describe("bsVanna / bsCharm", () => {
  const S = 7450, T = 4 / (24 * 365), iv = 0.25;

  it("devuelven 0 con insumos inválidos", () => {
    for (const f of [bsVanna, bsCharm]) {
      expect(f(0, 7450, T, iv)).toBe(0);
      expect(f(S, 7450, 0, iv)).toBe(0);
      expect(f(S, 7450, T, 0)).toBe(0);
    }
  });

  it("charm cerca del dinero se dispara al acercarse el cierre", () => {
    const lejos = Math.abs(bsCharm(S, S, T, iv));
    const cerca = Math.abs(bsCharm(S, S, T / 8, iv));
    expect(cerca).toBeGreaterThan(lejos * 2);
  });
});

describe("chainIV", () => {
  it("devuelve null sin IV real o spot inválido", () => {
    expect(chainIV([row(7450, null)], 7450)).toBeNull();
    expect(chainIV([row(7450, 0.2)], 0)).toBeNull();
  });

  it("pondera por Open Interest", () => {
    const iv = chainIV([row(7450, 0.2, 9000), row(7455, 0.4, 1000)], 7450);
    expect(iv).toBeCloseTo(0.22, 5);
  });

  it("ignora strikes lejanos y IV absurdas", () => {
    const iv = chainIV(
      [row(7450, 0.25, 1000), row(9000, 2.5, 999999), row(7451, MAX_SANE_IV + 1, 1000)],
      7450,
    );
    expect(iv).toBeCloseTo(0.25, 5);
  });
});
