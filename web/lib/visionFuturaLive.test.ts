import { describe, expect, it } from "vitest";
import { exitWithCandles, minutesWatched, scoreLiveDay, type LiveFired } from "./visionFuturaLive";
import type { MoneyTrade } from "./visionFuturaMoneyFlow";

const T0 = Date.parse("2026-10-27T13:30:00Z"); // 9:30 NY
const bar = (min: number, high: number, low: number, close: number) => ({ time: (T0 + min * 60_000) / 1000, high, low, close });

describe("exitWithCandles", () => {
  it("empieza en la vela siguiente a la del disparo", () => {
    // La vela 0 (donde se disparó) toca el stop, pero es precio de antes del disparo.
    const c = [bar(0, 106, 99, 100), bar(1, 101, 97, 97)];
    const r = exitWithCandles(c, T0 + 30_000, "largo", 100, 97, 103);
    expect(r.outcome).toBe("stop");
    expect(r.exitAt).toBe(T0 + 60_000);
  });
  it("misma vela con stop y objetivo cuenta stop", () => {
    const r = exitWithCandles([bar(1, 104, 96, 100)], T0, "largo", 100, 97, 103);
    expect(r.outcome).toBe("stop");
    expect(r.points).toBe(-3);
  });
  it("corto llega al objetivo con el mínimo de la vela", () => {
    const r = exitWithCandles([bar(1, 101, 99, 100), bar(2, 100, 96.5, 98)], T0, "corto", 100, 103, 97);
    expect(r.outcome).toBe("objetivo");
    expect(r.points).toBe(3);
  });
  it("sin tocar nada sale al cierre", () => {
    const r = exitWithCandles([bar(1, 101, 99, 100.5)], T0, "largo", 100, 97, 103);
    expect(r).toMatchObject({ outcome: "cierre", points: 0.5 });
  });
});

describe("minutesWatched", () => {
  it("no cuenta huecos de más de 3 min", () => {
    const ts = [0, 30, 60, 90, 600, 630].map((s) => T0 + s * 1000); // 1.5 min + hueco de 8.5 + 0.5 min
    expect(minutesWatched(ts)).toBe(2);
  });
});

describe("scoreLiveDay", () => {
  const alert = {
    id: "defensa_piso:7700", kind: "defensa_piso", direction: "alcista", title: "Defensa de PISO 7,700",
    level: { spx: 7700, spy: 767, es: null }, levelSources: ["Piso"], price: { spx: 7701, spy: 767, es: null },
    conditions: [{ key: "llega", label: "Llegó al piso", ok: true, detail: "x" }], score: 4, fires: true, blocked: null, trap: null,
    target: null, regimeNote: null,
    order: { side: "largo", instrumento: "Calls", entry: { spx: 7701, spy: 767, es: null }, stop: { spx: 7698, spy: 767, es: null }, target: { spx: 7704, spy: 767, es: null }, rb: 1, riskPts: 3, rewardPts: 3 },
    firedAt: T0 + 10_000, lastSeenAt: T0 + 10_000,
  } as unknown as LiveFired;

  it("califica alertas y termina señales abiertas con las velas", () => {
    const money = [{ side: "corto", entry: 7701, stop: 7705, target: 7690, openedAt: T0, outcome: null, exit: null, exitAt: null, points: null } as unknown as MoneyTrade];
    const d = scoreLiveDay({
      date: "2026-10-27", fired: [alert], money,
      candles: [bar(1, 7702, 7700, 7701), bar(2, 7706, 7701, 7705)],
      coverage: { first: T0, last: T0 + 60_000, cycles: 3, minutesWatched: 1 },
    });
    expect(d.trades).toHaveLength(1);
    expect(d.trades[0]).toMatchObject({ outcome: "objetivo", points: 3 });
    expect(d.wins).toBe(1);
    // La señal abierta tocó su stop 7705 en la vela 2 (no se cierra al último precio).
    expect(d.money[0]).toMatchObject({ outcome: "stop", points: -4 });
  });

  it("una señal marcada 'cierre' sin vigilar la tarde se revisa con las velas", () => {
    const money = [{ side: "corto", entry: 7701, stop: 7705, target: 7690, openedAt: T0, outcome: "cierre", exit: 7720, exitAt: T0 + 3 * 60_000, points: -19 } as unknown as MoneyTrade];
    const d = scoreLiveDay({ date: "2026-10-27", fired: [], money, candles: [bar(1, 7706, 7700, 7705), bar(2, 7720, 7705, 7720)], coverage: { first: null, last: null, cycles: 0, minutesWatched: 0 } });
    expect(d.money[0]).toMatchObject({ outcome: "stop", points: -4 });
  });

  it("sin velas usa el precio de 5 min", () => {
    const d = scoreLiveDay({
      date: "2026-10-27", fired: [alert], candles: [],
      fallbackPrices: [{ time: (T0 + 300_000) / 1000, value: 7697 }],
      coverage: { first: null, last: null, cycles: 0, minutesWatched: 0 },
    });
    expect(d.priceSource).toContain("5 min");
    expect(d.trades[0].outcome).toBe("stop");
  });
});
