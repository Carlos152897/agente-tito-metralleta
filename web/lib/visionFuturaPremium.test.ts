import { describe, expect, it } from "vitest";
import { premiumNewMoney, premiumSeries } from "./visionFuturaPremium";

const t0 = Date.parse("2026-10-28T13:30:00Z");
const pt = (min: number, call: number, put: number) => ({ t: new Date(t0 + min * 60_000).toISOString(), net_call_premium: call, net_put_premium: put, net_volume: 0 });

describe("prima neta por minuto", () => {
  const s = premiumSeries([pt(1, 1e6, 0), pt(0, 0, 0), pt(15, 1.6e6, -0.2e6), pt(16, 1.7e6, -0.3e6)]);
  it("ordena la serie", () => {
    expect(s.map((p) => p.call)).toEqual([0, 1e6, 1.6e6, 1.7e6]);
  });
  it("dinero nuevo 15 min: calls suben y puts bajan → arriba", () => {
    const r = premiumNewMoney(s, t0 + 15 * 60_000)!;
    expect(r.dCall).toBeCloseTo(1.6e6);
    expect(r.dPut).toBeCloseTo(-0.2e6);
    expect(r.net).toBeCloseTo(1.8e6);
    expect(r.vote).toBe(1);
  });
  it("poco dinero o lados parejos → sin voto", () => {
    const small = premiumSeries([pt(0, 0, 0), pt(15, 0.2e6, 0)]);
    expect(premiumNewMoney(small, t0 + 15 * 60_000)!.vote).toBe(0);
    const even = premiumSeries([pt(0, 0, 0), pt(15, 1e6, 1e6)]);
    expect(premiumNewMoney(even, t0 + 15 * 60_000)!.vote).toBe(0);
  });
  it("sin dato de hace 15 min o dato viejo → null", () => {
    expect(premiumNewMoney(s, t0 + 5 * 60_000)).toBeNull();
    expect(premiumNewMoney(s, t0 + 40 * 60_000)).toBeNull();
  });
});
