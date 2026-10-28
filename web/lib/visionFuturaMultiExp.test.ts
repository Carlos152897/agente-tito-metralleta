import { describe, expect, it } from "vitest";
import { backingOf, multiExpGex, unusualDots } from "./visionFuturaMultiExp";
import type { ExtendedChainContract } from "./spxLevels";
import type { MsUnusualTrade } from "./marketsnack";

const c = (strike: number, type: "call" | "put", oi: number) => ({ strike, type, open_interest: oi, greeks: { gamma: 0.01 } } as unknown as ExtendedChainContract);
const e = (netGex: number) => ({ expiration: "x", netGex });

describe("GEX de varios vencimientos", () => {
  it("calcula el neto por strike de cada vencimiento", () => {
    const by = multiExpGex([{ expiration: "2026-10-29", contracts: [c(7725, "call", 100), c(7725, "put", 300)] }], 7700, [7725, 7730]);
    expect(by.get(7725)![0].netGex).toBeLessThan(0);
    expect(by.get(7730)![0].netGex).toBe(0);
  });
  it("respaldado / contrario / sin dato", () => {
    expect(backingOf(-51e6, [e(190e6), e(339e6), e(-5e6)])).toBe("contrario");
    expect(backingOf(300e6, [e(100e6), e(50e6), e(-20e6)])).toBe("respaldado");
    expect(backingOf(0, [e(100e6)])).toBeNull();
    expect(backingOf(100e6, [e(60e6), e(-1e6), e(-2e6)])).toBe("respaldado"); // < 5% del más grande: no cuentan
    expect(backingOf(867e6, [e(38e6), e(-72e6), e(16e6), e(8e6)])).toBe("respaldado"); // hoy enorme no borra a los demás (7,730 del 28-oct)
    expect(backingOf(100e6, [e(50e6), e(-50e6)])).toBeNull(); // empate
  });
});

describe("puntos de operaciones inusuales", () => {
  const u = (id: number, symbol: string, side: string) => ({ id, symbol, side, timestamp: "2026-10-28T13:51:36.225Z", premium: 445850, size: 185, price: 24.1, sentiment: "neutral", score: 66, market_alert_priority: "low" } as MsUnusualTrade);
  it("strike, tipo y dirección por lado", () => {
    const d = unusualDots([u(1, "SPXW261028P07730000", "BIDSIDE"), u(2, "SPXW261028C07750000", "ASKSIDE"), u(3, "SPXW261028P07730000", "MIDMKT"), u(4, "malo", "ASK")]);
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({ strike: 7730, type: "put", dir: "arriba" });
    expect(d[1]).toMatchObject({ strike: 7750, type: "call", dir: "arriba" });
    expect(d[2].dir).toBeNull();
  });
});
