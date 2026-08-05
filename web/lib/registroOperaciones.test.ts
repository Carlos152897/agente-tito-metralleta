import { describe, expect, it } from "vitest";
import {
  buildEntry,
  closeEntry,
  emptyStore,
  evaluateRegistroExit,
  gammaFlipCrossed,
  hasLoggedToday,
  isContinuousLogTicker,
  openEntry,
  pnlOf,
  REVERSAL_CHECK_GRACE_MINUTES,
  targetTouched,
  type RegistroOpenEntry,
  type RegistroStore,
} from "./registroOperaciones";
import type { ContractSuggestion } from "./dayTrade";

function suggestion(overrides: Partial<ContractSuggestion> = {}): ContractSuggestion {
  return {
    ticker: "SPX", occRoot: "SPXW", type: "call", strike: 7420, expiration: "2026-08-01",
    role: "continuation", reason: "test", target: 7425, spot: 7418, reversalWarning: null,
    ...overrides,
  };
}

function entry(overrides: Partial<RegistroOpenEntry> = {}): RegistroOpenEntry {
  return {
    id: "SPXW260801C07425000__2026-08-01T15:00:00.000Z",
    ticker: "SPX", occRoot: "SPXW", symbol: "SPXW260801C07425000", type: "call", strike: 7425,
    expiration: "2026-08-01", target: 7425, side: "above", signalRole: "continuation", reason: "test",
    entryPrice: 5, entrySpot: 7418, entryGammaFlip: 7400,
    enteredAt: "2026-08-01T15:00:00.000Z", dayKey: "2026-08-01",
    ...overrides,
  };
}

describe("hasLoggedToday", () => {
  it("true si hay entrada abierta hoy para ese ticker", () => {
    const store: RegistroStore = { open: [entry({ ticker: "SPX", dayKey: "2026-08-01" })], closed: [] };
    expect(hasLoggedToday(store, "SPX", "2026-08-01")).toBe(true);
  });

  it("true si ya se cerró una entrada hoy para ese ticker", () => {
    const store: RegistroStore = {
      open: [],
      closed: [{ ...entry({ ticker: "TSLA", dayKey: "2026-08-01" }), exitPrice: 6, exitSpot: 7430, exitedAt: "x", exitReason: "target", pnlUsd: 100, pnlPct: 20, outcome: "win" }],
    };
    expect(hasLoggedToday(store, "TSLA", "2026-08-01")).toBe(true);
  });

  it("false si es otro ticker u otro día", () => {
    const store: RegistroStore = { open: [entry({ ticker: "SPX", dayKey: "2026-08-01" })], closed: [] };
    expect(hasLoggedToday(store, "TSLA", "2026-08-01")).toBe(false);
    expect(hasLoggedToday(store, "SPX", "2026-07-31")).toBe(false);
  });
});

describe("buildEntry", () => {
  it("arma la entrada desde una sugerencia — side/target/símbolo OCC real", () => {
    const now = new Date("2026-08-01T15:00:00.000Z");
    const e = buildEntry(suggestion({ type: "call", strike: 7425, target: 7425 }), 5, 7400, now);
    expect(e.symbol).toBe("SPXW260801C07425000");
    expect(e.id).toBe("SPXW260801C07425000__2026-08-01T15:00:00.000Z");
    expect(e.side).toBe("above");
    expect(e.target).toBe(7425);
    expect(e.signalRole).toBe("continuation");
    expect(e.entryGammaFlip).toBe(7400);
    expect(e.dayKey).toBe("2026-08-01");
  });

  it("conserva signalRole gex_only para señales débiles (se guardan igual, confirmado con Carlos)", () => {
    const e = buildEntry(suggestion({ role: "gex_only" }), 5, 7400, new Date("2026-08-01T15:00:00Z"));
    expect(e.signalRole).toBe("gex_only");
  });

  it("side='below' para puts", () => {
    const e = buildEntry(suggestion({ type: "put" }), 5, null, new Date("2026-08-01T15:00:00Z"));
    expect(e.side).toBe("below");
  });
});

