import { describe, expect, it } from "vitest";
import { ALERT_TUNING, evaluateVisionAlerts, orderStillOpen, type EvaluateInput } from "./visionFuturaAlerts";
import type { DealerLevel, KeyLevel, VisionStrikeRow } from "./visionFutura";

const conversion = { spyRatio: 0.1, esBasis: 30 };
const lv = (spx: number) => ({ spx, spy: spx * 0.1, es: spx + 30 });

function row(spx: number, o: Partial<VisionStrikeRow> = {}): VisionStrikeRow {
  return {
    ...lv(spx), callGex: 0, putGex: 0, netGex: 0, charm: 0, callFlow: 0, putFlow: 0,
    compras: 0, ventas: 0, callVolume: 0, putVolume: 0, dealerCalls: null, dealerPuts: null,
    dealerRole: null, strongFlow: false, tags: [], ...o,
  };
}
const key = (kind: KeyLevel["kind"], label: string, spx: number, spot: number): KeyLevel => ({ kind, label, fuente: "", distance: spx - spot, ...lv(spx) });
const dealer = (role: DealerLevel["role"], spx: number): DealerLevel => ({ role, premium: -1e6, texto: "", ...lv(spx) });

const MIN = 60_000;
const NOW = 1_800_000_000_000;
/** Serie de precios: un valor por minuto terminando en NOW. */
const series = (vals: number[]) => vals.map((v, i) => ({ t: NOW - (vals.length - 1 - i) * MIN, v }));
const agg = (entries: [number, number, number][]) => new Map(entries.map(([s, c, v]) => [s, { compras: c, ventas: v }]));

function base(spot: number, o: Partial<EvaluateInput>): EvaluateInput {
  return {
    now: NOW, spot, conversion,
    keyLevels: [key("resistencia", "Resistencia", 7700, spot), key("piso", "Piso", 7650, spot), key("piso", "Piso", 7625, spot)],
    dealerLevels: [dealer("resistencia", 7700), dealer("piso", 7650)],
    rows: [row(7700, { callFlow: -1e6 }), row(7650, { putFlow: -5e6 }), row(7625)],
    regime: "negativo", prices: series([spot]), vix: series([19, 19]), vixMagnet: 20,
    aggressorNow: agg([]), aggressorPrev: null, ...o,
  };
}

const find = (r: ReturnType<typeof evaluateVisionAlerts>, id: string) => r.find((a) => a.id === id)!;

