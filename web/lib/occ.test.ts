import { describe, expect, it } from "vitest";
import { buildOccSymbol, daysToExpiration, parseOcc } from "./occ";

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

describe("buildOccSymbol", () => {
  it("arma el símbolo inverso a parseOcc (put TSLA)", () => {
    expect(
      buildOccSymbol({ underlying: "TSLA", expiration: "2026-11-20", type: "put", strike: 305 }),
    ).toBe("TSLA261120P00305000");
  });

  it("arma un call con root de 4+ letras (SPXW)", () => {
    expect(
      buildOccSymbol({ underlying: "SPXW", expiration: "2026-07-23", type: "put", strike: 7400 }),
    ).toBe("SPXW260723P07400000");
  });

  it("arma un strike con decimales (352.5)", () => {
    expect(
      buildOccSymbol({ underlying: "TSLA", expiration: "2026-07-24", type: "put", strike: 352.5 }),
    ).toBe("TSLA260724P00352500");
  });

  it("hace round-trip con parseOcc para varios símbolos reales", () => {
    for (const symbol of ["TSLA261120P00305000", "SPXW260723P07400000", "TSLA260724P00352500"]) {
      const info = parseOcc(symbol);
      expect(info).not.toBeNull();
      expect(buildOccSymbol(info!)).toBe(symbol);
    }
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
