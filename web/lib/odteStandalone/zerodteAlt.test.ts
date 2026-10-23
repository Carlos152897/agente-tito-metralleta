import { describe, expect, it } from "vitest";
import { confirmMomentum, momentumStreak, MOMENTUM_PERSISTENCE_REQUIRED } from "./zerodteAlt";
import type { EntryDecision } from "./zerodteStrategy";

const long = (target: number): EntryDecision => ({ direction: "long", entry: 100, target, stop: 95, reason: "" });
const short = (target: number): EntryDecision => ({ direction: "short", entry: 100, target, stop: 105, reason: "" });

describe("confirmMomentum", () => {
  it("no confirma con menos lecturas que las requeridas", () => {
    expect(confirmMomentum([long(110), long(110)], 3)).toBeNull();
  });

  it("confirma cuando las últimas N lecturas coinciden en dirección + target ≈ igual", () => {
    const history = [null, long(110), long(110), long(110)];
    expect(confirmMomentum(history, 3)).toMatchObject({ direction: "long", target: 110 });
  });

  it("el target puede moverse ±1pt sin romper la racha (mismo setup, spot avanza)", () => {
    const history = [long(110), long(110.5), long(109.7)];
    expect(confirmMomentum(history, 3)).not.toBeNull();
  });

  it("un solo parpadeo distinto rompe la confirmación", () => {
    const history = [long(110), short(90), long(110)]; // giró y volvió — no es una racha
    expect(confirmMomentum(history, 3)).toBeNull();
  });

  it("una lectura null en medio de la ventana rompe la confirmación", () => {
    const history = [long(110), null, long(110)];
    expect(confirmMomentum(history, 3)).toBeNull();
  });

  it("null en la lectura más reciente nunca confirma, aunque las anteriores coincidieran", () => {
    const history = [long(110), long(110), null];
    expect(confirmMomentum(history, 3)).toBeNull();
  });

  it("con required<=1 no gatea nada — devuelve la última lectura cruda tal cual", () => {
    expect(confirmMomentum([short(90)], 1)).toMatchObject({ direction: "short", target: 90 });
    expect(confirmMomentum([], 1)).toBeNull();
  });

  it("usa MOMENTUM_PERSISTENCE_REQUIRED por default", () => {
    const history = Array.from({ length: MOMENTUM_PERSISTENCE_REQUIRED - 1 }, () => long(110));
    expect(confirmMomentum(history)).toBeNull();
    history.push(long(110));
    expect(confirmMomentum(history)).not.toBeNull();
  });
});

describe("momentumStreak", () => {
  it("0 si no hay lectura ahora mismo", () => {
    expect(momentumStreak([long(110), null])).toBe(0);
  });

  it("cuenta las lecturas seguidas que coinciden con la última", () => {
    expect(momentumStreak([long(110), long(110), long(110)])).toBe(3);
  });

  it("se corta en el primer cambio de racha (yendo hacia atrás)", () => {
    expect(momentumStreak([short(90), long(110), long(110)])).toBe(2);
  });

  it("una sola lectura ya cuenta como racha de 1", () => {
    expect(momentumStreak([long(110)])).toBe(1);
  });
});
