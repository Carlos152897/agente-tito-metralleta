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
    companyName: "SPDR S&P 500 ETF Trust",
    type: "call",
    strike: 742,
    expiration: "2026-07-29",
    dte: 15,
    assetPrice: 741.21,
    premium: 1_551_327,
    size: 1921,
    volume: 900,
    openInterest: 400,
    target1: 744.36,
    convictionPct1: 61,
    changePctToTarget1: 0.4,
    estUsdGain1: 148,
    target2: 748.5,
    convictionPct2: 34,
    changePctToTarget2: 1.0,
    estUsdGain2: 320,
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

  it("newsFlag null por defecto; pasa el valor si viene", () => {
    expect(buildEntry(source(), NOW)?.newsFlag).toBeNull();
    const flag = { kind: "confirm" as const, title: "Flujo alcista confirmado por las noticias", detail: "…" };
    expect(buildEntry(source({ newsFlag: flag }), NOW)?.newsFlag).toEqual(flag);
  });
});

describe("upsert", () => {
  it("no pisa la foto original si el símbolo ya existe", () => {
    const first = buildEntry(source({ target1: 744.36 }), NOW)!;
    const later = buildEntry(source({ target1: 999 }), new Date("2026-07-29T00:00:00Z"))!;
    const entries = upsert([first], later);
    expect(entries).toHaveLength(1);
    expect(entries[0].target1).toBe(744.36);
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