describe("evaluateVisionAlerts", () => {
  it("rechazo en techo: llega a 7,700, se frena, techo firme, agresor vende y VIX sube → corto", () => {
    const r = evaluateVisionAlerts(base(7693, {
      prices: series([7685, 7692, 7699, 7697, 7693]),
      vix: series([19, 19.1, 19.3]),
      aggressorPrev: agg([[7700, 10e6, 10e6]]),
      aggressorNow: agg([[7700, 10e6, 12e6]]),
    }));
    const a = find(r, "rechazo_techo:7700");
    expect(a.fires).toBe(true);
    expect(a.score).toBe(5);
    // Scalp: objetivo fijo 3 pts, stop fijo 3 pts desde la entrada.
    expect(a.order.side).toBe("corto");
    expect(a.order.stop.spx).toBe(7696);
    expect(a.target?.spx).toBe(7690);
    expect(a.order.rb).toBeCloseTo(1, 5);
    expect(a.order.stop.es).toBe(7726);
  });

  it("defensa de piso: toca 7,650 y rebota con compras y VIX bajando → largo", () => {
    const r = evaluateVisionAlerts(base(7655, {
      prices: series([7662, 7655, 7651, 7653, 7655]),
      vix: series([19.4, 19.2, 19.1]),
      aggressorPrev: agg([[7650, 5e6, 5e6]]),
      aggressorNow: agg([[7650, 8e6, 5e6]]),
    }));
    const a = find(r, "defensa_piso:7650");
    expect(a.fires).toBe(true);
    expect(a.order.side).toBe("largo");
    expect(a.order.stop.spx).toBe(7652);
    expect(a.target?.spx).toBe(7658);
  });

  it("ruptura de piso: rompe 7,650 y se sostiene abajo → corto (scalp 3 pts)", () => {
    const r = evaluateVisionAlerts(base(7645, {
      rows: [row(7700, { callFlow: -1e6 }), row(7650, { putFlow: 2e6 }), row(7625)],
      prices: series([7656, 7652, 7647, 7646, 7645]),
      vix: series([19, 19.2]),
      aggressorPrev: agg([[7650, 5e6, 5e6]]),
      aggressorNow: agg([[7650, 5e6, 7e6]]),
    }));
    const a = find(r, "ruptura_piso:7650");
    expect(a.fires).toBe(true);
    expect(a.target?.spx).toBe(7642);
    expect(a.order.stop.spx).toBe(7648);
    // la defensa del mismo piso NO dispara: el precio está abajo
    expect(find(r, "defensa_piso:7650").fires).toBe(false);
  });

  it("sin las 2 obligatorias no dispara aunque el resto se cumpla", () => {
    const r = evaluateVisionAlerts(base(7675, {
      prices: series([7672, 7674, 7675]), // nunca llegó a 7,700 ni a 7,650
      vix: series([19, 19.5]),
      aggressorPrev: agg([[7700, 1e6, 1e6]]),
      aggressorNow: agg([[7700, 1e6, 3e6]]),
    }));
    expect(r.some((a) => a.fires)).toBe(false);
    expect(find(r, "rechazo_techo:7700").conditions.find((c) => c.key === "llega")?.ok).toBe(false);
  });

  it("4 de 5 alcanza; 3 de 5 no", () => {
    const common = { prices: series([7685, 7699, 7693]) };
    // sin VIX (plano) pero con agresor → 4/5
    const four = evaluateVisionAlerts(base(7693, { ...common, aggressorPrev: agg([[7700, 1e6, 1e6]]), aggressorNow: agg([[7700, 1e6, 2e6]]) }));
    expect(find(four, "rechazo_techo:7700").score).toBe(4);
    expect(find(four, "rechazo_techo:7700").fires).toBe(true);
    // sin VIX ni agresor → 3/5
    const three = evaluateVisionAlerts(base(7693, common));
    expect(find(three, "rechazo_techo:7700").score).toBe(3);
    expect(find(three, "rechazo_techo:7700").fires).toBe(false);
  });

  it("no persigue: si el rebote ya está a más de 8 pts del piso, no dispara", () => {
    const r = evaluateVisionAlerts(base(7662, {
      prices: series([7660, 7651, 7655, 7662]),
      vix: series([19.4, 19.1]),
      aggressorPrev: agg([[7650, 1e6, 1e6]]),
      aggressorNow: agg([[7650, 3e6, 1e6]]),
    }));
    const a = find(r, "defensa_piso:7650");
    expect(a.conditions.find((c) => c.key === "reaccion")?.ok).toBe(false);
    expect(a.fires).toBe(false);
  });

  it("bloquea si hay un nivel en contra a menos del objetivo (en el camino)", () => {
    const r = evaluateVisionAlerts(base(7693, {
      keyLevels: [key("resistencia", "Resistencia", 7700, 7693), key("piso", "Piso", 7691, 7693)],
      dealerLevels: [dealer("resistencia", 7700)],
      rows: [row(7700, { callFlow: -1e6 })],
      prices: series([7685, 7699, 7693]),
      vix: series([19, 19.3]),
      aggressorPrev: agg([[7700, 1e6, 1e6]]),
      aggressorNow: agg([[7700, 1e6, 3e6]]),
    }));
    const a = find(r, "rechazo_techo:7700");
    expect(a.fires).toBe(false);
    expect(a.blocked).toMatch(/en el camino/);
  });

  it("stop por nivel (modo opcional): del otro lado del nivel + colchón", () => {
    const prev = { ...ALERT_TUNING };
    try {
      Object.assign(ALERT_TUNING, { stopMode: "nivel", stopBufferPts: 3 });
      const r = evaluateVisionAlerts(base(7693, {
        prices: series([7685, 7699, 7693]),
        vix: series([19, 19.3]),
        aggressorPrev: agg([[7700, 1e6, 1e6]]),
        aggressorNow: agg([[7700, 1e6, 3e6]]),
      }));
      expect(find(r, "rechazo_techo:7700").order.stop.spx).toBe(7703);
    } finally {
      Object.assign(ALERT_TUNING, prev);
    }
  });

  it("pisos vecinos que disparan juntos → una sola alerta (la más cercana)", () => {
    const r = evaluateVisionAlerts(base(7654, {
      keyLevels: [key("resistencia", "Resistencia", 7700, 7654), key("piso", "Piso", 7650, 7654), key("piso", "Piso", 7648, 7654)],
      dealerLevels: [dealer("piso", 7650)],
      rows: [row(7650, { putFlow: -5e6 }), row(7648, { putFlow: -2e6 })],
      prices: series([7662, 7647, 7650, 7654]),
      vix: series([19.4, 19.1]),
      aggressorPrev: agg([[7650, 1e6, 1e6]]),
      aggressorNow: agg([[7650, 3e6, 1e6]]),
    }));
    const firing = r.filter((a) => a.fires);
    expect(firing).toHaveLength(1);
    expect(firing[0].id).toBe("defensa_piso:7650");
    expect(find(r, "defensa_piso:7648").blocked).toMatch(/misma entrada/);
  });

  it("marca 'piso con trampa' cuando el strike del piso tiene GEX negativo grande", () => {
    const common = {
      prices: series([7662, 7655, 7651, 7653, 7655]),
      vix: series([19.4, 19.1]),
      aggressorPrev: agg([[7650, 5e6, 5e6]]),
      aggressorNow: agg([[7650, 8e6, 5e6]]),
    };
    const trapped = evaluateVisionAlerts(base(7655, {
      ...common,
      rows: [row(7700, { callFlow: -1e6, netGex: -1e8 }), row(7650, { putFlow: -5e6, netGex: -2.8e9 }), row(7625, { netGex: 5e8 })],
    }));
    const a = find(trapped, "defensa_piso:7650");
    expect(a.fires).toBe(true); // la advertencia no bloquea
    expect(a.trap).toMatch(/Piso con trampa fuerte: GEX −2\.80B en 7,650 \(100% del más negativo\)/);

    const clean = evaluateVisionAlerts(base(7655, {
      ...common,
      rows: [row(7700, { callFlow: -1e6, netGex: -1e8 }), row(7650, { putFlow: -5e6, netGex: 2.8e9 }), row(7625, { netGex: 5e8 })],
    }));
    expect(find(clean, "defensa_piso:7650").trap).toBeNull();
  });

  it("con escala (NQ ≈ 4.5): toque, rebote, stop y objetivo se multiplican", () => {
    const k = 4.5;
    const lvS = (v: number) => ({ spx: v, spy: null, es: null });
    const keyN = (kind: KeyLevel["kind"], label: string, spx: number): KeyLevel => ({ kind, label, fuente: "", distance: 0, ...lvS(spx) });
    const r = evaluateVisionAlerts({
      now: NOW, spot: 28970, conversion: { spyRatio: null, esBasis: null },
      keyLevels: [keyN("resistencia", "Resistencia", 29000), keyN("piso", "Piso", 28800)],
      dealerLevels: [], rows: [{ ...row(29000, { callFlow: -1e6 }), spy: null, es: null }], regime: "negativo",
      prices: series([28920, 28990, 28970]), // tocó 28,990 (≤ 13.5 del techo), retrocede 20 (≥ 13.5) y está a 30 (≤ 36)
      vix: series([19, 19.3]), vixMagnet: null,
      aggressorPrev: agg([[29000, 1e6, 1e6]]), aggressorNow: agg([[29000, 1e6, 3e6]]),
      scale: k, instrumentos: { largo: "Calls de NDX/QQQ · comprar /NQ", corto: "Puts de NDX/QQQ · vender /NQ" },
    });
    const a = find(r, "rechazo_techo:29000");
    expect(a.fires).toBe(true);
    expect(a.order.stop.spx).toBe(28970 + 13.5);
    expect(a.order.target?.spx).toBe(28970 - 13.5);
    expect(a.order.instrumento).toBe("Puts de NDX/QQQ · vender /NQ");
  });
});

