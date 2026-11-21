import { describe, expect, it } from "vitest";
import {
  aggressorSide, buildLadder, cumulativeBounds, findConflicts, groupStructures, openingFactor, positionWindow, prepare, trendOf, windowBounds,
  type PruebaTrade, type StrikePos,
} from "./visionFuturaPrueba";

const SPOT = 7000;
const T0 = Date.parse("2026-11-20T15:00:00Z");
let nextId = 1;

/** Trade de ejemplo: por defecto 10 contratos, OI 0 (→ apertura segura), bid 1.00 / ask 1.10. */
function tr(p: Partial<PruebaTrade> & { strike: number; cp: "C" | "P" }): PruebaTrade {
  return {
    id: nextId++, t: T0, sym: `SPXW261120${p.cp}${String(p.strike * 1000).padStart(8, "0")}`, exp: "2026-11-20",
    price: 1.1, bid: 1, ask: 1.1, size: 10, premium: 1100, spot: SPOT, delta: p.cp === "C" ? 0.5 : -0.5, iv: 0.15, oi: 0, vol: 10,
    ...p,
  };
}
const atAsk = { price: 1.1 };
const atBid = { price: 1.0 };
/** $ delta de 10 contratos con |delta| d a spot 7,000. */
const usd = (d: number, size = 10) => size * d * 100 * SPOT;

const all = (trades: PruebaTrade[], to = T0 + 3_600_000) => positionWindow(prepare(trades), T0 - 1, to);

describe("Paso 1 · lado del agresor", () => {
  it("ask o encima = COMPRA, bid o debajo = VENTA, en medio por cercanía, mid exacto = sin clasificar", () => {
    expect(aggressorSide(1.1, 1, 1.1)).toBe("compra");
    expect(aggressorSide(1.2, 1, 1.1)).toBe("compra");
    expect(aggressorSide(1.0, 1, 1.1)).toBe("venta");
    expect(aggressorSide(0.9, 1, 1.1)).toBe("venta");
    expect(aggressorSide(1.08, 1, 1.1)).toBe("compra");
    expect(aggressorSide(1.02, 1, 1.1)).toBe("venta");
    expect(aggressorSide(1.05, 1, 1.1)).toBeNull();
  });

  it("un trade al mid no entra al posicionamiento y se cuenta aparte", () => {
    const r = all([tr({ strike: 7000, cp: "C", price: 1.05 })]);
    expect(r.byStrike.size).toBe(0);
    expect(r.unclassified).toBe(1);
  });
});

describe("Paso 3 · los 4 casos", () => {
  it("compra call +, venta put +, compra put −, venta call −", () => {
    const r = all([
      tr({ strike: 7010, cp: "C", ...atAsk }),
      tr({ strike: 6990, cp: "P", ...atBid, t: T0 + 10_000 }),
      tr({ strike: 6980, cp: "P", ...atAsk, t: T0 + 20_000 }),
      tr({ strike: 7020, cp: "C", ...atBid, t: T0 + 30_000 }),
    ]);
    expect(r.byStrike.get(7010)!.buckets.largoCall).toBeCloseTo(usd(0.5));
    expect(r.byStrike.get(6990)!.buckets.cortoPut).toBeCloseTo(usd(0.5));
    expect(r.byStrike.get(6980)!.buckets.largoPut).toBeCloseTo(-usd(0.5));
    expect(r.byStrike.get(7020)!.buckets.cortoCall).toBeCloseTo(-usd(0.5));
    expect(r.byStrike.get(7010)!.net).toBeCloseTo(usd(0.5));
    expect(r.byStrike.get(7020)!.net).toBeCloseTo(-usd(0.5));
  });

  it("sin delta de MarketSnack se calcula con Black-Scholes", () => {
    const r = all([tr({ strike: 7000, cp: "C", ...atAsk, delta: 0 })]);
    const v = r.byStrike.get(7000)!.buckets.largoCall;
    expect(v).toBeGreaterThan(usd(0.4));
    expect(v).toBeLessThan(usd(0.6));
  });
});

