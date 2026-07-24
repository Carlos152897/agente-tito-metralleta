import { describe, expect, it } from "vitest";
import { daysToExpiration, parseOcc } from "./occ";

describe("parseOcc", () => {
  it("parsea un put OCC real (TSLA)", () => {
    expect(parseOcc("TSLA261120P00305000")).toEqual({
      underlying: "TSLA",
      expiration: "2026-11-20",
      type: "put",
      strike: 305,
    });
  });

  it("parsea un call con root de 4+ letras (SPXW)", () => {
    expect(parseOcc("SPXW260723P07400000")).toEqual({
      underlying: "SPXW",
      expiration: "2026-07-23",
      type: "put",
      strike: 7400,
    });
  });

  it("parsea strike con decimales (352.5)", () => {
    expect(parseOcc("TSLA260724P00352500")?.strike).toBe(352.5);
  });

  it("devuelve null para símbolos inválidos", () => {
    expect(parseOcc("")).toBeNull();
    expect(parseOcc("AAPL")).toBeNull();
    expect(parseOcc("TSLA261120X00305000")).toBeNull(); // tipo inválido
  });
});

describe("daysToExpiration", () => {
  it("cuenta días hasta el vencimiento", () => {
    const now = new Date("2026-07-22T15:00:00Z"); // 11:00 ET del 22
    expect(daysToExpiration("2026-07-23", now)).toBe(1);
    expect(daysToExpiration("2026-11-20", now)).toBe(121);
    expect(daysToExpiration("2026-07-22", now)).toBe(0);
  });

  it("usa el día del MERCADO (ET), no el UTC", () => {
    // 01:00 UTC del 24 = todavía 21:00 ET del 23 → el 24 vence "mañana", no "hoy"
    const nocheET = new Date("2026-07-24T01:00:00Z");
    expect(daysToExpiration("2026-07-24", nocheET)).toBe(1);
    expect(daysToExpiration("2026-07-23", nocheET)).toBe(0);
    expect(daysToExpiration("2026-07-22", nocheET)).toBe(-1);
  });
});
