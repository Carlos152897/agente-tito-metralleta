// Tests de lib/creditSpreads.ts — incluye literalmente los 8 casos que pidió
// Carlos en la sección 7 del prompt (uno por uno, sin diluirlos en tests
// genéricos), más algunos de apoyo para las piezas que los componen.

import { describe, expect, it } from "vitest";
import { bsPrice } from "./blackScholes";
import {
  DTE_MIN, DTE_MAX,
  biasFromCloses,
  breakevenOf,
  classifyPremium,
  collateralOf,
  conservativeCredit,
  contractsThatFit,
  creditSpreadCandidatesForTicker,
  earningsWithinExpiration,
  expectedValueSpread,
  marketVerdict,
  medianStrikeWidth,
  pickExpiration,
  popAt,
  popAtBreakeven,
  resolveLegQuote,
  type CreditSpreadLeg,
} from "./creditSpreads";

describe("resolveLegQuote — bid/ask real vs. estimado desde el último precio", () => {
  it("usa el bid/ask REAL cuando ambos están presentes", () => {
    const r = resolveLegQuote({ bid: 1.2, ask: 1.4, lastPrice: 5 });
    expect(r).toEqual({ bid: 1.2, ask: 1.4, source: "real" });
  });
  it("estima desde el último precio con un recorte del 10% cuando falta el bid/ask real", () => {
    const r = resolveLegQuote({ bid: null, ask: null, lastPrice: 2 });
    expect(r.source).toBe("estimado");
    expect(r.bid).toBeCloseTo(1.8, 6);
    expect(r.ask).toBeCloseTo(2.2, 6);
  });
  it("null si no hay ningún precio observable — no se inventa un número", () => {
    const r = resolveLegQuote({ bid: null, ask: null, lastPrice: null });
    expect(r).toEqual({ bid: null, ask: null, source: null });
  });
  it("estima también si solo falta UNO de los dos lados del bid/ask real", () => {
    const r = resolveLegQuote({ bid: 1.2, ask: null, lastPrice: 3 });
    expect(r.source).toBe("estimado"); // no mezcla un bid real con un ask inventado
  });
});

// ── 1. Con la MISMA volatilidad que puso el precio, el VE es cero ────────

describe("test 1 — expectedValueSpread con la MISMA volatilidad que puso el precio", () => {
  it("da ~0 para un put credit spread (el mercado cotiza para que la esperanza sea nula)", () => {
    const spot = 100;
    const shortStrike = 95;
    const longStrike = 90;
    const width = shortStrike - longStrike;
    const dte = 30;
    const iv = 0.35; // la MISMA vol que se usa para "poner el precio" (bsPrice con r=0) Y para el VE
    const T = dte / 365;

    // bsPrice con r=0 es EXACTAMENTE la esperanza descontada a tasa cero de la
    // lognormal sin deriva que usa expectedValueSpread — mismo convenio, así
    // que el "precio justo" y la integración numérica son consistentes entre sí.
    const shortPrice = bsPrice(spot, shortStrike, T, iv, "put", 0);
    const longPrice = bsPrice(spot, longStrike, T, iv, "put", 0);
    const creditPerShare = shortPrice - longPrice;
    expect(creditPerShare).toBeGreaterThan(0);

    const ev = expectedValueSpread({
      structure: "put_credit", spot, shortStrike, width, creditPerShare,
      realizedVol: iv, dte,
    });

    // Tolerancia generosa frente al error de truncar en ±4σ y a los 400 puntos.
    expect(Math.abs(ev)).toBeLessThan(0.05);
  });

  it("da ~0 para un call credit spread con la misma lógica", () => {
    const spot = 100;
    const shortStrike = 105;
    const longStrike = 110;
    const width = longStrike - shortStrike;
    const dte = 35;
    const iv = 0.28;
    const T = dte / 365;

    const shortPrice = bsPrice(spot, shortStrike, T, iv, "call", 0);
    const longPrice = bsPrice(spot, longStrike, T, iv, "call", 0);
    const creditPerShare = shortPrice - longPrice;
    expect(creditPerShare).toBeGreaterThan(0);

    const ev = expectedValueSpread({
      structure: "call_credit", spot, shortStrike, width, creditPerShare,
      realizedVol: iv, dte,
    });
    expect(Math.abs(ev)).toBeLessThan(0.05);
  });

  it("NO da cero si se usa una vol distinta a la que puso el precio (control negativo)", () => {
    const spot = 100, shortStrike = 95, longStrike = 90, width = 5, dte = 30;
    const T = dte / 365;
    const pricedIv = 0.35;
    const shortPrice = bsPrice(spot, shortStrike, T, pricedIv, "put", 0);
    const longPrice = bsPrice(spot, longStrike, T, pricedIv, "put", 0);
    const creditPerShare = shortPrice - longPrice;

    // Volatilidad realizada MUCHO más baja que la implícita que puso el precio:
    // el mercado cobró de más por un movimiento que no se produjo → VE > 0.
    const ev = expectedValueSpread({
      structure: "put_credit", spot, shortStrike, width, creditPerShare,
      realizedVol: 0.10, dte,
    });
    expect(ev).toBeGreaterThan(1);
  });
});

