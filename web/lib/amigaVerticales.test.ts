import { describe, expect, it } from "vitest";
import { alVencer, anios, bsPrecio, calificarCierre, evaluar, seguimiento, type Cotizacion, type Jugada } from "./amigaVerticales";

/** Cadena sintética con OI asimétrico (sin empates). Resultados esperados = salida del script original
 *  sombra1a5DTE.py corrido sobre la MISMA cadena (comando `leer`), verificado el 2026-10-22. */
function cadena(spot: number, dias: number, iv0: number): Cotizacion[] {
  const out: Cotizacion[] = [];
  const base = Math.floor(spot / 5) * 5;
  for (let k = base - 200; k < base + 205; k += 5) for (const tipo of ["put", "call"] as const) {
    const p = bsPrecio(spot, k, anios(dias), iv0 + (tipo === "put" ? 0.0004 * Math.max(0, spot - k) : 0), tipo);
    const sp = Math.max(0.05, p * 0.04);
    const oi = Math.round((k % 25 === 0 ? 2500 : 900) * (tipo === "put" ? 1.3 : 1) + ((k * 7) % 113) + (tipo === "put" ? 50 : 0));
    const r2 = (x: number) => Math.round(x * 100) / 100;
    out.push({ strike: k, tipo, bid: r2(Math.max(0, p - sp / 2)), ask: r2(p + sp / 2), oi });
  }
  return out;
}

describe("evaluar — paridad con el script original", () => {
  it("plazo 1 (1.25 días): vender call 7875/7885 por $1.19", () => {
    const r = evaluar(cadena(7810, 1.25, 0.14), 7810, "2026-10-22", "2026-10-23", "10:00", 1.25, []);
    expect((r.iv! * 100).toFixed(1)).toBe("14.1");
    expect(Math.round(r.sigma!)).toBe(64);
    expect(r.niveles).toMatchObject({ iman: 7800, muroPut: [7775, expect.any(Number)], muroCall: [7825, expect.any(Number)] });
    expect(r.jugadas).toHaveLength(1);
    expect(r.jugadas[0]).toMatchObject({ lado: "call", corto: 7875, largo: 7885, credito: 1.19 });
  });

  it("plazo 2 (4.25 días): vender call 7940/7955 por $1.72", () => {
    const r = evaluar(cadena(7810, 4.25, 0.15), 7810, "2026-10-22", "2026-10-26", "10:00", 4.25, []);
    expect(Math.round(r.sigma!)).toBe(127);
    expect(r.jugadas[0]).toMatchObject({ lado: "call", corto: 7940, largo: 7955, credito: 1.72 });
  });

  it("compuerta N: un FOMC antes del vencimiento bloquea; a las 15:30 el de hoy ya no cuenta", () => {
    const cot = cadena(7810, 1.25, 0.14);
    const bloq = evaluar(cot, 7810, "2026-10-22", "2026-10-23", "10:00", 1.25, [{ fecha: "2026-10-23", tipo: "FOMC" }]);
    expect(bloq.jugadas).toHaveLength(0);
    expect(bloq.mejorRechazado!.comp.find((c) => c.id === "N")).toMatchObject({ ok: false, detalle: "FOMC el 2026-10-23" });
    const hoy1530 = evaluar(cot, 7810, "2026-10-22", "2026-10-23", "15:30", 1.02, [{ fecha: "2026-10-22", tipo: "CPI" }]);
    expect(hoy1530.mejorRechazado?.comp.find((c) => c.id === "N")?.ok ?? true).toBe(true);
  });
});

const jugada = (o: Partial<Jugada> = {}): Jugada => ({
  id: "x", fecha: "2026-10-22", hora: "10:00", plazo: 1, vencimiento: "2026-10-23", lado: "put",
  corto: 7600, largo: 7590, ancho: 10, credito: 1.2, spotEntrada: 7660, ivEntrada: 0.15,
  estado: "abierta", cerradaEl: null, resultado: null, salida: "", ...o,
});
const q = (tipo: "put" | "call", strike: number, bid: number, ask: number): Cotizacion => ({ tipo, strike, bid, ask, oi: 1000 });

describe("salidas", () => {
  it("toma de ganancia si recomprar cuesta ≤ 50% del crédito", () => {
    const r = seguimiento(jugada(), [q("put", 7600, 0.5, 0.6), q("put", 7590, 0.1, 0.15)], 7650);
    expect(r).toMatchObject({ estado: "ganancia", pnl: 70 }); // 1.20 − 0.50
  });
  it("stop si el precio cruzó el corto", () => {
    const r = seguimiento(jugada(), [q("put", 7600, 6, 6.5), q("put", 7590, 2, 2.2)], 7595);
    expect(r).toMatchObject({ estado: "stop", pnl: -330 }); // 1.20 − 4.50
  });
  it("al vencer: crédito − intrínseco (tope en el ancho)", () => {
    expect(alVencer(jugada(), 7650)).toBe(120);
    expect(alVencer(jugada(), 7595)).toBe(-380);
    expect(alVencer(jugada(), 7500)).toBe(-880);
  });
  it("calificarCierre: vence → resultado; el mismo día de la entrada no hace stop estimado", () => {
    const a = jugada({ vencimiento: "2026-10-22" });
    const b = jugada({ id: "y", vencimiento: "2026-10-26" });
    calificarCierre([a, b], "2026-10-22", 7590);
    expect(a).toMatchObject({ estado: "vencida", resultado: -880 });
    expect(b.estado).toBe("abierta");
  });
});
