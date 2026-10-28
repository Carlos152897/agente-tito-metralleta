import { describe, expect, it } from "vitest";
import { mergeMsDay, PRESSURE_SNAP_MS, type MsFresh } from "./visionFuturaMsStore";

const base = { inst: "SPX", date: "2026-10-28", msTicker: "SPX", expiration: "2026-10-28" };
const row = (strike: number) => ({ strike, call: { single_leg: 10, multi_leg: 5 }, put: { single_leg: 8, multi_leg: 2 } });
const unusual = (id: number, ts: string) => ({ id, timestamp: ts } as MsFresh["unusual"][number]);
const fresh = (over: Partial<MsFresh> = {}): MsFresh => ({
  premium: [{ t: "2026-10-28T13:30:00.000Z", net_call_premium: 1, net_put_premium: -1, net_volume: 0 }],
  pressure: { rows: [row(7730)], totals: null },
  unusual: [unusual(1, "2026-10-28T13:51:00.000Z")],
  spot: 7734,
  ...over,
});

describe("guardado de la terminal de MarketSnack", () => {
  const t0 = Date.parse("2026-10-28T14:00:00Z");
  it("primera captura crea el día", () => {
    const d = mergeMsDay(null, base, fresh(), t0);
    expect(d).toMatchObject({ inst: "SPX", expiration: "2026-10-28" });
    expect(d.pressure).toHaveLength(1);
    expect(d.unusual).toHaveLength(1);
  });
  it("presión: una foto cada 5 min (o la final); inusuales sin repetidos y en orden", () => {
    let d = mergeMsDay(null, base, fresh(), t0);
    d = mergeMsDay(d, base, fresh({ unusual: [unusual(1, "2026-10-28T13:51:00.000Z"), unusual(0, "2026-10-28T13:40:00.000Z")] }), t0 + 60_000);
    expect(d.pressure).toHaveLength(1);
    expect(d.unusual.map((u) => u.id)).toEqual([0, 1]);
    d = mergeMsDay(d, base, fresh(), t0 + PRESSURE_SNAP_MS);
    expect(d.pressure).toHaveLength(2);
    d = mergeMsDay(d, base, fresh(), t0 + PRESSURE_SNAP_MS + 1000, true);
    expect(d.pressure).toHaveLength(3);
  });
  it("prima por minuto: no se pisa con una respuesta más corta; presión vacía no crea foto", () => {
    const long = fresh().premium.concat({ t: "2026-10-28T13:31:00.000Z", net_call_premium: 2, net_put_premium: -2, net_volume: 0 });
    let d = mergeMsDay(null, base, fresh({ premium: long }), t0);
    d = mergeMsDay(d, base, fresh({ pressure: { rows: [], totals: null } }), t0 + PRESSURE_SNAP_MS);
    expect(d.premium).toHaveLength(2);
    expect(d.pressure).toHaveLength(1);
  });
  it("si cambia el vencimiento empieza de cero", () => {
    const d1 = mergeMsDay(null, base, fresh(), t0);
    const d2 = mergeMsDay(d1, { ...base, expiration: "2026-10-29" }, fresh({ unusual: [] }), t0 + 1000);
    expect(d2.unusual).toHaveLength(0);
    expect(d2.expiration).toBe("2026-10-29");
  });
});
