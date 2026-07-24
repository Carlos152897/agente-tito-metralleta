import { describe, expect, it } from "vitest";
import {
  HAIRCUT,
  MIN_OI,
  WHEEL_PRESETS,
  liquidityBlock,
  pickPremium,
  spreadPctOf,
  wheelMetrics,
} from "./wheel";

describe("WHEEL_PRESETS", () => {
  it("los tres presets van de menos a más delta", () => {
    expect(WHEEL_PRESETS.conservador.deltaMax).toBeLessThanOrEqual(WHEEL_PRESETS.balanceado.deltaMin);
    expect(WHEEL_PRESETS.balanceado.deltaMax).toBeLessThanOrEqual(WHEEL_PRESETS.agresivo.deltaMin);
  });

  it("todos cierran al 50% de la prima", () => {
    for (const p of Object.values(WHEEL_PRESETS)) expect(p.takeProfitPct).toBe(50);
  });
});

describe("pickPremium", () => {
  it("prefiere el bid real y no le aplica recorte", () => {
    const pick = pickPremium({ bid: 0.32, ask: 0.36, lastTrade: 0.5, model: 0.6 });
    expect(pick).toEqual({ price: 0.32, source: "bid", raw: 0.32 });
  });

  it("cae al último precio con recorte del 10% cuando no hay bid", () => {
    const pick = pickPremium({ bid: 0, ask: 0.36, lastTrade: 0.5, model: 0.6 });
    expect(pick?.source).toBe("ultimo");
    expect(pick?.price).toBeCloseTo(0.5 * (1 - HAIRCUT.ultimo), 10);
    expect(pick?.raw).toBe(0.5);
  });

  it("cae al modelo con recorte del 15% cuando no hay bid ni último", () => {
    const pick = pickPremium({ model: 0.6 });
    expect(pick?.source).toBe("modelo");
    expect(pick?.price).toBeCloseTo(0.6 * (1 - HAIRCUT.modelo), 10);
  });

  it("devuelve null si no hay ninguna fuente", () => {
    expect(pickPremium({})).toBeNull();
    expect(pickPremium({ bid: 0, lastTrade: 0, model: 0 })).toBeNull();
  });
});

describe("spreadPctOf", () => {
  it("mide el spread contra el mid", () => {
    expect(spreadPctOf(0.9, 1.1)).toBeCloseTo(20, 10);
  });

  it("devuelve null si falta un lado", () => {
    expect(spreadPctOf(0, 1.1)).toBeNull();
  });
});

describe("liquidityBlock — la salvaguarda del proyecto", () => {
  it("bloquea si no hay bid", () => {
    expect(liquidityBlock({ bid: 0, ask: 1.1, openInterest: 900 })).toBe("sin_bid");
  });

  it("bloquea si el spread pasa del 25%", () => {
    expect(liquidityBlock({ bid: 0.5, ask: 0.9, openInterest: 900 })).toBe("spread_ancho");
  });

  it("bloquea si el OI es menor a 100", () => {
    expect(liquidityBlock({ bid: 1, ask: 1.05, openInterest: MIN_OI - 1 })).toBe("oi_bajo");
  });

  it("deja pasar un contrato líquido", () => {
    expect(liquidityBlock({ bid: 1, ask: 1.05, openInterest: 900 })).toBeNull();
  });
});

describe("wheelMetrics", () => {
  it("calcula crédito, colateral, retorno, anualizado y breakeven", () => {
    // Put de F a $11, prima $0.32, spot $11.60, 21 días.
    const m = wheelMetrics({ strike: 11, price: 0.32, spot: 11.6, dte: 21, iv: 0.45 });
    expect(m.credit).toBeCloseTo(32, 10);
    expect(m.collateral).toBeCloseTo(1100, 10);
    expect(m.returnPct).toBeCloseTo((32 / 1100) * 100, 10);
    expect(m.annualizedPct).toBeCloseTo((32 / 1100) * 100 * (365 / 21), 10);
    expect(m.breakeven).toBeCloseTo(10.68, 10);
  });

  it("el colchón se mide desde el breakeven, no desde el strike", () => {
    const m = wheelMetrics({ strike: 11, price: 0.32, spot: 11.6, dte: 21, iv: 0.45 });
    expect(m.cushionPct).toBeCloseTo(((11.6 - 10.68) / 11.6) * 100, 10);
  });

  it("la probabilidad de expirar sin valor sale de probAbove y va en 0-100", () => {
    const m = wheelMetrics({ strike: 11, price: 0.32, spot: 11.6, dte: 21, iv: 0.45 });
    expect(m.probExpireWorthless).toBeGreaterThan(50);
    expect(m.probExpireWorthless).toBeLessThanOrEqual(100);
  });

  it("un DTE de 0 no revienta el anualizado", () => {
    const m = wheelMetrics({ strike: 11, price: 0.32, spot: 11.6, dte: 0, iv: 0.45 });
    expect(Number.isFinite(m.annualizedPct)).toBe(true);
  });
});
