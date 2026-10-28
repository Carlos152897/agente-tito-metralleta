import { describe, expect, it } from "vitest";
import { alertSingleLeg, withSingleLeg } from "./visionFuturaLegs";
import type { VisionStrikeRow } from "./visionFutura";

const row = (spx: number, callFlow: number, putFlow: number) => ({ spx, callFlow, putFlow } as VisionStrikeRow);
const pr = (strike: number, cs: number, cm: number, ps: number, pm: number) => ({ strike, call: { single_leg: cs, multi_leg: cm }, put: { single_leg: ps, multi_leg: pm } });

describe("una pata vs spreads", () => {
  const spot = 7734;
  const rows = withSingleLeg(
    [row(7740, -2e6, 0), row(7745, -2e6, 0), row(7725, 0, -3e6), row(7700, 0, 1e6)],
    [pr(7740, 8e6, 2e6, 1, 1), pr(7745, 3e6, 7e6, 1, 1), pr(7725, 1, 1, 9e6, 1e6)],
    spot,
  );
  it("% de una pata y flujo estimado", () => {
    expect(rows[0].legs).toMatchObject({ callShare: 0.8, callFlow1: -1.6e6, dealerRole1: "resistencia" });
    expect(rows[2].legs).toMatchObject({ putShare: 0.9, dealerRole1: "piso" });
  });
  it("mayormente spreads → sin rol de dealers", () => {
    expect(rows[1].legs?.callShare).toBeCloseTo(0.3);
    expect(rows[1].legs?.dealerRole1).toBeNull();
  });
  it("strike sin datos de MarketSnack queda igual", () => {
    expect(rows[3].legs).toBeUndefined();
  });
  it("alerta: techo mira calls, piso mira puts; firme solo si ≥ 50% una pata", () => {
    expect(alertSingleLeg("rechazo_techo", rows[0], true)).toMatchObject({ side: "call", firm: true });
    expect(alertSingleLeg("rechazo_techo", rows[1], true)).toMatchObject({ side: "call", firm: false });
    expect(alertSingleLeg("rechazo_techo", rows[1], true)?.text).toContain("spreads");
    expect(alertSingleLeg("defensa_piso", rows[2], false)).toMatchObject({ side: "put", firm: false });
    expect(alertSingleLeg("defensa_piso", rows[3], true)).toBeNull();
  });
});
