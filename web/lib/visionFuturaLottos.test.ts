import { describe, expect, it } from "vitest";
import { evaluateLottos, lecturaAt, lottoPnlAtExpiry, lottoTradeFrom, minutesToClose, type LottoInput } from "./visionFuturaLottos";
import type { KeyLevel } from "./visionFutura";

const T1530 = Date.parse("2026-10-23T15:30:00-04:00");
const lv = (kind: KeyLevel["kind"], spx: number, label: string = kind): KeyLevel => ({ kind, label, fuente: "", distance: 0, spx, spy: null, es: null });

const base = (over: Partial<LottoInput> = {}): LottoInput => ({
  now: T1530, spot: 7625, keyLevels: [lv("magneto", 7642, "Magneto")], regime: "negativo", vix: 20,
  priceAgo15: 7618, flowChange15: 600_000,
  quotes: [
    // straddle ATM 7625 = 5.1 + 4.9 = $10 → σ 12.5 → alcance ±18.75
    { type: "call", strike: 7625, bid: 5.0, ask: 5.2 },
    { type: "put", strike: 7625, bid: 4.8, ask: 5.0 },
    { type: "call", strike: 7630, bid: 1.9, ask: 2.0 },
    { type: "call", strike: 7635, bid: 0.75, ask: 0.8 },
    { type: "call", strike: 7640, bid: 0.35, ask: 0.4 },
    { type: "call", strike: 7645, bid: 0.1, ask: 0.15 }, // después del objetivo: no cuenta
    { type: "put", strike: 7600, bid: 0.3, ask: 0.35 },
  ],
  ...over,
});

describe("evaluateLottos", () => {
  it("call hacia el Magneto: elige el strike que más paga si llega (7635 a $0.80 → 8.8×)", () => {
    const [best] = evaluateLottos(base());
    expect(best).toMatchObject({ side: "call", strike: 7635, price: 0.8, fires: true, score: 3 });
    expect(best.payoff).toBe(8.8);
    expect(best.reach).toBe(18.75);
  });

  it("straddle chico (poco movimiento esperado) → objetivo fuera de alcance", () => {
    const q = base().quotes.map((x) => (x.strike === 7625 ? { ...x, bid: 1.0, ask: 1.1 } : x));
    const [best] = evaluateLottos(base({ quotes: q }));
    expect(best.fires).toBe(false);
    expect(best.blocked).toBe("objetivo fuera de alcance");
  });

  it("pide 2 de 3 confirmaciones", () => {
    const [best] = evaluateLottos(base({ regime: "positivo", flowChange15: -1e6 }));
    expect(best.score).toBe(1);
    expect(best.fires).toBe(false);
  });

  it("put si el objetivo está abajo; ignora strikes después del objetivo y primas fuera de rango", () => {
    const ideas = evaluateLottos(base({ keyLevels: [lv("iman_negativo", 7610)], priceAgo15: 7632, flowChange15: -500_000,
      quotes: [base().quotes[0], base().quotes[1], { type: "put", strike: 7615, bid: 0.5, ask: 0.55 }, { type: "put", strike: 7605, bid: 0.1, ask: 0.12 }, { type: "put", strike: 7620, bid: 1.2, ask: 1.3 }] }));
    expect(ideas[0]).toMatchObject({ side: "put", strike: 7615, fires: true });
  });
});

describe("utilidades", () => {
  it("minutos al cierre, lectura y resultado", () => {
    expect(minutesToClose(T1530)).toBe(30);
    expect(lecturaAt(T1530 + 2 * 60_000)).toBe("15:30");
    expect(lecturaAt(T1530 + 6 * 60_000)).toBeNull();
    expect(lottoPnlAtExpiry({ side: "call", strike: 7640, price: 0.4 }, 7652)).toBe(1160);
    expect(lottoPnlAtExpiry({ side: "put", strike: 7615, price: 0.55 }, 7630)).toBe(-55);
    const tr = lottoTradeFrom(evaluateLottos(base())[0], T1530, 7625);
    expect(tr).toMatchObject({ lectura: "15:30", side: "call", strike: 7635 });
  });
});

import { lottoExitsFrom, lottoExitsFromBest, lottoPnlWithExits, settleLottoWithRule, type LottoTrade } from "./visionFuturaLottos";

describe("regla de salida del lotto (mitad a 1.5×, mitad a 3×)", () => {
  const base = { id: "x", openedAt: 1000, lectura: "15:15", side: "call", strike: 7735, price: 0.73, priceReal: true, target: { label: "R", spx: 7740 }, spotAtOpen: 7727, payoff: 6.8, conditions: [], bestExit: { price: 2.55, at: 5000 }, settle: 7722.6, pnlUsd: null } as LottoTrade;

  it("vende cada tramo la primera vez que el bid llega a su múltiplo", () => {
    const ex = lottoExitsFrom(base, [{ at: 900, bid: 5 }, { at: 2000, bid: 1.0 }, { at: 3000, bid: 1.2 }, { at: 4000, bid: 2.3 }]);
    expect(ex).toEqual([{ mult: 1.5, frac: 0.5, price: 1.1, at: 3000 }, { mult: 3, frac: 0.5, price: 2.19, at: 4000 }]);
  });

  it("27-oct 15:15: llegó a 3.5× → +$91 por contrato en vez de −$73", () => {
    const t = settleLottoWithRule(base);
    expect(t.holdPnlUsd).toBe(-73);
    expect(t.pnlUsd).toBe(92); // 0.5×1.10 + 0.5×2.19 − 0.73 = 0.915
  });

  it("si solo llegó a 1.5×, la otra mitad vence", () => {
    const t = settleLottoWithRule({ ...base, strike: 7675, side: "put", price: 0.95, bestExit: { price: 1.45, at: 5000 }, settle: 7676.77 });
    expect(t.exits).toHaveLength(1);
    expect(t.pnlUsd).toBe(-24); // 0.5×1.43 − 0.95 = −0.235
  });

  it("sin vender todo y sin cierre todavía no hay resultado", () => {
    expect(lottoPnlWithExits(base, lottoExitsFromBest({ ...base, bestExit: { price: 1.2, at: 1 } }), null)).toBeNull();
    expect(lottoPnlWithExits(base, lottoExitsFromBest(base), null)).toBe(92);
  });
});