describe("Paso 2 · subagentes de spreads", () => {
  it("credit put = PISO en el strike vendido; la pata de protección no cuenta (sin doble conteo)", () => {
    const r = all([
      tr({ strike: 7000, cp: "P", ...atBid, delta: -0.3 }),
      tr({ strike: 6990, cp: "P", ...atAsk, delta: -0.2, t: T0 + 500 }),
    ]);
    expect(r.byStrike.get(7000)!.buckets.creditPut).toBeCloseTo(usd(0.1));
    expect(r.byStrike.get(7000)!.buckets.cortoPut).toBe(0);
    expect(r.byStrike.has(6990)).toBe(false);
    expect(r.structures.credit_put).toBe(1);
  });

  it("credit call = TECHO (−) en el strike vendido", () => {
    const r = all([
      tr({ strike: 7010, cp: "C", ...atBid, delta: 0.3 }),
      tr({ strike: 7020, cp: "C", ...atAsk, delta: 0.2, t: T0 + 800 }),
    ]);
    expect(r.byStrike.get(7010)!.buckets.creditCall).toBeCloseTo(-usd(0.1));
    expect(r.byStrike.has(7020)).toBe(false);
  });

  it("debit call = OBJ↑ (+) y debit put = OBJ↓ (−), en el strike vendido (objetivo)", () => {
    const r = all([
      tr({ strike: 7000, cp: "C", ...atAsk, delta: 0.5 }),
      tr({ strike: 7020, cp: "C", ...atBid, delta: 0.2, t: T0 + 300 }),
      tr({ strike: 7000, cp: "P", ...atAsk, delta: -0.5, t: T0 + 60_000 }),
      tr({ strike: 6980, cp: "P", ...atBid, delta: -0.2, t: T0 + 60_400 }),
    ]);
    expect(r.byStrike.get(7020)!.buckets.debitCall).toBeCloseTo(usd(0.3));
    expect(r.byStrike.get(6980)!.buckets.debitPut).toBeCloseTo(-usd(0.3));
    expect(r.byStrike.has(7000)).toBe(false);
  });

  it("iron condor = PISO en el put vendido y TECHO en el call vendido", () => {
    const r = all([
      tr({ strike: 6990, cp: "P", ...atBid, delta: -0.3 }),
      tr({ strike: 6980, cp: "P", ...atAsk, delta: -0.2, t: T0 + 100 }),
      tr({ strike: 7010, cp: "C", ...atBid, delta: 0.3, t: T0 + 200 }),
      tr({ strike: 7020, cp: "C", ...atAsk, delta: 0.2, t: T0 + 300 }),
    ]);
    expect(r.structures.iron_condor).toBe(1);
    expect(r.byStrike.get(6990)!.buckets.icPut).toBeCloseTo(usd(0.1));
    expect(r.byStrike.get(7010)!.buckets.icCall).toBeCloseTo(-usd(0.1));
    expect(r.byStrike.has(6980)).toBe(false);
    expect(r.byStrike.has(7020)).toBe(false);
  });

  it("distinto tamaño o > 2 s = opciones sueltas", () => {
    const s1 = groupStructures(prepare([
      tr({ strike: 7000, cp: "P", ...atBid }), tr({ strike: 6990, cp: "P", ...atAsk, size: 11, t: T0 + 100 }),
    ]).structures.flatMap((s) => s.legs));
    expect(s1.every((s) => s.kind === "suelta")).toBe(true);
    const s2 = prepare([tr({ strike: 7000, cp: "P", ...atBid }), tr({ strike: 6990, cp: "P", ...atAsk, t: T0 + 2500 })]).structures;
    expect(s2.every((s) => s.kind === "suelta")).toBe(true);
  });
});