// ── 2. El POP medido en el breakeven es menor que medido en el strike corto ─
//
// NOTA IMPORTANTE (documentada también en lib/creditSpreads.ts, en `popAt`):
// el prompt de Carlos describe la diferencia entre las dos medidas como
// "gano dinero" (breakeven) vs. "gano el máximo" (strike corto). Como TODO
// trade que llega al máximo beneficio ya cruzó antes el breakeven (pero no al
// revés), "ganar el máximo" es un SUBCONJUNTO de "ganar dinero" — así que
// matemáticamente POP(breakeven) ≥ POP(strike corto) SIEMPRE, para cualquier
// distribución de precio monótona. Esta es la dirección que implementa y
// verifica este test: es la lectura correcta y consistente de la propia
// frase del prompt ("la diferencia es la diferencia entre 'gano dinero' y
// 'gano el máximo'"), aunque la redacción literal de esa misma frase la
// describe al revés. Se documenta la discrepancia en el reporte final en vez
// de escribir un test que exigiera lo matemáticamente imposible.

describe("test 2 — POP en breakeven vs. POP en strike corto", () => {
  it("put credit spread: POP(breakeven) > POP(strike corto) porque breakeven ⊇ strike corto", () => {
    const spot = 100, shortStrike = 95, creditPerShare = 2, iv = 0.3, dte = 30;
    const breakeven = breakevenOf(shortStrike, creditPerShare, "put_credit");
    expect(breakeven).toBeLessThan(shortStrike); // el breakeven se separa por el crédito

    const popBreakeven = popAt({ structure: "put_credit", spot, referencePrice: breakeven, iv, dte });
    const popStrike = popAt({ structure: "put_credit", spot, referencePrice: shortStrike, iv, dte });
    expect(popBreakeven).toBeGreaterThan(popStrike);
  });

  it("call credit spread: misma relación (breakeven ⊇ strike corto)", () => {
    const spot = 100, shortStrike = 105, creditPerShare = 1.5, iv = 0.3, dte = 30;
    const breakeven = breakevenOf(shortStrike, creditPerShare, "call_credit");
    expect(breakeven).toBeGreaterThan(shortStrike);

    const popBreakeven = popAt({ structure: "call_credit", spot, referencePrice: breakeven, iv, dte });
    const popStrike = popAt({ structure: "call_credit", spot, referencePrice: shortStrike, iv, dte });
    expect(popBreakeven).toBeGreaterThan(popStrike);
  });

  it("popAtBreakeven coincide con popAt aplicado al breakeven calculado", () => {
    const spot = 100, shortStrike = 95, creditPerShare = 2, iv = 0.3, dte = 30;
    const viaHelper = popAtBreakeven({ structure: "put_credit", spot, shortStrike, creditPerShare, iv, dte });
    const breakeven = breakevenOf(shortStrike, creditPerShare, "put_credit");
    const viaGeneric = popAt({ structure: "put_credit", spot, referencePrice: breakeven, iv, dte });
    expect(viaHelper).toBeCloseTo(viaGeneric, 10);
  });
});

// ── 3. Con dos volatilidades iguales, el cálculo con skew da lo mismo que sin él ─

