import { describe, expect, it } from "vitest";
import {
  isMarketCloseNear,
  isMarketOpen,
  isWithinOpeningMinutes,
  marketStatusLabel,
  minutesUntilClose,
} from "./marketHours";

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

describe("isWithinOpeningMinutes", () => {
  it("true justo a la apertura (9:30 ET)", () => {
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:30:00Z"))).toBe(true);
  });

  it("true a los 14 minutos de abrir", () => {
    // 13:44 UTC = 9:44 ET
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:44:00Z"))).toBe(true);
  });

  it("false a los 15 minutos exactos (límite exclusivo)", () => {
    // 13:45 UTC = 9:45 ET
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:45:00Z"))).toBe(false);
  });

  it("false más tarde en el día", () => {
    expect(isWithinOpeningMinutes(new Date("2026-07-21T14:00:00Z"))).toBe(false);
  });

  it("false antes de que abra", () => {
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:00:00Z"))).toBe(false);
  });

  it("false en fin de semana", () => {
    expect(isWithinOpeningMinutes(new Date("2026-07-25T13:35:00Z"))).toBe(false);
  });

  it("acepta un umbral custom de minutos", () => {
    // 13:50 UTC = 9:50 ET, 20 min después de abrir
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:50:00Z"), 30)).toBe(true);
    expect(isWithinOpeningMinutes(new Date("2026-07-21T13:50:00Z"), 15)).toBe(false);
  });
});

describe("minutesUntilClose", () => {
  it("faltan 6 horas (360 min) a media mañana", () => {
    // 14:00 UTC = 10:00 ET
    expect(minutesUntilClose(new Date("2026-07-21T14:00:00Z"))).toBe(360);
  });

  it("faltan 14 minutos justo antes del cierre", () => {
    // 19:46 UTC = 15:46 ET
    expect(minutesUntilClose(new Date("2026-07-21T19:46:00Z"))).toBe(14);
  });

  it("0 justo al cierre y después", () => {
    expect(minutesUntilClose(new Date("2026-07-21T20:00:00Z"))).toBe(0);
    expect(minutesUntilClose(new Date("2026-07-21T21:00:00Z"))).toBe(0);
  });

  it("0 en fin de semana", () => {
    expect(minutesUntilClose(new Date("2026-07-25T15:00:00Z"))).toBe(0);
  });
});
