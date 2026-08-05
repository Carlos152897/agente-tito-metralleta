import { describe, expect, it } from "vitest";
import {
  accumulate,
  bucketKey,
  emptyAccumulator,
  overlayRealtime,
  readAggressor,
  SEEN_LIMIT,
} from "./zerodteFlow";
import type { RawTrade } from "./flow";
import type { ZRow } from "./zerodteTypes";

const EXP = "2026-07-24";

/** Trade mínimo: solo lo que mira el acumulador. */
function trade(
  id: number, symbol: string, side: string, size: number, conditionId = 209,
  extra: Partial<RawTrade> = {},
): RawTrade {
  return {
    id, symbol, side, size,
    price: 1, bid_price: 1, ask_price: 1, premium: 100,
    delta: 0, implied_volatility: 0.2, open_interest: 0, volume: 0,
    score: 0, sentiment: "", timestamp: "2026-07-24T15:00:00Z",
    trade_condition_id: conditionId,
    ...extra,
  };
}

/** ZRow mínima para probar el overlay. */
function row(type: "call" | "put", strike: number, over: Partial<ZRow> = {}): ZRow {
  return {
    optionTicker: `X${strike}`, contractType: type, expiration: EXP, strike,
    openInterest: 100, volume: 50, bid: null, ask: null,
    greeks: { delta: -0.1, gamma: 0.001, theta: null, vega: null, iv: 0.9 },
    ...over,
  };
}

const C7450 = "SPXW260724C07450000";
const P7400 = "SPXW260724P07400000";

describe("accumulate", () => {
  it("separa el tamaño según el lado del agresor", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 10),
      trade(2, C7450, "AT_BID", 4),
      trade(3, C7450, "MIDMKT", 1),
    ], EXP);
    const b = acc.buckets[bucketKey("call", 7450)];
    expect(b).toMatchObject({ ask: 10, bid: 4, mid: 1, trades: 3, strike: 7450 });
  });

  it("trata ASKSIDE y ABOVE_ASK como compra, igual que aggressionOf", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "ASKSIDE", 5),
      trade(2, C7450, "ABOVE_ASK", 5),
      trade(3, C7450, "BELOW_BID", 2),
    ], EXP);
    expect(acc.buckets[bucketKey("call", 7450)]).toMatchObject({ ask: 10, bid: 2 });
  });

  it("descarta las transacciones canceladas", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 10, 201), // CANC
      trade(2, C7450, "AT_ASK", 3),
    ], EXP);
    expect(acc.buckets[bucketKey("call", 7450)]).toMatchObject({ ask: 3, trades: 1 });
  });

  it("ignora los vencimientos que no son el del día", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, "SPXW260731C07450000", "AT_ASK", 99),
      trade(2, C7450, "AT_ASK", 3),
    ], EXP);
    expect(Object.keys(acc.buckets)).toEqual([bucketKey("call", 7450)]);
  });

  it("no cuenta dos veces el mismo trade entre ciclos", () => {
    const one = accumulate(emptyAccumulator("SPX", EXP), [trade(1, C7450, "AT_ASK", 10)], EXP);
    const two = accumulate(one, [trade(1, C7450, "AT_ASK", 10), trade(2, C7450, "AT_ASK", 5)], EXP);
    expect(two.buckets[bucketKey("call", 7450)]).toMatchObject({ ask: 15, trades: 2 });
  });

  it("suma un ciclo por llamada", () => {
    const a = accumulate(emptyAccumulator("SPX", EXP), [], EXP);
    expect(accumulate(a, [], EXP).cycles).toBe(2);
  });

  it("acota la lista de ids vistos para que no crezca sin fin", () => {
    const many = Array.from({ length: SEEN_LIMIT + 500 }, (_, i) => trade(i + 1, C7450, "AT_ASK", 1));
    expect(accumulate(emptyAccumulator("SPX", EXP), many, EXP).seenIds).toHaveLength(SEEN_LIMIT);
  });

  it("distingue calls de puts en el mismo strike", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 7),
      trade(2, P7400, "AT_BID", 9),
    ], EXP);
    expect(acc.buckets[bucketKey("call", 7450)].ask).toBe(7);
    expect(acc.buckets[bucketKey("put", 7400)].bid).toBe(9);
  });
});

describe("readAggressor", () => {
  const build = (side: string, n: number, symbol = C7450) =>
    accumulate(
      emptyAccumulator("SPX", EXP),
      Array.from({ length: n }, (_, i) => trade(i + 1, symbol, side, 10)),
      EXP,
    );

  it("sin muestra suficiente no devuelve lectura", () => {
    expect(readAggressor(build("AT_ASK", 2), "call", 7450)).toBeNull();
  });

  it("compra de calls se lee como direccional alcista", () => {
    const r = readAggressor(build("AT_ASK", 10), "call", 7450)!;
    expect(r.side).toBe("compra");
    expect(r.meaning).toBe("direccional alcista");
  });

  it("venta de calls se lee como resistencia — Proceso Principal §4", () => {
    const r = readAggressor(build("AT_BID", 10), "call", 7450)!;
    expect(r.side).toBe("venta");
    expect(r.meaning).toBe("resistencia / muro");
  });

  it("venta de puts se lee como soporte", () => {
    const r = readAggressor(build("AT_BID", 10, P7400), "put", 7400)!;
    expect(r.side).toBe("venta");
    expect(r.meaning).toBe("soporte");
  });

  it("marca MID aparte en vez de disfrazarlo de mixto", () => {
    const r = readAggressor(build("MIDMKT", 10), "call", 7450)!;
    expect(r.side).toBe("mid");
  });

  it("sin dominancia clara devuelve mixto", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      ...Array.from({ length: 5 }, (_, i) => trade(i + 1, C7450, "AT_ASK", 10)),
      ...Array.from({ length: 5 }, (_, i) => trade(i + 10, C7450, "AT_BID", 10)),
    ], EXP);
    expect(readAggressor(acc, "call", 7450)!.side).toBe("mixto");
  });

  it("devuelve null para un contrato que nunca operó", () => {
    expect(readAggressor(emptyAccumulator("SPX", EXP), "call", 9999)).toBeNull();
  });
});

