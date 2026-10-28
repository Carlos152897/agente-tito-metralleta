import { describe, expect, it } from "vitest";
import { hybridFromAlert, hybridFromMoney, hybridFromReplay, hybridSummary, resolveHybrid } from "./visionFuturaHybrid";

const at = (hhmm: string) => Date.parse(`2026-10-27T${hhmm}:00-04:00`);
const levels = [
  { kind: "magneto" as const, spx: 7700, label: "Magneto" },
  { kind: "piso" as const, spx: 7675, label: "Piso" },
  { kind: "resistencia" as const, spx: 7730, label: "Resistencia" },
];
const alert = (lvl: number, side: "largo" | "corto", entry: number) => ({
  id: `a:${lvl}`, title: `alerta ${lvl}`, level: { spx: lvl },
  order: { side, entry: { spx: entry }, stop: { spx: side === "largo" ? entry - 3 : entry + 3 } },
});

describe("motor híbrido · alertas", () => {
  it("bloquea antes de las 9:45", () => {
    const r = hybridFromAlert(alert(7680, "largo", 7684), { at: at("09:41"), keyLevels: levels, scale: 1 });
    expect(r.trade).toBeNull();
    expect(r.blocked?.reason).toContain("9:45");
  });
  it("bloquea si el nivel está a ≤ 5 pts del Magneto", () => {
    const r = hybridFromAlert(alert(7695, "largo", 7699), { at: at("10:33"), keyLevels: levels, scale: 1 });
    expect(r.blocked?.reason).toContain("Magneto");
  });
  it("el Magneto se escala por instrumento", () => {
    const r = hybridFromAlert(alert(7690, "largo", 7694), { at: at("10:33"), keyLevels: levels, scale: 3 });
    expect(r.trade).toBeNull(); // 10 pts ≤ 5 × 3
  });
  it("stop 2× y objetivo 1.5× del scalp", () => {
    const r = hybridFromAlert(alert(7680, "largo", 7684), { at: at("10:10"), keyLevels: levels, scale: 1 });
    expect(r.trade).toMatchObject({ entry: 7684, stop: 7678, target: 7688.5, riskPts: 6, rewardPts: 4.5 });
  });
});

describe("motor híbrido · señal del dinero", () => {
  const sig = (side: "largo" | "corto", entry: number, target: number) => ({ id: "s", side, entry, stop: side === "largo" ? entry - 6 : entry + 6, target, targetLabel: "obj", openedAt: at("10:16") });
  it("bloquea un SHORT con un piso en el camino del objetivo", () => {
    const r = hybridFromMoney(sig("corto", 7682, 7650), { keyLevels: levels });
    expect(r.trade).toBeNull();
    expect(r.blocked?.reason).toContain("Piso 7675");
  });
  it("deja pasar si no hay niveles en contra en el camino", () => {
    const r = hybridFromMoney(sig("largo", 7710, 7725), { keyLevels: levels });
    expect(r.trade).toMatchObject({ entry: 7710, target: 7725, source: "senal" });
  });
});

describe("resolver y repetición", () => {
  const tr = hybridFromAlert(alert(7680, "largo", 7684), { at: at("10:10"), keyLevels: levels, scale: 1 }).trade!;
  it("misma vela con stop y objetivo = stop; si no toca nada y cerró, sale al cierre", () => {
    expect(resolveHybrid(tr, [{ t: at("10:11"), high: 7690, low: 7677 }], true).outcome).toBe("stop");
    expect(resolveHybrid(tr, [{ t: at("10:11"), high: 7689, low: 7680 }], true)).toMatchObject({ outcome: "objetivo", points: 4.5 });
    expect(resolveHybrid(tr, [{ t: at("10:11"), v: 7685 }], false).outcome).toBeNull();
    expect(resolveHybrid(tr, [{ t: at("10:11"), v: 7685 }], true)).toMatchObject({ outcome: "cierre", points: 1 });
  });
  it("arma el día completo desde una repetición y guarda las bloqueadas", () => {
    const day = hybridFromReplay({
      scale: 1,
      ticks: [{ time: at("09:30") / 1000, keyLevels: levels }],
      alerts: [{ ...alert(7680, "largo", 7684), firedAt: at("10:10") }, { ...alert(7700, "corto", 7697), firedAt: at("10:38") }, { ...alert(7680, "largo", 7684), firedAt: at("09:35") }],
      moneyTrades: [{ id: "m", side: "corto", entry: 7682, stop: 7692, target: 7650, targetLabel: "Magneto", openedAt: at("10:16") }],
    });
    expect(day.alerts).toHaveLength(1);
    expect(day.money).toHaveLength(0);
    expect(day.blocked).toHaveLength(3);
    expect(hybridSummary(day.alerts)).toMatchObject({ n: 1, closed: 0 });
  });
});

describe("sin operaciones contrarias entre las dos tarjetas (28-oct)", () => {
  const far = [{ kind: "magneto" as const, spx: 7600, label: "Magneto" }];
  const longSig = { id: "m", side: "largo" as const, entry: 7730.3, stop: 7723, target: 7740, targetLabel: "Barra más grande", openedAt: at("09:45") };
  it("con un LARGO de la señal abierto, la alerta CORTO se bloquea", () => {
    const open = [hybridFromMoney(longSig, { keyLevels: far }).trade!];
    const r = hybridFromAlert(alert(7730, "corto", 7728.18), { at: at("09:46"), keyLevels: far, scale: 1, open });
    expect(r.trade).toBeNull();
    expect(r.blocked?.reason).toContain("LARGO abierto");
    expect(r.blocked?.reason).toContain("09:45");
  });
  it("del mismo lado sí deja pasar, y si la contraria ya cerró también", () => {
    const open = [hybridFromMoney(longSig, { keyLevels: far }).trade!];
    expect(hybridFromAlert(alert(7725, "largo", 7728), { at: at("09:50"), keyLevels: far, scale: 1, open }).trade).not.toBeNull();
    const closed = [{ ...open[0], outcome: "stop" as const }];
    expect(hybridFromAlert(alert(7730, "corto", 7728.18), { at: at("09:50"), keyLevels: far, scale: 1, open: closed }).trade).not.toBeNull();
  });
  it("en la repetición mira qué seguía abierto con el precio", () => {
    const base = { scale: 1, ticks: [{ time: at("09:30") / 1000, keyLevels: far }], moneyTrades: [longSig] };
    const corto = { ...alert(7730, "corto", 7728.18), firedAt: at("09:50") };
    // sigue abierto → bloquea
    expect(hybridFromReplay({ ...base, alerts: [corto], priceSeries: [{ time: at("09:47") / 1000, value: 7729 }] }).alerts).toHaveLength(0);
    // el LARGO tocó su stop 7723 a las 9:47 → el corto de las 9:50 pasa
    expect(hybridFromReplay({ ...base, alerts: [corto], priceSeries: [{ time: at("09:47") / 1000, value: 7722 }] }).alerts).toHaveLength(1);
  });
});