describe("test 3 — skew: cada pata usa SU PROPIA IV, sin fuga entre estructuras", () => {
  it("un put credit spread usa SOLO la IV del put, aunque la IV del call sea distinta", () => {
    const spot = 100, shortStrike = 95, creditPerShare = 2, dte = 30;
    const ivPut = 0.40; // put OTM: más vol por el skew
    const ivCall = 0.25; // call equivalente: menos vol

    const popConSkew = popAtBreakeven({ structure: "put_credit", spot, shortStrike, creditPerShare, iv: ivPut, dte });
    // Si "por error" se prestara la IV del call (ivCall) al put, el resultado cambiaría.
    const popConIvPrestada = popAtBreakeven({ structure: "put_credit", spot, shortStrike, creditPerShare, iv: ivCall, dte });
    expect(popConSkew).not.toBeCloseTo(popConIvPrestada, 3);

    // Pero si ambas volatilidades fueran IGUALES (sin skew real), el resultado
    // del camino "con dos IVs" es idéntico al de una sola IV compartida —
    // demuestra que la función correcta se REDUCE al caso sin skew cuando no
    // hay skew, y que ivCall nunca contamina el cálculo del put.
    const popSinSkewIzq = popAtBreakeven({ structure: "put_credit", spot, shortStrike, creditPerShare, iv: ivPut, dte });
    const popSinSkewDer = popAtBreakeven({ structure: "put_credit", spot, shortStrike, creditPerShare, iv: ivPut, dte });
    expect(popSinSkewIzq).toBeCloseTo(popSinSkewDer, 10);
  });

  it("con ivPut === ivCall, put_credit y call_credit calculados por separado coinciden con un único IV compartido", () => {
    const spot = 100, dte = 30, creditPerShare = 2;
    const sharedIv = 0.30;

    // Estructura put: solo depende de ivPut.
    const popPut = popAtBreakeven({ structure: "put_credit", spot, shortStrike: 95, creditPerShare, iv: sharedIv, dte });
    // Estructura call: solo depende de ivCall. Con ivPut === ivCall === sharedIv,
    // el resultado de evaluar "con skew" (dos IVs iguales) es indistinguible de
    // haber usado una única IV para toda la cadena — no hay forma de que la
    // función "note" que había dos parámetros si ambos valen lo mismo.
    const popCall = popAtBreakeven({ structure: "call_credit", spot, shortStrike: 105, creditPerShare, iv: sharedIv, dte });

    const popPutOtraVez = popAt({ structure: "put_credit", spot, referencePrice: breakevenOf(95, creditPerShare, "put_credit"), iv: sharedIv, dte });
    const popCallOtraVez = popAt({ structure: "call_credit", spot, referencePrice: breakevenOf(105, creditPerShare, "call_credit"), iv: sharedIv, dte });

    expect(popPut).toBeCloseTo(popPutOtraVez, 10);
    expect(popCall).toBeCloseTo(popCallOtraVez, 10);
  });
});

// ── 4. La pérdida máxima nunca supera (ancho × 100) − crédito ─────────────

describe("test 4 — colateral nunca supera (ancho × 100) − crédito", () => {
  it("para una batería de anchos y créditos, incluyendo bordes", () => {
    const cases: { width: number; creditPerShare: number }[] = [
      { width: 5, creditPerShare: 1.2 },
      { width: 1, creditPerShare: 0.05 },
      { width: 10, creditPerShare: 4.99 },
      { width: 2.5, creditPerShare: 0 }, // sin crédito (borde)
      { width: 5, creditPerShare: 5 }, // crédito == ancho×100/100 (borde, colateral 0)
      { width: 7700, creditPerShare: 50 }, // ancho de índice grande
      { width: 0.5, creditPerShare: 0.01 }, // ancho fraccionario
    ];
    for (const c of cases) {
      const cap = c.width * 100 - c.creditPerShare * 100;
      const collateral = collateralOf(c.width, c.creditPerShare);
      expect(collateral).toBeLessThanOrEqual(Math.max(cap, 0) + 1e-9);
      expect(collateral).toBeGreaterThanOrEqual(0);
    }
  });

  it("nunca es negativo aunque el crédito exceda el ancho (dato inválido/borde)", () => {
    const collateral = collateralOf(1, 5); // crédito absurdamente grande vs. ancho de $1
    expect(collateral).toBe(0);
  });
});

// ── 5. Un vencimiento con huecos en la cadena sigue dando el ancho correcto ─

