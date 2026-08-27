import { describe, expect, it } from "vitest";
import { selectWeeklyExpirations } from "./grandesEmpresas";

describe("selectWeeklyExpirations", () => {
  // Regla corregida 2026-08-27 (reemplaza la de 2026-08-20 que combinaba
  // varios vencimientos): UN SOLO vencimiento objetivo por día, nunca
  // combinado. Los 5 casos los dio Carlos explícitamente, uno por uno.
  // Mismas fechas de prueba que la regla vieja (2026-08-17 lunes ..
  // 2026-08-21 viernes) para que el cambio de comportamiento quede claro.

  it("lunes: analiza lunes (0DTE de hoy)", () => {
    const now = new Date("2026-08-17T14:00:00Z"); // lunes
    const all = ["2026-08-17", "2026-08-19", "2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-17"]);
  });

  it("martes: analiza miércoles (sin 0DTE propio ese día)", () => {
    const now = new Date("2026-08-18T14:00:00Z"); // martes
    const all = ["2026-08-19", "2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-19"]);
  });

  it("miércoles: analiza miércoles (0DTE de hoy)", () => {
    const now = new Date("2026-08-19T14:00:00Z"); // miércoles
    const all = ["2026-08-19", "2026-08-21", "2026-08-24"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-19"]);
  });

  it("jueves: analiza viernes (sin 0DTE propio ese día — \"si opero hoy analiza mañana\")", () => {
    const now = new Date("2026-08-20T14:00:00Z"); // jueves
    const all = ["2026-08-21", "2026-08-24", "2026-08-26"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-21"]);
  });

  it("viernes: analiza viernes (0DTE de hoy)", () => {
    const now = new Date("2026-08-21T14:00:00Z"); // viernes
    const all = ["2026-08-21", "2026-08-24", "2026-08-26", "2026-08-28"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-21"]);
  });

  it("si el vencimiento objetivo exacto no está listado, cae al próximo real disponible en o después de esa fecha", () => {
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

  it("martes real (2026-08-25), CRM-style: elige el miércoles, no el viernes", () => {
    // Caso real que motivó la corrección: Carlos pidió explícitamente que un
    // martes analice el miércoles, nunca combinado con el viernes.
    const now = new Date("2026-08-25T15:00:00Z"); // martes
    const all = ["2026-08-26", "2026-08-28"];
    expect(selectWeeklyExpirations(all, now)).toEqual(["2026-08-26"]);
  });
});