describe("pnlOf", () => {
  it("ganancia y pérdida en $/%", () => {
    expect(pnlOf(5, 6)).toEqual({ usd: 100, pct: 20 });
    expect(pnlOf(5, 4)).toEqual({ usd: -100, pct: -20 });
  });
});

describe("targetTouched", () => {
  it("side='above': tocado cuando el spot llega o supera el target", () => {
    expect(targetTouched({ side: "above", target: 7425 }, 7425)).toBe(true);
    expect(targetTouched({ side: "above", target: 7425 }, 7430)).toBe(true);
    expect(targetTouched({ side: "above", target: 7425 }, 7420)).toBe(false);
  });

  it("side='below': tocado cuando el spot llega o cae debajo del target", () => {
    expect(targetTouched({ side: "below", target: 7400 }, 7400)).toBe(true);
    expect(targetTouched({ side: "below", target: 7400 }, 7395)).toBe(true);
    expect(targetTouched({ side: "below", target: 7400 }, 7410)).toBe(false);
  });
});

describe("gammaFlipCrossed", () => {
  it("false sin gamma flip real de algún lado (TSLA, sin GEX)", () => {
    expect(gammaFlipCrossed(7418, null, 7430, 7400)).toBe(false);
    expect(gammaFlipCrossed(7418, 7400, 7430, null)).toBe(false);
  });

  it("false si el spot sigue del mismo lado del gamma flip", () => {
    expect(gammaFlipCrossed(7418, 7400, 7430, 7405)).toBe(false); // arriba en ambos momentos
  });

  it("true si el spot pasó de un lado al otro del gamma flip (rebalanceo)", () => {
    expect(gammaFlipCrossed(7418, 7400, 7395, 7400)).toBe(true); // estaba arriba, ahora abajo
    expect(gammaFlipCrossed(7395, 7400, 7418, 7400)).toBe(true); // estaba abajo, ahora arriba
  });
});

describe("evaluateRegistroExit", () => {
  const ENTERED_AT = "2026-08-01T15:00:00.000Z";
  const AFTER_GRACE = new Date("2026-08-01T15:20:00.000Z");
  const WITHIN_GRACE = new Date("2026-08-01T15:05:00.000Z");

  const base = {
    entry: entry({ enteredAt: ENTERED_AT, side: "above" as const, target: 7425, entryGammaFlip: 7400 }),
    neighborConfirming: true,
    currentGammaFlip: 7400,
    isMarketCloseNear: false,
    now: AFTER_GRACE,
  };

  it("sale por target en cuanto el spot lo toca — gana sobre cualquier otra señal", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7425 });
    expect(result).toEqual({ shouldExit: true, reason: "target" });
  });

  it("sale por reversión si los vecinos dejan de confirmar, pasado el margen de gracia", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7420, neighborConfirming: false });
    expect(result).toEqual({ shouldExit: true, reason: "reversal" });
  });

  it("sale por reversión si el gamma flip se cruzó, aunque los vecinos SÍ confirmen (cualquiera de las dos dispara)", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7395, currentGammaFlip: 7400, neighborConfirming: true });
    expect(result).toEqual({ shouldExit: true, reason: "reversal" });
  });

  it("NO sale por reversión todavía dentro del margen de gracia", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7420, neighborConfirming: false, now: WITHIN_GRACE });
    expect(result).toEqual({ shouldExit: false, reason: null });
  });

  it(`REVERSAL_CHECK_GRACE_MINUTES vale ${REVERSAL_CHECK_GRACE_MINUTES} (mismo criterio que Paper Trading)`, () => {
    expect(REVERSAL_CHECK_GRACE_MINUTES).toBe(15);
  });

  it("sale por eod si se acerca el cierre y nada más disparó todavía", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7420, isMarketCloseNear: true });
    expect(result).toEqual({ shouldExit: true, reason: "eod" });
  });

  it("eod se aplica incluso dentro del margen de gracia", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7420, isMarketCloseNear: true, now: WITHIN_GRACE });
    expect(result).toEqual({ shouldExit: true, reason: "eod" });
  });

  it("se queda abierta si nada de lo anterior aplica todavía", () => {
    const result = evaluateRegistroExit({ ...base, currentSpot: 7420 });
    expect(result).toEqual({ shouldExit: false, reason: null });
  });

  it("TSLA (sin GEX, entryGammaFlip null): la reversión solo depende del flujo de vecinos", () => {
    const tslaEntry = entry({ ticker: "TSLA", entryGammaFlip: null, enteredAt: ENTERED_AT, side: "above", target: 320 });
    const result = evaluateRegistroExit({
      entry: tslaEntry, currentSpot: 315, neighborConfirming: true, currentGammaFlip: null,
      isMarketCloseNear: false, now: AFTER_GRACE,
    });
    expect(result).toEqual({ shouldExit: false, reason: null }); // confirma, sin gamma flip real → no revierte
  });
});

