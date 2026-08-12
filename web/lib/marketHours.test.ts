import { describe, expect, it } from "vitest";
import { isFuturesMarketOpen, isMarketCloseNear, isMarketOpen, marketStatusLabel } from "./marketHours";

describe("isMarketOpen", () => {
  it("abierto un martes a media mañana ET", () => {
    // 2026-07-21 es martes. 14:00 UTC = 10:00 ET (jul, horario de verano).
    expect(isMarketOpen(new Date("2026-07-21T14:00:00Z"))).toBe(true);
  });

  it("cerrado antes de las 9:30 ET", () => {
    // 13:00 UTC = 9:00 ET
    expect(isMarketOpen(new Date("2026-07-21T13:00:00Z"))).toBe(false);
  });

  it("cerrado justo a las 16:00 ET (cierre exclusivo)", () => {
    // 20:00 UTC = 16:00 ET
    expect(isMarketOpen(new Date("2026-07-21T20:00:00Z"))).toBe(false);
  });

  it("abierto justo a las 9:30 ET", () => {
    // 13:30 UTC = 9:30 ET
    expect(isMarketOpen(new Date("2026-07-21T13:30:00Z"))).toBe(true);
  });

  it("cerrado en fin de semana", () => {
    // 2026-07-25 es sábado, 15:00 UTC = 11:00 ET
    expect(isMarketOpen(new Date("2026-07-25T15:00:00Z"))).toBe(false);
  });
});

describe("marketStatusLabel", () => {
  it("refleja abierto/cerrado", () => {
    expect(marketStatusLabel(new Date("2026-07-21T14:00:00Z"))).toBe("Mercado abierto");
    expect(marketStatusLabel(new Date("2026-07-25T15:00:00Z"))).toBe("Mercado cerrado");
  });
});

describe("isMarketCloseNear", () => {
  it("true a 15 minutos o menos del cierre (16:00 ET)", () => {
    // 19:46 UTC = 15:46 ET, 14 min antes del cierre
    expect(isMarketCloseNear(new Date("2026-07-21T19:46:00Z"))).toBe(true);
  });

  it("false a más de 15 minutos del cierre", () => {
    // 19:00 UTC = 15:00 ET, una hora antes del cierre
    expect(isMarketCloseNear(new Date("2026-07-21T19:00:00Z"))).toBe(false);
  });

  it("false ya cerrado el mercado (después de las 16:00 ET)", () => {
    expect(isMarketCloseNear(new Date("2026-07-21T20:30:00Z"))).toBe(false);
  });

  it("false en fin de semana", () => {
    // sábado a 15 min del "cierre" no cuenta
    expect(isMarketCloseNear(new Date("2026-07-25T19:50:00Z"))).toBe(false);
  });

  it("acepta un umbral custom de minutos", () => {
    // 19:30 UTC = 15:30 ET, 30 min antes del cierre
    expect(isMarketCloseNear(new Date("2026-07-21T19:30:00Z"), 30)).toBe(true);
    expect(isMarketCloseNear(new Date("2026-07-21T19:30:00Z"), 15)).toBe(false);
  });
});

describe("isFuturesMarketOpen", () => {
  it("abierto un martes a media mañana ET (misma sesión regular)", () => {
    expect(isFuturesMarketOpen(new Date("2026-07-21T14:00:00Z"))).toBe(true);
  });

  it("abierto un martes de noche — a diferencia de isMarketOpen, que ya cerró", () => {
    // 02:00 UTC del miércoles = 22:00 ET del martes
    expect(isMarketOpen(new Date("2026-07-22T02:00:00Z"))).toBe(false);
    expect(isFuturesMarketOpen(new Date("2026-07-22T02:00:00Z"))).toBe(true);
  });

  it("cerrado durante la pausa de mantenimiento diaria (17:00-18:00 ET)", () => {
    expect(isFuturesMarketOpen(new Date("2026-07-21T21:30:00Z"))).toBe(false); // 17:30 ET
    expect(isFuturesMarketOpen(new Date("2026-07-21T22:00:00Z"))).toBe(true); // 18:00 ET, ya reabrió
  });

  it("cerrado todo el sábado", () => {
    expect(isFuturesMarketOpen(new Date("2026-07-25T15:00:00Z"))).toBe(false); // 11:00 ET sábado
  });

  it("cierra el viernes a las 17:00 ET y no reabre hasta el domingo 18:00 ET", () => {
    // 2026-07-24 es viernes, 2026-07-26 es domingo.
    expect(isFuturesMarketOpen(new Date("2026-07-24T20:00:00Z"))).toBe(true); // 16:00 ET viernes, todavía abierto
    expect(isFuturesMarketOpen(new Date("2026-07-24T21:00:00Z"))).toBe(false); // 17:00 ET viernes, cierra
    expect(isFuturesMarketOpen(new Date("2026-07-26T21:00:00Z"))).toBe(false); // 17:00 ET domingo, todavía cerrado
    expect(isFuturesMarketOpen(new Date("2026-07-26T22:00:00Z"))).toBe(true); // 18:00 ET domingo, reabre
  });
});