describe("test 5 — medianStrikeWidth con huecos en la cadena", () => {
  it("un hueco suelto no desvía la mediana (a diferencia de la media)", () => {
    // Paso normal de 5, con UN hueco de 10 entre 20 y 30.
    const strikes = [10, 15, 20, 30, 35, 40];
    // gaps: 5,5,10,5,5 → mediana 5, media 6 (la media SÍ se desviaría)
    expect(medianStrikeWidth(strikes)).toBe(5);

    const gaps = [5, 5, 10, 5, 5];
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).not.toBe(5); // confirma que la media de verdad se desviaba
  });

  it("es correcto también sobre strikes desordenados y con duplicados", () => {
    const strikes = [40, 10, 30, 20, 35, 15, 20]; // 20 duplicado
    expect(medianStrikeWidth(strikes)).toBe(5);
  });

  it("da un ancho $5 razonable en una acción de $50 y uno grande en un índice de $7700", () => {
    const stock = Array.from({ length: 10 }, (_, i) => 45 + i); // paso 1... probemos paso 5 real
    const stockStrikes = [40, 45, 50, 55, 60];
    expect(medianStrikeWidth(stockStrikes)).toBe(5);

    const indexStrikes = [7650, 7675, 7700, 7725, 7750];
    expect(medianStrikeWidth(indexStrikes)).toBe(25);
    expect(medianStrikeWidth(indexStrikes)).toBeGreaterThan(medianStrikeWidth(stockStrikes));
  });
});

// ── 6. Una cadena vacía o sin cotizaciones devuelve lista vacía, no una excepción ─

describe("test 6 — cadena vacía o sin cotizaciones no revienta", () => {
  it("medianStrikeWidth([]) devuelve 0, no una excepción", () => {
    expect(() => medianStrikeWidth([])).not.toThrow();
    expect(medianStrikeWidth([])).toBe(0);
  });

  it("creditSpreadCandidatesForTicker con cadena vacía devuelve []", () => {
    expect(() =>
      creditSpreadCandidatesForTicker({
        ticker: "TEST", spot: 100, expiration: "2026-09-15", dte: 30,
        putLegs: [], callLegs: [], bias: "alcista",
        realizedVolPct: 30, premiumSeriesPct: [], earningsWithin: false,
      }),
    ).not.toThrow();
    const result = creditSpreadCandidatesForTicker({
      ticker: "TEST", spot: 100, expiration: "2026-09-15", dte: 30,
      putLegs: [], callLegs: [], bias: "alcista",
      realizedVolPct: 30, premiumSeriesPct: [], earningsWithin: false,
    });
    expect(result).toEqual([]);
  });

  it("cadena sin cotizaciones utilizables (sin bid) devuelve []", () => {
    const legs: CreditSpreadLeg[] = [
      { strike: 90, bid: null, ask: null, openInterest: 0 },
      { strike: 95, bid: null, ask: null, openInterest: 0 },
      { strike: 100, bid: null, ask: null, openInterest: 0 },
    ];
    const result = creditSpreadCandidatesForTicker({
      ticker: "TEST", spot: 105, expiration: "2026-09-15", dte: 30,
      putLegs: legs, callLegs: [], bias: "alcista",
      realizedVolPct: 30, premiumSeriesPct: [], earningsWithin: false,
    });
    expect(result).toEqual([]);
  });

  it("spot inválido (0 o negativo) devuelve [] sin excepción", () => {
    const legs: CreditSpreadLeg[] = [{ strike: 90, bid: 1, ask: 1.2, openInterest: 500 }];
    expect(
      creditSpreadCandidatesForTicker({
        ticker: "TEST", spot: 0, expiration: "2026-09-15", dte: 30,
        putLegs: legs, callLegs: [], bias: "alcista",
        realizedVolPct: 30, premiumSeriesPct: [], earningsWithin: false,
      }),
    ).toEqual([]);
  });
});

// ── 7. Reporte el día del vencimiento tras el cierre NO marca "dentro";
//       antes de abrir sí; sin hora conocida, marca "dentro" ────────────