describe("modo noche (🌙 /ES y /NQ)", () => {
  // De noche no hay flujo de opciones ni VIX: sin `night` la defensa se queda en 2/5.
  const nightBase = (o: Partial<EvaluateInput>) => base(7655, {
    rows: [row(7700, { netGex: -1e8 }), row(7650, { netGex: 5e9 }), row(7625, { netGex: 1e8 }), row(7600, { netGex: 2e8 })],
    prices: series([7662, 7655, 7651, 7653, 7655]),
    vix: series([15, 15]),
    ...o,
  });

  it("sin confirmaciones nocturnas la defensa de piso NO dispara (2/5)", () => {
    const a = find(evaluateVisionAlerts(nightBase({})), "defensa_piso:7650");
    expect(a.score).toBe(2);
    expect(a.fires).toBe(false);
  });

  it("con nivel con peso + agresor del futuro comprando + /VX bajando → dispara 5/5", () => {
    const a = find(evaluateVisionAlerts(nightBase({
      night: { futFlow: { symbol: "/ESZ6", buy: 80, sell: 20, minutes: 5 }, vx: { symbol: "/VXX26", from: 19.45, to: 19.4 } },
    })), "defensa_piso:7650");
    expect(a.fires).toBe(true);
    expect(a.score).toBe(5);
    const byKey = Object.fromEntries(a.conditions.map((c) => [c.key, c]));
    expect(byKey.firme.label).toBe("Nivel con peso de opciones");
    expect(byKey.agresor.label).toBe("Agresor del futuro comprando");
    expect(byKey.agresor.detail).toContain("80 comprados al ask");
    expect(byKey.vix.label).toBe("/VX bajando");
  });

  it("poco volumen o desbalance chico no cuenta como agresor", () => {
    const poco = find(evaluateVisionAlerts(nightBase({
      night: { futFlow: { symbol: "/ESZ6", buy: 15, sell: 5, minutes: 5 }, vx: null },
    })), "defensa_piso:7650");
    expect(poco.conditions.find((c) => c.key === "agresor")!.ok).toBe(false);
    const parejo = find(evaluateVisionAlerts(nightBase({
      night: { futFlow: { symbol: "/ESZ6", buy: 55, sell: 50, minutes: 5 }, vx: null },
    })), "defensa_piso:7650");
    expect(parejo.conditions.find((c) => c.key === "agresor")!.ok).toBe(false);
  });

  it("/VX: 1 tick a favor cuenta; en contra no", () => {
    const sube = find(evaluateVisionAlerts(nightBase({
      night: { futFlow: null, vx: { symbol: "/VXX26", from: 19.4, to: 19.45 } },
    })), "defensa_piso:7650");
    expect(sube.conditions.find((c) => c.key === "vix")!.ok).toBe(false);
  });

  it("de día (sin `night`) las condiciones no cambian", () => {
    const a = find(evaluateVisionAlerts(base(7655, {
      prices: series([7662, 7655, 7651, 7653, 7655]),
      vix: series([19.4, 19.2, 19.1]),
      aggressorPrev: agg([[7650, 5e6, 5e6]]),
      aggressorNow: agg([[7650, 8e6, 5e6]]),
    })), "defensa_piso:7650");
    expect(a.conditions.find((c) => c.key === "firme")!.label).toBe("Piso firme (puts vendidos)");
    expect(a.conditions.find((c) => c.key === "vix")!.label).toBe("VIX bajando");
  });
});