describe("closeEntry / openEntry", () => {
  it("openEntry agrega a open[] sin tocar el resto", () => {
    const store = openEntry(emptyStore(), entry({ id: "A" }));
    expect(store.open.map((e) => e.id)).toEqual(["A"]);
  });

  it("closeEntry mueve de open a closed, calcula pnl y outcome='win' con ganancia", () => {
    const store = openEntry(emptyStore(), entry({ id: "A", entryPrice: 5 }));
    const closed = closeEntry(store, "A", 6, 7430, "target", new Date("2026-08-01T16:00:00Z"));
    expect(closed.open).toEqual([]);
    expect(closed.closed).toHaveLength(1);
    expect(closed.closed[0].pnlUsd).toBe(100);
    expect(closed.closed[0].outcome).toBe("win");
    expect(closed.closed[0].exitReason).toBe("target");
  });

  it("outcome='loss' cuando el precio de salida es menor al de entrada, sin importar el motivo", () => {
    const store = openEntry(emptyStore(), entry({ id: "A", entryPrice: 5 }));
    const closed = closeEntry(store, "A", 4, 7410, "reversal", new Date("2026-08-01T16:00:00Z"));
    expect(closed.closed[0].outcome).toBe("loss");
  });

  it("outcome='win' en empate exacto (pnl 0)", () => {
    const store = openEntry(emptyStore(), entry({ id: "A", entryPrice: 5 }));
    const closed = closeEntry(store, "A", 5, 7418, "eod", new Date("2026-08-01T16:00:00Z"));
    expect(closed.closed[0].outcome).toBe("win");
  });

  it("no hace nada si esa entrada no está abierta", () => {
    const store = openEntry(emptyStore(), entry({ id: "A" }));
    expect(closeEntry(store, "NOPE", 6, 7430, "target", new Date())).toEqual(store);
  });

  it("cerrar una entrada no afecta a las demás abiertas", () => {
    let store = openEntry(emptyStore(), entry({ id: "A", ticker: "SPX" }));
    store = openEntry(store, entry({ id: "B", symbol: "OTHER", ticker: "TSLA" }));
    const closed = closeEntry(store, "A", 6, 7430, "target", new Date("2026-08-01T16:00:00Z"));
    expect(closed.open.map((e) => e.id)).toEqual(["B"]);
  });

  it("dos entradas SPX pueden compartir el mismo symbol (bitácora cada 5 min) — id las distingue", () => {
    let store = openEntry(emptyStore(), entry({ id: "A", symbol: "SPXW260801C07425000", enteredAt: "2026-08-01T15:00:00Z" }));
    store = openEntry(store, entry({ id: "B", symbol: "SPXW260801C07425000", enteredAt: "2026-08-01T15:05:00Z" }));
    expect(store.open).toHaveLength(2);
    const closed = closeEntry(store, "A", 6, 7430, "target", new Date("2026-08-01T16:00:00Z"));
    expect(closed.open.map((e) => e.id)).toEqual(["B"]);
    expect(closed.closed).toHaveLength(1);
  });
});

describe("isContinuousLogTicker", () => {
  it("true para SPX (bitácora cada 5 min, pedido de Carlos 2026-08-04)", () => {
    expect(isContinuousLogTicker("SPX")).toBe(true);
  });

  it("false para TSLA (sigue una entrada por día)", () => {
    expect(isContinuousLogTicker("TSLA")).toBe(false);
  });
});