describe("Paso 3.3 · factor de apertura y cierres", () => {
  it("tamaño > OI → 1.0; volumen del día > OI → 1.0; si no → 0.5", () => {
    expect(openingFactor(tr({ strike: 7000, cp: "C", size: 50, oi: 10, vol: 50 }))).toBe(1);
    expect(openingFactor(tr({ strike: 7000, cp: "C", size: 5, oi: 100, vol: 150 }))).toBe(1);
    expect(openingFactor(tr({ strike: 7000, cp: "C", size: 5, oi: 100, vol: 20 }))).toBe(0.5);
    const r = all([tr({ strike: 7000, cp: "C", ...atAsk, size: 10, oi: 100, vol: 20 })]);
    expect(r.byStrike.get(7000)!.buckets.largoCall).toBeCloseTo(usd(0.5) * 0.5);
    expect(r.byStrike.get(7000)!.openShare).toBeCloseTo(0.5);
  });

  it("un cierre (recompran la call que vendieron) resta y hace encoger la barra", () => {
    const sold = tr({ strike: 7010, cp: "C", ...atBid, size: 10 });
    const bought = tr({ strike: 7010, cp: "C", ...atAsk, size: 6, t: T0 + 10 * 60_000, vol: 16 });
    const prep = prepare([sold, bought]);
    const before = positionWindow(prep, T0 - 1, T0 + 5 * 60_000).byStrike.get(7010)!;
    const after = positionWindow(prep, T0 - 1, T0 + 15 * 60_000).byStrike.get(7010)!;
    expect(before.net).toBeCloseTo(-usd(0.5));
    expect(after.net).toBeCloseTo(-usd(0.5, 4)); // quedan 4 vendidas
    expect(after.buckets.largoCall).toBe(0); // no se volvió "largo call"
    expect(after.closes).toBe(1);
    expect(Math.abs(after.net)).toBeLessThan(Math.abs(before.net));
    expect(trendOf(after.net, before.net, Math.abs(before.net))).toBe("saliendo");
    // En una ventana que solo ve el cierre, la barra del cierre suma hacia el lado contrario.
    const win = positionWindow(prep, T0 + 5 * 60_000, T0 + 15 * 60_000).byStrike.get(7010)!;
    expect(win.buckets.cortoCall).toBeCloseTo(usd(0.5, 6));
  });
});

describe("intervalos", () => {
  it("ventana actual y anterior del mismo tamaño; 1D contra el día hasta hace 15 min", () => {
    const now = T0 + 3_600_000;
    expect(windowBounds(15, now, T0)).toEqual({ cur: [now - 900_000, now], prev: [now - 1_800_000, now - 900_000] });
    expect(windowBounds("1D", now, T0)).toEqual({ cur: [T0, now], prev: [T0, now - 900_000] });
  });
});

describe("pisos y techos clave", () => {
  const pos = (strike: number, b: Partial<StrikePos["buckets"]>): StrikePos => {
    const buckets = { largoCall: 0, cortoPut: 0, largoPut: 0, cortoCall: 0, creditPut: 0, creditCall: 0, icPut: 0, icCall: 0, debitCall: 0, debitPut: 0, ...b };
    return { strike, buckets, net: Object.values(buckets).reduce((a, x) => a + x, 0), trades: 1, openShare: 1, closes: 0 };
  };
  const strikes = [7030, 7025, 7020, 7015, 7010, 7005, 7000, 6995, 6990, 6985, 6980];

  it("techo #1 amarillo arriba del spot y piso #1 celeste abajo; < 20% del máximo no se marca", () => {
    const cur = new Map([
      [7020, pos(7020, { cortoCall: -5e6 })],
      [7010, pos(7010, { creditCall: -2e6 })],
      [7030, pos(7030, { cortoCall: -0.5e6 })], // 10% del máximo → no sale
      [6990, pos(6990, { cortoPut: 4e6 })],
      [6980, pos(6980, { icPut: 1.5e6 })],
    ]);
    const lad = buildLadder(cur, new Map(), strikes, new Map(), 7003);
    expect(lad.techos.map((k) => [k.strike, k.rank])).toEqual([[7020, 1], [7010, 2]]);
    expect(lad.pisos.map((k) => [k.strike, k.rank])).toEqual([[6990, 1], [6980, 2]]);
    expect(lad.magnetNeg?.strike).toBe(7020);
  });

  it("gamma positiva (×1.5) y ENTRANDO (×1.25) suben la defensa", () => {
    const cur = new Map([[7010, pos(7010, { cortoCall: -2e6 })], [7020, pos(7020, { cortoCall: -2.8e6 })]]);
    const prev = new Map([[7010, pos(7010, { cortoCall: -1e6 })], [7020, pos(7020, { cortoCall: -2.8e6 })]]);
    const lad = buildLadder(cur, prev, strikes, new Map([[7010, 5e6]]), 7003);
    // 7010: 2M × 1.5 × 1.25 = 3.75M > 7020: 2.8M
    expect(lad.techos[0].strike).toBe(7010);
    expect(lad.techos[0].score).toBeCloseTo(3.75e6);
    expect(lad.bars.find((b) => b.strike === 7010)!.trend).toBe("entrando");
  });

  it("el strike del spot puede ser piso y techo a la vez", () => {
    const cur = new Map([[7005, pos(7005, { cortoCall: -2e6, cortoPut: 2e6 })]]);
    const lad = buildLadder(cur, new Map(), strikes, new Map(), 7004);
    expect(lad.techos[0]?.strike).toBe(7005);
    expect(lad.pisos[0]?.strike).toBe(7005);
  });

  it("imán + = objetivos de débito / largos; etiqueta dominante; conflictos", () => {
    const cur = new Map([
      [7020, pos(7020, { debitCall: 3e6 })],
      [7015, pos(7015, { cortoCall: -2.5e6 })],
      [6990, pos(6990, { largoPut: -1e6 })],
    ]);
    const lad = buildLadder(cur, new Map(), strikes, new Map(), 7003);
    expect(lad.magnetPos?.strike).toBe(7020);
    expect(lad.magnetPos?.distPts).toBeCloseTo(17);
    expect(lad.bars.find((b) => b.strike === 7020)!.dominant).toBe("OBJ↑");
    expect(lad.bars.find((b) => b.strike === 7015)!.dominant).toBe("CORTO CALL");
    expect(findConflicts(lad.bars)).toEqual([{ long: 7020, short: 7015, longAmt: 3e6, shortAmt: 2.5e6 }]);
  });
});