describe("sin alertas en sentido contrario encimadas (26-oct: 15:02 corto 7680 y 15:04 largo 7670)", () => {
  const piso = () => base(7655, {
    prices: series([7662, 7655, 7651, 7653, 7655]),
    vix: series([19.4, 19.2, 19.1]),
    aggressorPrev: agg([[7650, 5e6, 5e6]]),
    aggressorNow: agg([[7650, 8e6, 5e6]]),
  });
  // Corto disparado hace 2 min a 7,654: stop 7,657, objetivo 7,651.
  const corto = (minAgo: number, stop = 7657, target = 7651) => ({
    direction: "bajista" as const, firedAt: NOW - minAgo * MIN, title: "Rechazo en TECHO 7,680 — posible caída",
    order: { side: "corto" as const, stop: { spx: stop }, target: { spx: target } },
  });

  it("mientras el corto sigue abierto, el largo no dispara (con el motivo)", () => {
    const a = find(evaluateVisionAlerts({ ...piso(), recentFired: [corto(2)], priceHistory: series([7654, 7653, 7655]) }), "defensa_piso:7650");
    expect(a.fires).toBe(false);
    expect(a.blocked).toContain("sentido contrario a Rechazo en TECHO 7,680");
    expect(a.blocked).toContain("sigue abierta");
  });

  it("si el corto ya tocó su stop, el largo sí dispara (el mercado le dio la razón al otro lado)", () => {
    const a = find(evaluateVisionAlerts({ ...piso(), recentFired: [corto(2)], priceHistory: series([7654, 7657.5, 7655]) }), "defensa_piso:7650");
    expect(a.fires).toBe(true);
  });

  it("si el corto ya tocó su objetivo, el largo sí dispara", () => {
    const a = find(evaluateVisionAlerts({ ...piso(), recentFired: [corto(2)], priceHistory: series([7654, 7650.5, 7655]) }), "defensa_piso:7650");
    expect(a.fires).toBe(true);
  });

  it("pasados 30 min la orden vieja ya no bloquea aunque siga abierta", () => {
    const a = find(evaluateVisionAlerts({ ...piso(), recentFired: [corto(31, 7700, 7600)] }), "defensa_piso:7650");
    expect(a.fires).toBe(true);
  });

  it("una alerta abierta del MISMO lado no bloquea", () => {
    const largo = { direction: "alcista" as const, firedAt: NOW - 2 * MIN, title: "Defensa de PISO 7,625", order: { side: "largo" as const, stop: { spx: 7600 }, target: { spx: 7700 } } };
    expect(find(evaluateVisionAlerts({ ...piso(), recentFired: [largo] }), "defensa_piso:7650").fires).toBe(true);
  });

  it("orderStillOpen: corto se cierra al tocar stop u objetivo; ignora precios anteriores a la alerta", () => {
    const f = corto(5);
    expect(orderStillOpen(corto(1), series([7660, 7654, 7655]), NOW)).toBe(true); // 7660 es de antes de la alerta
    expect(orderStillOpen(f, series([7654, 7657]), NOW)).toBe(false);
    expect(orderStillOpen(f, series([7654, 7651]), NOW)).toBe(false);
  });
  // Techo 7680 y piso 7670 a la vez con el precio en medio (7675).
  const sandwich = (vix: number[]) => base(7675, {
    keyLevels: [key("resistencia", "Resistencia", 7680, 7675), key("piso", "Piso", 7670, 7675)],
    dealerLevels: [],
    rows: [row(7680, { callFlow: -1e6 }), row(7670, { putFlow: -1e6 })],
    prices: series([7681, 7678, 7669, 7672, 7675]),
    vix: series(vix),
    aggressorPrev: agg([[7680, 5e6, 5e6], [7670, 5e6, 5e6]]),
    aggressorNow: agg([[7680, 5e6, 7e6], [7670, 7e6, 5e6]]),
  });

  it("las dos en el mismo momento con el mismo puntaje → ninguna", () => {
    const r = evaluateVisionAlerts(sandwich([19, 19, 19]));
    const t = find(r, "rechazo_techo:7680"), p = find(r, "defensa_piso:7670");
    expect(t.score).toBe(4); expect(p.score).toBe(4);
    expect(t.fires).toBe(false); expect(p.fires).toBe(false);
    expect(t.blocked).toContain("señales encontradas");
  });

  it("las dos en el mismo momento → gana la de más condiciones", () => {
    const r = evaluateVisionAlerts(sandwich([19, 19.1, 19.3]));
    expect(find(r, "rechazo_techo:7680").fires).toBe(true);
    const p = find(r, "defensa_piso:7670");
    expect(p.fires).toBe(false);
    expect(p.blocked).toContain("cumple más condiciones");
  });
});