describe("accumulate - foto del contrato (para GEX en tiempo real)", () => {
  it("captura gamma/OI/volumen/delta/iv del contrato", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 5, 209, { gamma: 0.012, open_interest: 3000, volume: 40000, delta: 0.45, implied_volatility: 0.22, bid_price: 5.1, ask_price: 5.3 }),
    ], EXP);
    const b = acc.buckets[bucketKey("call", 7450)];
    expect(b.gamma).toBe(0.012);
    expect(b.oi).toBe(3000);
    expect(b.volume).toBe(40000);
    expect(b.delta).toBe(0.45);
    expect(b.iv).toBe(0.22);
  });

  it("volumen y OI se quedan con el MAYOR visto (son acumulados)", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 1, 209, { volume: 40000, open_interest: 3000, gamma: 0.01 }),
      trade(2, C7450, "AT_ASK", 1, 209, { volume: 39000, open_interest: 2900, gamma: 0.01 }),
    ], EXP);
    const b = acc.buckets[bucketKey("call", 7450)];
    expect(b.volume).toBe(40000);
    expect(b.oi).toBe(3000);
  });

  it("los griegos se quedan con los del trade mas RECIENTE", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 1, 209, { gamma: 0.010, timestamp: "2026-07-24T15:00:00Z" }),
      trade(2, C7450, "AT_ASK", 1, 209, { gamma: 0.015, timestamp: "2026-07-24T15:05:00Z" }),
    ], EXP);
    expect(acc.buckets[bucketKey("call", 7450)].gamma).toBe(0.015);
  });
});

describe("overlayRealtime", () => {
  it("pisa gamma/OI/volumen de Schwab con los frescos de MarketSnack", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 1, 209, { gamma: 0.02, open_interest: 5000, volume: 90000, delta: 0.5, implied_volatility: 0.25 }),
    ], EXP);
    const schwab = [row("call", 7450, { openInterest: 3000, volume: 40000, greeks: { delta: 0.4, gamma: 0.008, theta: null, vega: null, iv: 0.9 } })];
    const { rows, realtimeStrikes } = overlayRealtime(schwab, acc);
    expect(realtimeStrikes).toBe(1);
    expect(rows[0].greeks?.gamma).toBe(0.02);      // MS
    expect(rows[0].openInterest).toBe(5000);        // MS
    expect(rows[0].volume).toBe(90000);             // MS (mayor)
    expect(rows[0].greeks?.delta).toBe(0.5);        // MS
  });

  it("deja intactas las filas que MarketSnack no vio (relleno Schwab)", () => {
    const acc = emptyAccumulator("SPX", EXP);
    const schwab = [row("call", 7500, { greeks: { delta: 0.1, gamma: 0.003, theta: null, vega: null, iv: 0.5 } })];
    const { rows, realtimeStrikes } = overlayRealtime(schwab, acc);
    expect(realtimeStrikes).toBe(0);
    expect(rows[0].greeks?.gamma).toBe(0.003);      // Schwab intacto
  });

  it("no degrada un dato bueno de Schwab por un hueco de MarketSnack (sin gamma en MS)", () => {
    const acc = accumulate(emptyAccumulator("SPX", EXP), [
      trade(1, C7450, "AT_ASK", 1, 209, { open_interest: 5000, volume: 90000 }),
    ], EXP);
    const schwab = [row("call", 7450, { greeks: { delta: 0.4, gamma: 0.008, theta: null, vega: null, iv: 0.9 } })];
    const { rows, realtimeStrikes } = overlayRealtime(schwab, acc);
    expect(realtimeStrikes).toBe(0);
    expect(rows[0].greeks?.gamma).toBe(0.008);
  });

  it("con acumulador nulo devuelve las filas tal cual", () => {
    const schwab = [row("call", 7450)];
    expect(overlayRealtime(schwab, null).rows).toBe(schwab);
  });
});

describe("accumulate - robustez con buckets de formato viejo", () => {
  it("no rompe si el bucket guardado no tiene los campos nuevos", () => {
    const old: any = emptyAccumulator("SPX", EXP);
    old.buckets[bucketKey("call", 7450)] = { strike: 7450, type: "call", ask: 5, bid: 2, mid: 0, trades: 3 };
    const acc = accumulate(old, [
      trade(9, C7450, "AT_ASK", 1, 209, { gamma: 0.02, open_interest: 5000, volume: 90000 }),
    ], EXP);
    const b = acc.buckets[bucketKey("call", 7450)];
    expect(b.gamma).toBe(0.02);
    expect(b.volume).toBe(90000);
    expect(b.oi).toBe(5000);
    expect(b.ask).toBe(6);
    expect(Number.isNaN(b.volume)).toBe(false);
  });
});
