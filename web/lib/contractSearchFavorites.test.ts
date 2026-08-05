import { describe, expect, it } from "vitest";
import {
  buildEntry,
  pruneExpired,
  remove,
  sortEntries,
  togglePinned,
  upsert,
  type ContractSearchFavoriteEntry,
  type EntrySource,
} from "./contractSearchFavorites";

const NOW = new Date("2026-07-28T20:00:00Z");

function source(overrides: Partial<EntrySource> = {}): EntrySource {
  return {
    symbol: "SPY260729C00742000",
    ticker: "SPY",
    type: "call",
    strike: 742,
    expiration: "2026-07-29",
    assetPrice: 741.21,
    premium: 551_327,
    size: 1921,
    target: 744.36,
    convictionPct: 61,
    changePctToTarget: 0.4,
    estUsdGain: 148,
    ...overrides,
  };
}

describe("buildEntry", () => {
  it("arma la entrada con la foto del momento, sin blindaje", () => {
    const entry = buildEntry(source(), NOW);
    expect(entry?.symbol).toBe("SPY260729C00742000");
    expect(entry?.addedAt).toBe(NOW.toISOString());
    expect(entry?.pinned).toBe(false);
  });

  it("null sin strike o sin vencimiento", () => {
    expect(buildEntry(source({ strike: null }), NOW)).toBeNull();
    expect(buildEntry(source({ expiration: null }), NOW)).toBeNull();
  });

  it("gexReference null por defecto (acciones); pasa el valor si viene (SPY/SPX/QQQ)", () => {
    expect(buildEntry(source(), NOW)?.gexReference).toBeNull();
    const ref = { direction: "up" as const, kingStrike: 750, confidence: 62, regime: "positive" as const };
    expect(buildEntry(source({ gexReference: ref }), NOW)?.gexReference).toEqual(ref);
  });
});

describe("upsert", () => {
  it("no pisa la foto original si el símbolo ya existe", () => {
    const first = buildEntry(source({ target: 744.36 }), NOW)!;
    const later = buildEntry(source({ target: 999 }), new Date("2026-07-29T00:00:00Z"))!;
    const entries = upsert([first], later);
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe(744.36);
  });
});

describe("remove / togglePinned", () => {
  it("remove saca por símbolo sin tocar las demás", () => {
    const a = buildEntry(source({ symbol: "AAAA" }), NOW)!;
    const b = buildEntry(source({ symbol: "BBBB" }), NOW)!;
    expect(remove([a, b], "AAAA").map((e) => e.symbol)).toEqual(["BBBB"]);
  });

  it("togglePinned prende y apaga el blindaje de una sola entrada", () => {
    const a = buildEntry(source({ symbol: "AAAA" }), NOW)!;
    const b = buildEntry(source({ symbol: "BBBB" }), NOW)!;
    const pinned = togglePinned([a, b], "AAAA");
    expect(pinned.find((e) => e.symbol === "AAAA")?.pinned).toBe(true);
    expect(pinned.find((e) => e.symbol === "BBBB")?.pinned).toBe(false);
    expect(togglePinned(pinned, "AAAA").find((e) => e.symbol === "AAAA")?.pinned).toBe(false);
  });
});

describe("sortEntries", () => {
  it("las más recientes primero", () => {
    const older = buildEntry(source({ symbol: "AAAA" }), new Date("2026-07-27T00:00:00Z"))!;
    const newer = buildEntry(source({ symbol: "BBBB" }), new Date("2026-07-28T00:00:00Z"))!;
    expect(sortEntries([older, newer]).map((e) => e.symbol)).toEqual(["BBBB", "AAAA"]);
  });
});

describe("pruneExpired", () => {
  const pin = (e: ContractSearchFavoriteEntry, pinned: boolean): ContractSearchFavoriteEntry => ({ ...e, pinned });

  it("saca los contratos ya vencidos (expiration < hoy)", () => {
    const old = buildEntry(source({ symbol: "OLD", expiration: "2026-07-24" }), NOW)!;
    const fresh = buildEntry(source({ symbol: "FRESH", expiration: "2026-07-31" }), NOW)!;
    expect(pruneExpired([old, fresh], "2026-07-30").map((e) => e.symbol)).toEqual(["FRESH"]);
  });

  it("conserva los que vencen HOY (0DTE), solo saca lo que ya quedó atrás", () => {
    const today = buildEntry(source({ symbol: "TODAY", expiration: "2026-07-30" }), NOW)!;
    expect(pruneExpired([today], "2026-07-30").map((e) => e.symbol)).toEqual(["TODAY"]);
  });

  it("los 📌 Mantenidos no se purgan aunque estén vencidos", () => {
    const old = pin(buildEntry(source({ symbol: "OLD", expiration: "2026-07-24" }), NOW)!, true);
    expect(pruneExpired([old], "2026-07-30").map((e) => e.symbol)).toEqual(["OLD"]);
  });
});
