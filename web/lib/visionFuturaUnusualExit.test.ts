import { describe, expect, it } from "vitest";
import type { MsUnusualTrade } from "./marketsnack";
import type { TradeSummaryBucket } from "./neighborContracts";
import { symbolsToTrack, unusualExits } from "./visionFuturaUnusualExit";

const SYM = "SPXW261028P07720000";
const u = (id: number, hhmm: string, side: string, size: number, symbol = SYM) =>
  ({ id, timestamp: `2026-10-28T${hhmm}:00Z`, symbol, side, size, price: 1, premium: size * 100, sentiment: "", score: 0, market_alert_priority: "" }) as MsUnusualTrade;
const b = (hhmm: string, bid: number, ask = 0): TradeSummaryBucket =>
  ({ t: `2026-10-28T${hhmm}:00Z`, ask_volume: ask, bid_volume: bid, mid_volume: 0, ask_premium: 0, bid_premium: 0, mid_premium: 0, single_leg_premium: 0, multi_leg_premium: 0, other_premium: 0 });
const NOW = Date.parse("2026-10-28T20:00:00Z");

describe("salida de las inusuales", () => {
  it("fuerte: la contraria inusual de tamaño parecido en el mismo contrato", () => {
    const ex = unusualExits([u(1, "16:05", "ASKSIDE", 250), u(2, "17:10", "BELOW_BID", 200)], {}, NOW);
    expect(ex[1]).toMatchObject({ kind: "fuerte", qty: 200, at: Date.parse("2026-10-28T17:10:00Z") / 1000 });
    expect(ex[2]).toMatchObject({ kind: "cierre" }); // la contraria es el cierre, no una posición nueva
  });

  it("una contraria chica (< 75%) no cierra; tampoco cuenta el mismo lado", () => {
    expect(unusualExits([u(1, "16:05", "ASKSIDE", 250), u(2, "17:10", "BIDSIDE", 100), u(3, "17:20", "ASKSIDE", 300)], {}, NOW)[1]).toBeUndefined();
  });

  it("estimada: volumen al bid DESPUÉS del bloque de la bola, repartido de la más vieja a la nueva", () => {
    const trades = [u(1, "16:07", "ASKSIDE", 100), u(2, "16:20", "ASKSIDE", 100)];
    const flow = { [SYM]: [b("16:05", 500), b("16:10", 60), b("16:25", 80), b("16:30", 70)] };
    const ex = unusualExits(trades, flow, NOW);
    // El bloque 16:05 (el de la bola) no cuenta. 16:10 da 60 a la #1; 16:25 da 40 a la #1 (cierra 16:30) y 40 a la #2.
    expect(ex[1]).toMatchObject({ kind: "estimada", qty: 100, at: Date.parse("2026-10-28T16:30:00Z") / 1000 });
    expect(ex[2]).toMatchObject({ kind: "estimada", at: Date.parse("2026-10-28T16:35:00Z") / 1000 });
  });

  it("estimada es NETA: si del mismo lado se compra igual, no cierra; lo comprado se descuenta primero", () => {
    const trades = [u(1, "16:07", "ASKSIDE", 100)];
    expect(unusualExits(trades, { [SYM]: [b("16:10", 300, 300), b("16:15", 500, 450)] }, NOW)[1]).toBeUndefined(); // neto 0 + 50
    const ex = unusualExits(trades, { [SYM]: [b("16:10", 0, 80), b("16:15", 150, 0), b("16:20", 40, 0)] }, NOW);
    // deuda 80 → 16:15 paga 80 y deja 70; 16:20 suma 40 → 110 ≥ 100 → cierra al terminar 16:20.
    expect(ex[1]).toMatchObject({ at: Date.parse("2026-10-28T16:25:00Z") / 1000 });
  });

  it("venta inusual: se cierra con compras al ask; bloque sin terminar no cuenta; MID no se marca", () => {
    const flow = { [SYM]: [b("16:10", 0, 300)] };
    expect(unusualExits([u(1, "16:02", "BIDSIDE", 250)], flow, NOW)[1]).toMatchObject({ kind: "estimada" });
    expect(unusualExits([u(1, "16:02", "BIDSIDE", 250)], flow, Date.parse("2026-10-28T16:12:00Z"))[1]).toBeUndefined();
    expect(unusualExits([u(1, "16:02", "MIDMKT", 250), u(2, "16:30", "BIDSIDE", 250)], flow, NOW)[1]).toBeUndefined();
    expect(symbolsToTrack([u(1, "16:02", "MIDMKT", 250), u(2, "16:30", "BIDSIDE", 250, "X")])).toEqual(["X"]);
  });

  it("se queda la salida que pasó primero", () => {
    const flow = { [SYM]: [b("16:10", 300)] };
    const ex = unusualExits([u(1, "16:02", "ASKSIDE", 250), u(2, "18:00", "BIDSIDE", 250)], flow, NOW);
    expect(ex[1]).toMatchObject({ kind: "estimada", at: Date.parse("2026-10-28T16:15:00Z") / 1000 });
  });
});
