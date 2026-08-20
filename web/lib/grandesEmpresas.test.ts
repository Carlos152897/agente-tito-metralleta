import { describe, expect, it } from "vitest";
import { selectWeeklyExpirations } from "./grandesEmpresas";

describe("selectWeeklyExpirations", () => {
  // Estas empresas expiran lunes/miércoles/viernes (3 veces por semana).
  // Siempre la semana que se está operando — nunca cruza a la siguiente.
  // Los 5 casos de esta semana (2026-08-17 lunes .. 2026-08-21 viernes) los
  // dio Carlos explícitamente, uno por uno.

  it("lunes: 0DTE de hoy + miércoles + viernes (los 3)", () => {
    const now = new Date("2026-08-17T14:00:00Z"); // lunes
    const all = ["2026-08-17", "2026-08-19", "2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-17", "2026-08-19", "2026-08-21"]);
  });

  it("martes: miércoles + viernes (sin 0DTE propio ese día)", () => {
    const now = new Date("2026-08-18T14:00:00Z"); // martes
    const all = ["2026-08-19", "2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-19", "2026-08-21"]);
  });

  it("miércoles: 0DTE de hoy + viernes", () => {
    const now = new Date("2026-08-19T14:00:00Z"); // miércoles
    const all = ["2026-08-19", "2026-08-21", "2026-08-24"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-19", "2026-08-21"]);
  });

  it("jueves: solo viernes (sin 0DTE propio ese día)", () => {
    const now = new Date("2026-08-20T14:00:00Z"); // jueves
    const all = ["2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-21"]);
  });

  it("viernes: solo 0DTE de hoy, nada más (último día de la semana)", () => {
    const now = new Date("2026-08-21T14:00:00Z"); // viernes
    const all = ["2026-08-21", "2026-08-24", "2026-08-26", "2026-08-28"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-21"]);
  });

  it("si no queda NADA de esta semana (caso raro), cae al vencimiento real más próximo aunque sea la semana siguiente", () => {
    // jueves, el vencimiento del viernes de ESTA semana no está disponible.
    const now = new Date("2026-08-20T14:00:00Z"); // jueves
    const all = ["2026-08-24", "2026-08-26", "2026-08-28"]; // solo semana siguiente
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-24"]);
  });

  it("sin vencimientos semanales cercanos, cae al único vencimiento real más próximo", () => {
    const now = new Date("2026-08-20T14:00:00Z"); // jueves
    const all = ["2026-09-19"]; // solo mensual, lejos
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-09-19"]);
  });

  it("sin ningún vencimiento disponible, devuelve vacío", () => {
    const now = new Date("2026-08-20T14:00:00Z");
    expect(selectWeeklyExpirations([], now)).toEqual([]);
  });
});
