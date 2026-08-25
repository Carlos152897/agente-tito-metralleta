import { describe, it, expect } from "vitest";
import { searchSp500, SP500, SP500_TICKERS } from "./sp500";

describe("SP500", () => {
  it("tiene 503 constituyentes, sin duplicados", () => {
    expect(SP500.length).toBe(503);
    expect(SP500_TICKERS.size).toBe(503);
  });
});

describe("searchSp500", () => {
  it("encuentra por ticker exacto primero", () => {
    const r = searchSp500("AAPL");
    expect(r[0]).toEqual({ ticker: "AAPL", name: "Apple Inc." });
  });

  it("encuentra por ticker parcial", () => {
    const r = searchSp500("MSF");
    expect(r.some((c) => c.ticker === "MSFT")).toBe(true);
  });

  it("encuentra por nombre de empresa aunque no sepas el ticker", () => {
    const r = searchSp500("apple");
    expect(r[0]).toEqual({ ticker: "AAPL", name: "Apple Inc." });
  });

  it("nombre que empieza con la búsqueda va antes que uno que solo la contiene", () => {
    const r = searchSp500("gold");
    expect(r[0].name.toLowerCase().startsWith("gold")).toBe(true);
  });

  it("cadena vacía no devuelve nada", () => {
    expect(searchSp500("")).toEqual([]);
  });

  it("respeta el límite", () => {
    expect(searchSp500("a", 3)).toHaveLength(3);
  });
});