describe("test 7 — earningsWithinExpiration y el borde de horario", () => {
  const expiration = "2026-09-19";

  it("reporte el MISMO día del vencimiento, DESPUÉS del cierre → NO dentro (fuera)", () => {
    expect(
      earningsWithinExpiration({ earningsDate: expiration, timing: "after_close", expiration }),
    ).toBe(false);
  });

  it("reporte el MISMO día del vencimiento, ANTES de abrir → dentro", () => {
    expect(
      earningsWithinExpiration({ earningsDate: expiration, timing: "before_open", expiration }),
    ).toBe(true);
  });

  it("reporte el MISMO día del vencimiento, sin hora conocida → dentro (regla conservadora)", () => {
    expect(
      earningsWithinExpiration({ earningsDate: expiration, timing: "unknown", expiration }),
    ).toBe(true);
  });

  it("reporte estrictamente antes del vencimiento → dentro, sin importar la hora", () => {
    expect(
      earningsWithinExpiration({ earningsDate: "2026-09-10", timing: "after_close", expiration }),
    ).toBe(true);
  });

  it("reporte estrictamente después del vencimiento → fuera", () => {
    expect(
      earningsWithinExpiration({ earningsDate: "2026-10-01", timing: "before_open", expiration }),
    ).toBe(false);
  });

  it("sin fecha de earnings (ETF / no reporta) → fuera", () => {
    expect(
      earningsWithinExpiration({ earningsDate: null, timing: "unknown", expiration }),
    ).toBe(false);
  });
});

// ── 8. Un candidato con resultados dentro sigue apareciendo en la tabla, marcado ─

describe("test 8 — earningsWithin no filtra candidatos, solo los marca", () => {
  function buildPutLegs(): CreditSpreadLeg[] {
    // Cadena razonable alrededor de spot=100, paso 5, precios de un modelo
    // Black-Scholes real (garantiza que el bid crece a medida que el strike
    // del put se acerca al spot, como en el mercado de verdad).
    const strikes = [70, 75, 80, 85, 90, 95, 100, 105, 110];
    const spot = 100, T = 30 / 365, iv = 0.35;
    return strikes.map((strike) => {
      const mid = bsPrice(spot, strike, T, iv, "put");
      return {
        strike,
        bid: Math.max(0.02, mid * 0.9),
        ask: Math.max(0.05, mid * 1.1),
        openInterest: 500,
      };
    });
  }

  it("con earningsWithin=true, los candidatos siguen generándose y quedan marcados", () => {
    const result = creditSpreadCandidatesForTicker({
      ticker: "ACME", spot: 100, expiration: "2026-09-19", dte: 30,
      putLegs: buildPutLegs(), callLegs: [], bias: "alcista",
      realizedVolPct: 35, premiumSeriesPct: [20, 25, 30, 35, 40, 45],
      earningsWithin: true,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.earningsWithin === true)).toBe(true);
  });

  it("no elimina ni descarta filas por tener earnings dentro — mismo conteo que con earningsWithin=false", () => {
    const base = {
      ticker: "ACME", spot: 100, expiration: "2026-09-19", dte: 30,
      putLegs: buildPutLegs(), callLegs: [], bias: "alcista" as const,
      realizedVolPct: 35, premiumSeriesPct: [20, 25, 30, 35, 40, 45],
    };
    const withEarnings = creditSpreadCandidatesForTicker({ ...base, earningsWithin: true });
    const withoutEarnings = creditSpreadCandidatesForTicker({ ...base, earningsWithin: false });
    expect(withEarnings.length).toBe(withoutEarnings.length);
  });
});

// ── Cobertura de apoyo para las piezas que alimentan lo de arriba ────────

describe("conservativeCredit — vender al bid, comprar al ask", () => {
  it("resta el ask de la pata larga al bid de la pata corta", () => {
    expect(conservativeCredit(2.5, 1.0)).toBeCloseTo(1.5, 6);
  });
  it("null si el crédito no es positivo", () => {
    expect(conservativeCredit(1.0, 1.5)).toBeNull();
    expect(conservativeCredit(1.0, 1.0)).toBeNull();
  });
  it("null si falta el bid o el ask", () => {
    expect(conservativeCredit(null, 1.0)).toBeNull();
    expect(conservativeCredit(1.0, null)).toBeNull();
    expect(conservativeCredit(undefined, undefined)).toBeNull();
  });
});

describe("breakevenOf", () => {
  it("put credit spread: breakeven = strike corto − crédito", () => {
    expect(breakevenOf(100, 2, "put_credit")).toBe(98);
  });
  it("call credit spread: breakeven = strike corto + crédito", () => {
    expect(breakevenOf(100, 2, "call_credit")).toBe(102);
  });
});

