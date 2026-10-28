import { describe, expect, it } from "vitest";
import { closeAt, openResult, orderResultsFromPrices, orderSummary, stepOrder } from "./visionFuturaAlertOutcome";

const largo = { side: "largo" as const, entry: 7700, stop: 7697, target: 7703 };
const corto = { side: "corto" as const, entry: 7710, stop: 7713, target: 7707 };

describe("resultado de las entradas", () => {
  it("abierta muestra cómo va; toca objetivo = ganada, stop = perdida", () => {
    let r = stepOrder(largo, openResult(), 7701.5, 1);
    expect(r).toMatchObject({ status: "abierta", points: 1.5 });
    r = stepOrder(largo, r, 7703.2, 2);
    expect(r).toMatchObject({ status: "ganada", reason: "objetivo", points: 3, exit: 7703 });
    expect(stepOrder(largo, openResult(), 7696, 2)).toMatchObject({ status: "perdida", reason: "stop", points: -3 });
  });

  it("cerrar por nueva alerta queda ganada o perdida según cómo iba", () => {
    expect(closeAt(largo, 7701, 5, "nueva alerta")).toMatchObject({ status: "ganada", points: 1 });
    expect(closeAt(corto, 7711.5, 5, "nueva alerta")).toMatchObject({ status: "perdida", points: -1.5 });
  });

  it("repetición: la vieja se cierra cuando sale la nueva y la nueva queda abierta", () => {
    const entries = [{ ...largo, at: 1000 }, { ...corto, at: 4000 }];
    const prices = [{ t: 2000, v: 7701 }, { t: 3000, v: 7702 }, { t: 5000, v: 7709 }];
    const res = orderResultsFromPrices(entries, prices, 5000, false);
    expect(res[0]).toMatchObject({ status: "ganada", reason: "nueva alerta", points: 2 });
    expect(res[1]).toMatchObject({ status: "abierta", points: 1 });
    expect(orderSummary(res)).toMatchObject({ n: 2, open: 1, wins: 1, losses: 0, points: 2 });
  });

  it("al cierre de la sesión la abierta sale al último precio", () => {
    const res = orderResultsFromPrices([{ ...largo, at: 1000 }], [{ t: 2000, v: 7699 }], 2000, true);
    expect(res[0]).toMatchObject({ status: "perdida", reason: "cierre", points: -1 });
  });
});

describe("con velas de 1 min", () => {
  it("usa máximo y mínimo; misma vela con stop y objetivo = stop", () => {
    const e = [{ side: "corto" as const, entry: 7714.58, stop: 7717.58, target: 7711.58, at: Date.parse("2026-10-27T11:07:09-04:00") }];
    const bar = (hhmm: string, high: number, low: number, close: number) => ({ t: Date.parse(`2026-10-27T${hhmm}:00-04:00`), high, low, close });
    // La vela de 11:07 (en curso al salir) no cuenta; 11:08 toca el stop por arriba.
    const r = orderResultsFromPrices(e, [bar("11:07", 7720, 7700, 7714), bar("11:08", 7718, 7713, 7716)], Date.parse("2026-10-27T11:30:00-04:00"), false);
    expect(r[0]).toMatchObject({ status: "perdida", reason: "stop", points: -3 });
    const both = orderResultsFromPrices(e, [bar("11:08", 7718, 7711, 7712)], Date.parse("2026-10-27T11:30:00-04:00"), false);
    expect(both[0].reason).toBe("stop");
  });
});