describe("etiqueta dominante", () => {
  it("si pesan más los cierres de un caso, dice CIERRE", async () => {
    const { dominantOf } = await import("./visionFuturaPrueba");
    const b = { largoCall: 0, cortoPut: -5e6, largoPut: -1e6, cortoCall: 0, creditPut: 0, creditCall: 0, icPut: 0, icCall: 0, debitCall: 0, debitPut: 0 };
    expect(dominantOf(b)).toBe("CIERRE CORTO PUT");
    expect(dominantOf({ ...b, cortoPut: 5e6 })).toBe("CORTO PUT");
    expect(dominantOf({ ...b, cortoPut: 0, creditPut: 0, icPut: 2e6 })).toBe("PISO");
  });
});

describe("pisos y techos · 20% por lado", () => {
  it("un corto put enorme arriba del spot no borra a los pisos de abajo", () => {
    const mk = (strike: number, b: Record<string, number>) => {
      const buckets = { largoCall: 0, cortoPut: 0, largoPut: 0, cortoCall: 0, creditPut: 0, creditCall: 0, icPut: 0, icCall: 0, debitCall: 0, debitPut: 0, ...b };
      return [strike, { strike, buckets, net: Object.values(buckets).reduce((a, x) => a + x, 0), trades: 1, openShare: 1, closes: 0 }] as const;
    };
    const cur = new Map([mk(7000, { cortoPut: 50e6 }), mk(6990, { cortoPut: 3e6 }), mk(6985, { cortoCall: -2e6 })]);
    const lad = buildLadder(cur, new Map(), [7000, 6995, 6990, 6985, 6980], new Map(), 6992);
    expect(lad.pisos.map((k) => k.strike)).toEqual([6990]);
    expect(lad.techos).toEqual([]);
  });
});

