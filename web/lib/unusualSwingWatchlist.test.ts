import { describe, expect, it } from "vitest";
import { buildEntry, remove, sortEntries, togglePinned, upsert, type EntrySource } from "./unusualSwingWatchlist";

const NOW = new Date("2026-07-22T21:00:00Z");

function source(overrides: Partial<EntrySource> = {}): EntrySource {
  return {
    symbol: "TSLA260810C00330000",
    ticker: "TSLA",
    type: "call",
    strike: 330,
    expiration: "2026-08-10",
    dte: 19,
    assetPrice: 310,
    volume: 500,
    openInterest: 100,
    premium: 250_000,
    delta: 0.35,
    ...overrides,
  };
}

describe("buildEntry", () => {
  it("arma la entrada con la foto del momento", () => {
    const entry = buildEntry(source(), NOW);
    expect(entry.symbol).toBe("TSLA260810C00330000");
    expect(entry.assetPriceAtDetection).toBe(310);
    expect(entry.addedAt).toBe(NOW.toISOString());
  });

  it("arranca sin blindaje (pinned=false)", () => {
    expect(buildEntry(source(), NOW).pinned).toBe(false);
  });
});

describe("togglePinned", () => {
  it("prende el blindaje de la entrada pedida, sin tocar las demás", () => {
    const a = buildEntry(source({ symbol: "AAAA260810C00100000" }), NOW);
    const b = buildEntry(source({ symbol: "BBBB260810C00100000" }), NOW);
    const entries = togglePinned([a, b], "AAAA260810C00100000");
    expect(entries.find((e) => e.symbol === "AAAA260810C00100000")?.pinned).toBe(true);
    expect(entries.find((e) => e.symbol === "BBBB260810C00100000")?.pinned).toBe(false);
  });

  it("apaga el blindaje si ya estaba prendido (toggle)", () => {
    const a = { ...buildEntry(source(), NOW), pinned: true };
    expect(togglePinned([a], a.symbol)[0].pinned).toBe(false);
  });
});

describe("upsert", () => {
  it("agrega una entrada nueva primero", () => {
    const entries = upsert([], buildEntry(source(), NOW));
    expect(entries).toHaveLength(1);
  });

  it("no pisa la foto original si el símbolo ya existe", () => {
    const first = buildEntry(source({ premium: 250_000 }), NOW);
    const later = buildEntry(source({ premium: 999_999 }), new Date("2026-07-23T00:00:00Z"));
    const entries = upsert([first], later);
    expect(entries).toHaveLength(1);
    expect(entries[0].premium).toBe(250_000); // sigue siendo la foto original
  });
});

describe("remove", () => {
  it("saca la entrada por símbolo (el 'no me gusta')", () => {
    const entries = upsert([], buildEntry(source(), NOW));
    expect(remove(entries, "TSLA260810C00330000")).toHaveLength(0);
  });

  it("no toca las demás", () => {
    const a = buildEntry(source({ symbol: "AAAA260810C00100000" }), NOW);
    const b = buildEntry(source({ symbol: "BBBB260810C00100000" }), NOW);
    const entries = remove([a, b], "AAAA260810C00100000");
    expect(entries.map((e) => e.symbol)).toEqual(["BBBB260810C00100000"]);
  });
});

describe("sortEntries", () => {
  it("las más recientes primero", () => {
    const older = buildEntry(source({ symbol: "AAAA260810C00100000" }), new Date("2026-07-20T00:00:00Z"));
    const newer = buildEntry(source({ symbol: "BBBB260810C00100000" }), new Date("2026-07-22T00:00:00Z"));
    expect(sortEntries([older, newer]).map((e) => e.symbol)).toEqual([
      "BBBB260810C00100000",
      "AAAA260810C00100000",
    ]);
  });
});