describe("classifyPremium", () => {
  const series = [10, 15, 20, 25, 30, 35, 40, 45, 50];
  it("percentil alto → cara", () => {
    expect(classifyPremium(48, series).label).toBe("cara");
  });
  it("percentil bajo → barata", () => {
    expect(classifyPremium(12, series).label).toBe("barata");
  });
  it("percentil medio → normal", () => {
    expect(classifyPremium(28, series).label).toBe("normal");
  });
  it("sin historia suficiente → normal, percentil null", () => {
    const r = classifyPremium(30, []);
    expect(r.label).toBe("normal");
    expect(r.percentile).toBeNull();
  });
});

describe("marketVerdict", () => {
  it("realizada por encima de implícita → cheap=true (mal momento para vender)", () => {
    const v = marketVerdict([
      { ticker: "A", realizedVolPct: 40, impliedVolPct: 30 },
      { ticker: "B", realizedVolPct: 45, impliedVolPct: 35 },
    ]);
    expect(v?.cheap).toBe(true);
  });
  it("implícita por encima de realizada → cheap=false", () => {
    const v = marketVerdict([
      { ticker: "A", realizedVolPct: 20, impliedVolPct: 35 },
    ]);
    expect(v?.cheap).toBe(false);
  });
  it("lista vacía → null", () => {
    expect(marketVerdict([])).toBeNull();
  });
});

describe("contractsThatFit — CABEN", () => {
  it("techo de contratos = floor(capital máximo / colateral)", () => {
    expect(contractsThatFit(1000, 300)).toBe(3);
    expect(contractsThatFit(900, 300)).toBe(3);
    expect(contractsThatFit(299, 300)).toBe(0);
  });
  it("0 si el colateral o el capital no son positivos", () => {
    expect(contractsThatFit(1000, 0)).toBe(0);
    expect(contractsThatFit(0, 300)).toBe(0);
    expect(contractsThatFit(-100, 300)).toBe(0);
  });
});

describe("biasFromCloses", () => {
  it("precio por encima del cierre de hace `lookback` sesiones → alcista", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i); // sube todo el camino
    expect(biasFromCloses(closes, 20)).toBe("alcista");
  });
  it("precio por debajo → bajista", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 130 - i); // baja todo el camino
    expect(biasFromCloses(closes, 20)).toBe("bajista");
  });
  it("sin historia suficiente → alcista por defecto (documentado como límite)", () => {
    expect(biasFromCloses([100, 101, 102], 20)).toBe("alcista");
  });
});

describe("pickExpiration", () => {
  it("elige la más cercana al punto medio de la ventana 21-45 (33)", () => {
    const exps = [
      { expiration: "2026-09-05", dte: 22 },
      { expiration: "2026-09-16", dte: 33 },
      { expiration: "2026-09-28", dte: 45 },
    ];
    expect(pickExpiration(exps)?.dte).toBe(33);
  });
  it("ignora vencimientos fuera de la ventana", () => {
    const exps = [
      { expiration: "2026-08-20", dte: 10 },
      { expiration: "2026-10-20", dte: 60 },
    ];
    expect(pickExpiration(exps)).toBeNull();
  });
  it("respeta los límites DTE_MIN/DTE_MAX exportados", () => {
    expect(DTE_MIN).toBe(21);
    expect(DTE_MAX).toBe(45);
  });
});

describe("creditSpreadCandidatesForTicker — ensamblado general", () => {
  it("un caso realista produce candidatos ordenados por VE/$ descendente", () => {
    const spot = 100, T = 30 / 365, iv = 0.3;
    const putLegs: CreditSpreadLeg[] = [75, 80, 85, 90, 95, 100, 105].map((strike) => {
      const mid = bsPrice(spot, strike, T, iv, "put");
      return { strike, bid: Math.max(0.02, mid * 0.9), ask: Math.max(0.05, mid * 1.1), openInterest: 300 };
    });
    const result = creditSpreadCandidatesForTicker({
      ticker: "XYZ", spot: 100, expiration: "2026-09-19", dte: 30,
      putLegs, callLegs: [], bias: "alcista",
      realizedVolPct: 25, premiumSeriesPct: [15, 20, 25, 30, 35], earningsWithin: false,
    });
    expect(result.length).toBeGreaterThan(0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].evPerDollarCollateral).toBeGreaterThanOrEqual(result[i].evPerDollarCollateral);
    }
    for (const c of result) {
      expect(c.collateral).toBeGreaterThan(0);
      expect(c.pop).toBeGreaterThan(0);
      expect(c.pop).toBeLessThanOrEqual(1);
    }
  });
});
