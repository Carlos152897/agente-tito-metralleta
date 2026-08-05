import { describe, expect, it } from "vitest";
import { buildLike, markLikeSynced, mergeLikes, pendingLikes, removeLike, sortLikes, upsertLike } from "./contractSearchLikes";

const NOW = new Date("2026-07-28T15:00:00Z");

describe("buildLike", () => {
  it("arma la entrada con syncedAt null", () => {
    const entry = buildLike(
      { symbol: "SPY260731P00750000", ticker: "SPY", type: "put", strike: 750, expiration: "2026-07-31" },
      NOW,
    );
    expect(entry).toEqual({
      symbol: "SPY260731P00750000",
      ticker: "SPY",
      type: "put",
      strike: 750,
      expiration: "2026-07-31",
      likedAt: NOW.toISOString(),
      syncedAt: null,
    });
  });

  it("null sin strike o sin vencimiento", () => {
    expect(buildLike({ symbol: "X", ticker: "X", type: "call", strike: null, expiration: "2026-07-31" }, NOW)).toBeNull();
    expect(buildLike({ symbol: "X", ticker: "X", type: "call", strike: 100, expiration: null }, NOW)).toBeNull();
  });
});

describe("upsertLike / removeLike", () => {
  it("no pisa una entrada ya sincronizada al volver a marcarla", () => {
    const synced = { ...buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!, syncedAt: NOW.toISOString() };
    const again = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    expect(upsertLike([synced], again)).toEqual([synced]);
  });

  it("agrega una entrada nueva al principio", () => {
    const a = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const b = buildLike({ symbol: "B", ticker: "B", type: "put", strike: 2, expiration: "2026-07-31" }, NOW)!;
    expect(upsertLike([a], b)).toEqual([b, a]);
  });

  it("remove saca por símbolo", () => {
    const a = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    expect(removeLike([a], "A")).toEqual([]);
  });
});

describe("pendingLikes / markLikeSynced", () => {
  it("pendingLikes solo devuelve los que no tienen syncedAt", () => {
    const a = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const b = { ...buildLike({ symbol: "B", ticker: "B", type: "put", strike: 2, expiration: "2026-07-31" }, NOW)!, syncedAt: NOW.toISOString() };
    expect(pendingLikes([a, b])).toEqual([a]);
  });

  it("markLikeSynced marca solo los símbolos pedidos y no pisa uno ya sincronizado", () => {
    const later = new Date("2026-07-28T16:00:00Z");
    const a = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const b = { ...buildLike({ symbol: "B", ticker: "B", type: "put", strike: 2, expiration: "2026-07-31" }, NOW)!, syncedAt: NOW.toISOString() };
    const result = markLikeSynced([a, b], ["A", "B"], later);
    expect(result[0].syncedAt).toBe(later.toISOString());
    expect(result[1].syncedAt).toBe(NOW.toISOString()); // b ya estaba sincronizado, no se toca
  });
});

describe("mergeLikes", () => {
  it("no pierde un 'me gusta' hecho desde otro navegador (el bug real: PUT de reemplazo ciego)", () => {
    // Escenario real: desktop sincronizó SPY y quedó synced; el celular manda
    // su propia lista (que nunca tuvo SPY) con AMD nuevo. El merge no debe
    // perder SPY.
    const spy = { ...buildLike({ symbol: "SPY", ticker: "SPY", type: "call", strike: 742, expiration: "2026-07-29" }, NOW)!, syncedAt: NOW.toISOString() };
    const amd = buildLike({ symbol: "AMD", ticker: "AMD", type: "put", strike: 457.5, expiration: "2026-07-29" }, NOW)!;
    expect(mergeLikes([spy], [amd]).map((e) => e.symbol).sort()).toEqual(["AMD", "SPY"]);
  });

  it("si un lado tiene syncedAt y el otro no, gana el sincronizado", () => {
    const pending = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const synced = { ...pending, syncedAt: NOW.toISOString() };
    expect(mergeLikes([pending], [synced])[0].syncedAt).toBe(NOW.toISOString());
    expect(mergeLikes([synced], [pending])[0].syncedAt).toBe(NOW.toISOString());
  });

  it("si ninguno está sincronizado, gana el más reciente por likedAt", () => {
    const older = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const newer = buildLike(
      { symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" },
      new Date("2026-07-28T16:00:00Z"),
    )!;
    expect(mergeLikes([older], [newer])[0].likedAt).toBe(newer.likedAt);
  });
});

describe("sortLikes", () => {
  it("ordena por likedAt descendente", () => {
    const older = buildLike({ symbol: "A", ticker: "A", type: "call", strike: 1, expiration: "2026-07-31" }, NOW)!;
    const newer = buildLike(
      { symbol: "B", ticker: "B", type: "put", strike: 2, expiration: "2026-07-31" },
      new Date("2026-07-28T16:00:00Z"),
    )!;
    expect(sortLikes([older, newer])).toEqual([newer, older]);
  });
});
