// "Una pata vs spreads" en VisionFutura (etapa 2 de la terminal de MarketSnack, 28-oct-2026). PURO.
//
// MarketSnack (`option_pressure`) da, por strike, la prima del día partida en operaciones de UNA
// pata (apuesta de dirección) y de VARIAS patas (spreads: compran de un lado y venden del otro,
// no dicen hacia dónde va nadie). Esa prima es BRUTA (sin lado). Nuestro flujo por strike
// (callFlow/putFlow) es NETO (ask − bid) pero mezcla todo. Por eso:
//   - % de una pata = una pata ÷ (una pata + spreads), por strike y por calls/puts (dato real);
//   - flujo de una pata ≈ flujo neto × % de una pata (ESTIMADO: no sabemos el lado de cada parte);
//   - "nivel firme con una pata" = el nivel firme de siempre Y el lado que lo define tiene ≥ 50%
//     de una pata. Si es mayormente spreads, ese "firme" es ruido.
// No cambia cuándo disparan las alertas: se guarda junto a cada alerta para medirlo en paralelo.

import type { DealerRole, VisionStrikeRow } from "./visionFutura";
import type { MsPressureRow } from "./marketsnack";

export const LEG_TUNING = {
  /** % mínimo de una pata para contar el nivel como firme "de verdad". */
  minShare: 0.5,
};

export interface StrikeLegs {
  /** % de una pata en calls / puts (0–1), null si no hubo prima de ese lado. */
  callShare: number | null;
  putShare: number | null;
  /** Prima bruta del día (una pata, spreads) — para la tarjeta del strike. */
  callSingle: number;
  callMulti: number;
  putSingle: number;
  putMulti: number;
  /** Flujo neto estimado de una pata (= flujo × %). */
  callFlow1: number;
  putFlow1: number;
  /** Rol de dealers usando solo el flujo de una pata (null si es mayormente spreads). */
  dealerRole1: DealerRole;
}

export type RowWithLegs = VisionStrikeRow & { legs?: StrikeLegs };

const share = (single: number, multi: number) => (single + multi > 0 ? single / (single + multi) : null);

function role1(strike: number, spot: number, callFlow: number, putFlow: number, callShare: number | null, putShare: number | null, t = LEG_TUNING): DealerRole {
  if (strike > spot) {
    if (callShare == null || callShare < t.minShare) return null;
    if (callFlow < 0) return "resistencia";
    if (callFlow > 0) return "acelera_arriba";
  } else if (strike < spot) {
    if (putShare == null || putShare < t.minShare) return null;
    if (putFlow < 0) return "piso";
    if (putFlow > 0) return "acelera_abajo";
  }
  return null;
}

/** Agrega `legs` a cada fila que tenga datos de MarketSnack (las demás quedan igual). */
export function withSingleLeg<R extends VisionStrikeRow>(rows: R[], pressure: MsPressureRow[], spot: number, t = LEG_TUNING): (R & { legs?: StrikeLegs })[] {
  const by = new Map(pressure.map((p) => [p.strike, p]));
  return rows.map((r) => {
    const p = by.get(r.spx);
    if (!p) return r;
    const callShare = share(p.call.single_leg, p.call.multi_leg);
    const putShare = share(p.put.single_leg, p.put.multi_leg);
    return {
      ...r,
      legs: {
        callShare, putShare,
        callSingle: p.call.single_leg, callMulti: p.call.multi_leg,
        putSingle: p.put.single_leg, putMulti: p.put.multi_leg,
        callFlow1: r.callFlow * (callShare ?? 0),
        putFlow1: r.putFlow * (putShare ?? 0),
        dealerRole1: role1(r.spx, spot, r.callFlow, r.putFlow, callShare, putShare, t),
      },
    };
  });
}

export interface AlertSingleLeg {
  side: "call" | "put";
  /** % de una pata del lado que define el nivel (null = sin dato de MarketSnack). */
  share: number | null;
  /** Firme de siempre Y ≥ 50% una pata. */
  firm: boolean;
  text: string;
}

/**
 * Lectura "una pata" para una alerta: techos miran calls, pisos miran puts. `firmOk` = la
 * condición "firme" de siempre. null si la fila no tiene datos de MarketSnack.
 */
export function alertSingleLeg(kind: string, row: RowWithLegs | null, firmOk: boolean, t = LEG_TUNING): AlertSingleLeg | null {
  if (!row?.legs) return null;
  const side: "call" | "put" = kind.includes("techo") ? "call" : "put";
  const s = side === "call" ? row.legs.callShare : row.legs.putShare;
  const pct = s == null ? "—" : `${Math.round(s * 100)}%`;
  const label = side === "call" ? "calls" : "puts";
  const firm = firmOk && s != null && s >= t.minShare;
  const text = s == null
    ? `sin prima de ${label} en este strike`
    : s >= t.minShare
      ? `${pct} de los ${label} es de una pata (apuestas de dirección)${firmOk ? " → firme de verdad" : ""}`
      : `solo ${pct} de los ${label} es de una pata: mayormente spreads${firmOk ? " → el \"firme\" es ruido" : ""}`;
  return { side, share: s, firm, text };
}