describe("clasificador.py (portado tal cual)", () => {
  /** Filas de ejemplo_flow.csv del zip spread-agents (side BUY = compra al ask, SELL = venta al bid). */
  const csv: [string, "C" | "P", number, "BUY" | "SELL", number][] = [
    ["10:01:00", "C", 610, "SELL", 500], ["10:01:01", "C", 615, "BUY", 500],
    ["10:05:00", "P", 500, "SELL", 300], ["10:05:00", "P", 495, "BUY", 300],
    ["10:10:00", "C", 150, "BUY", 1000], ["10:10:01", "C", 160, "SELL", 1000],
    ["10:20:00", "P", 300, "BUY", 200], ["10:20:01", "P", 280, "SELL", 200],
    ["11:00:00", "P", 220, "SELL", 400], ["11:00:00", "P", 215, "BUY", 400],
    ["11:00:01", "C", 240, "SELL", 400], ["11:00:01", "C", 245, "BUY", 400],
  ];
  const fromCsv = () => csv.map(([hms, cp, strike, side, size]) =>
    tr({ t: Date.parse(`2026-11-20T${hms}Z`), cp, strike, size, ...(side === "BUY" ? atAsk : atBid) }));

  it("ejemplo_flow.csv da lo mismo que el script: los 5 subagentes y su strike clave", () => {
    const s = prepare(fromCsv()).structures.filter((x) => x.kind !== "suelta");
    const summary = s.map((x) => [x.kind, x.legs.filter((l) => l.side === "venta").map((l) => l.tr.strike)]);
    expect(summary).toEqual([
      ["credit_call", [610]],
      ["credit_put", [500]],
      ["debit_call", [160]],
      ["debit_put", [280]],
      ["iron_condor", [220, 240]], // piso 220 / techo 240
    ]);
  });

  it("grupos de 3 patas o de 4 que no son iron condor no son spread: todo queda suelto", () => {
    const three = prepare([
      tr({ strike: 7000, cp: "P", ...atBid }), tr({ strike: 6990, cp: "P", ...atAsk, t: T0 + 100 }), tr({ strike: 6980, cp: "P", ...atAsk, t: T0 + 200 }),
    ]).structures;
    expect(three.map((s) => s.kind)).toEqual(["suelta", "suelta", "suelta"]);
    const twoPutSpreads = prepare([
      tr({ strike: 7000, cp: "P", ...atBid }), tr({ strike: 6990, cp: "P", ...atAsk, t: T0 + 100 }),
      tr({ strike: 6980, cp: "P", ...atBid, t: T0 + 200 }), tr({ strike: 6970, cp: "P", ...atAsk, t: T0 + 300 }),
    ]).structures;
    expect(twoPutSpreads.every((s) => s.kind === "suelta")).toBe(true);
  });

  it("la ventana de 2 s cuenta desde la PRIMERA pata del grupo (≤ 2 s)", () => {
    const s = prepare([
      tr({ strike: 7010, cp: "C", ...atBid }),
      tr({ strike: 7020, cp: "C", ...atAsk, t: T0 + 2000 }), // justo 2 s → mismo grupo
      tr({ strike: 7030, cp: "C", ...atBid, t: T0 + 2500 }), // 2.5 s de la primera → grupo nuevo (solo)
    ]).structures;
    expect(s.map((x) => x.kind)).toEqual(["credit_call", "suelta"]);
  });
});

describe("Contratos y barras acumuladas (20-nov)", () => {
  it("en contratos un put lejano pesa lo mismo que uno cerca (la delta en $ lo achica)", () => {
    const trades = [
      tr({ strike: 7000, cp: "P", ...atAsk }),
      tr({ strike: 6900, cp: "P", ...atAsk, delta: -0.05 }),
    ];
    const c = positionWindow(prepare(trades), T0 - 1, T0 + 1, "contratos").byStrike;
    expect(c.get(7000)!.net).toBeCloseTo(-10);
    expect(c.get(6900)!.net).toBeCloseTo(-10);
    const d = positionWindow(prepare(trades), T0 - 1, T0 + 1).byStrike;
    expect(d.get(6900)!.net / d.get(7000)!.net).toBeCloseTo(0.1);
  });

  it("un spread cuenta los contratos de la pata vendida una vez", () => {
    const trades = [
      tr({ strike: 6990, cp: "P", ...atBid, size: 20 }),
      tr({ strike: 6980, cp: "P", ...atAsk, size: 20 }),
    ];
    const c = positionWindow(prepare(trades), T0 - 1, T0 + 1, "contratos").byStrike;
    expect(c.get(6990)!.buckets.creditPut).toBeCloseTo(20);
    expect(c.get(6980)).toBeUndefined();
  });

  it("acumulado: la barra es el día entero y se compara con el día hasta hace N min", () => {
    const open = T0 - 3 * 3_600_000;
    expect(cumulativeBounds(15, T0, open)).toEqual({ cur: [open, T0], prev: [open, T0 - 15 * 60_000] });
    expect(cumulativeBounds("1D", T0, open).prev[1]).toBe(T0 - 15 * 60_000);
    expect(cumulativeBounds(60, open + 60_000, open).prev).toEqual([open, open]);
  });
});
