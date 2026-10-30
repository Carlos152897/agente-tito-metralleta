// Volumen DELTA minuto a minuto por strike (Carlos, 29-oct-2026: "quiero el minuto a minuto el
// volumen DELTA, el volumen real de cada contrato y la posición que están tomando en ese strike",
// en la parte derecha de la gráfica — compras y ventas).
//
// Fuente: velas de 1 min de CADA contrato (call y put del strike) del streaming DXLink de
// tastytrade, con volumen total, volumen al ask (comprador agresivo) y al bid (vendedor agresivo).
// Lo que no pegó ni al bid ni al ask (a mitad) queda como "sin lado".
//
// Delta del strike (contratos) = (calls compradas − calls vendidas) − (puts compradas − puts vendidas)
//   > 0 → la posición es para ARRIBA (compran calls / venden puts)
//   < 0 → para ABAJO (venden calls / compran puts)
// PURO.

export interface OptBar {
  /** Inicio del minuto, en segundos. */
  t: number;
  /** Volumen total del minuto (contratos). */
  v: number;
  /** Contratos al bid (vendedor agresivo). */
  b: number;
  /** Contratos al ask (comprador agresivo). */
  a: number;
}

/** Un minuto de un strike: calls y puts. */
export interface StrikeMinute {
  t: number;
  cA: number; cB: number; cV: number;
  pA: number; pB: number; pV: number;
}

export interface VolSums {
  /** Calls compradas (al ask) / vendidas (al bid) / volumen total. */
  cA: number; cB: number; cV: number;
  pA: number; pB: number; pV: number;
}

export type PositionKind = "compran_calls" | "venden_calls" | "compran_puts" | "venden_puts";

export interface VolDeltaRow extends VolSums {
  strike: number;
  /** Delta en contratos de la ventana: (cA − cB) − (pA − pB). */
  delta: number;
  /** Delta de la ventana anterior del mismo largo (para ▲▼). null si no hay. */
  prevDelta: number | null;
  /** Lo que más pesa en el strike en la ventana (null = nada operado). */
  position: { kind: PositionKind; contracts: number; side: "arriba" | "abajo" } | null;
}

/** Junta las velas de la call y la put de un strike por minuto. */
export function strikeMinutes(call: OptBar[], put: OptBar[]): StrikeMinute[] {
  const by = new Map<number, StrikeMinute>();
  const get = (t: number) => {
    let m = by.get(t);
    if (!m) { m = { t, cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0 }; by.set(t, m); }
    return m;
  };
  for (const b of call) { const m = get(b.t); m.cA += b.a; m.cB += b.b; m.cV += b.v; }
  for (const b of put) { const m = get(b.t); m.pA += b.a; m.pB += b.b; m.pV += b.v; }
  return [...by.values()].sort((x, y) => x.t - y.t);
}

export function sumMinutes(mins: StrikeMinute[], fromT: number, toT: number): VolSums {
  const s: VolSums = { cA: 0, cB: 0, cV: 0, pA: 0, pB: 0, pV: 0 };
  for (const m of mins) {
    if (m.t < fromT || m.t >= toT) continue;
    s.cA += m.cA; s.cB += m.cB; s.cV += m.cV; s.pA += m.pA; s.pB += m.pB; s.pV += m.pV;
  }
  return s;
}

export const deltaOf = (s: Pick<VolSums, "cA" | "cB" | "pA" | "pB">) => (s.cA - s.cB) - (s.pA - s.pB);

/** La posición que domina: el mayor de calls netas y puts netas (en contratos). */
export function positionOf(s: VolSums): VolDeltaRow["position"] {
  const c = s.cA - s.cB, p = s.pA - s.pB;
  if (c === 0 && p === 0) return null;
  if (Math.abs(c) >= Math.abs(p)) {
    return c > 0 ? { kind: "compran_calls", contracts: c, side: "arriba" } : { kind: "venden_calls", contracts: -c, side: "abajo" };
  }
  return p > 0 ? { kind: "compran_puts", contracts: p, side: "abajo" } : { kind: "venden_puts", contracts: -p, side: "arriba" };
}

export const POSITION_LABEL: Record<PositionKind, string> = {
  compran_calls: "compran calls",
  venden_calls: "venden calls",
  compran_puts: "compran puts",
  venden_puts: "venden puts",
};

/**
 * Filas por strike para la ventana [toT − windowSec, toT) — `windowSec` null = todo el día.
 * `toT` = inicio del minuto en curso (solo minutos cerrados) o el paso de la repetición.
 */
export function volDeltaRows(byStrike: Map<number, StrikeMinute[]>, toT: number, windowSec: number | null): VolDeltaRow[] {
  const out: VolDeltaRow[] = [];
  for (const [strike, mins] of byStrike) {
    const fromT = windowSec == null ? -Infinity : toT - windowSec;
    const s = sumMinutes(mins, fromT, toT);
    const prev = windowSec == null ? null : sumMinutes(mins, fromT - windowSec, fromT);
    const hadPrev = prev != null && (prev.cV > 0 || prev.pV > 0);
    out.push({ strike, ...s, delta: deltaOf(s), prevDelta: hadPrev ? deltaOf(prev!) : null, position: positionOf(s) });
  }
  return out.sort((a, b) => b.strike - a.strike);
}

/** Símbolo de DXLink sin el sufijo de la vela: ".SPXW261029C7720{=m}" → ".SPXW261029C7720". */
export const bareSymbol = (s: string) => s.replace(/\{.*\}$/, "");

// ── Volumen delta INUSUAL (Carlos, 29-oct-2026: se marca en NARANJA, aparte del amarillo de $) ──
// Un strike se enciende cuando en UN minuto la posición neta que domina (compran/venden calls o
// puts, en contratos) es mucho más grande de lo normal:
//   - ≥ `minContracts` y ≥ `dayMult` × la mediana del día (calibrado 29-oct SPX 0DTE: ~22 marcas/día, todas ≥500 contratos) (minutos con algo operado, todos los strikes);
//   - ≥ `selfMult` × el promedio de ESE strike en los `lookbackMin` minutos anteriores;
//   - como mucho `maxPerMinute` strikes por minuto (los más grandes); nada en los primeros 15 min.
// Se queda encendido `litMin` minutos.

export const VOL_SPIKE_TUNING = {
  minContracts: 50,
  dayMult: 10,
  selfMult: 8,
  lookbackMin: 30,
  maxPerMinute: 1,
  litMin: 3,
  skipOpenSec: 15 * 60,
};

export interface VolSpike {
  strike: number;
  /** Minuto del salto (segundos). */
  t: number;
  kind: PositionKind;
  side: "arriba" | "abajo";
  contracts: number;
  /** Veces sobre lo normal de ese strike (promedio de los minutos anteriores; mínimo 1 contrato). */
  ratio: number;
}

const minuteNet = (m: StrikeMinute) => positionOf({ cA: m.cA, cB: m.cB, cV: m.cV, pA: m.pA, pB: m.pB, pV: m.pV });

/** Saltos de volumen delta en los últimos `litMin` minutos cerrados antes de `toT` (el más reciente por strike). */
export function detectVolumeSpikes(byStrike: Map<number, StrikeMinute[]>, toT: number, sessionOpen: number, tuning = VOL_SPIKE_TUNING): VolSpike[] {
  const all: number[] = [];
  for (const mins of byStrike.values()) for (const m of mins) {
    if (m.t >= toT) continue;
    const p = minuteNet(m);
    if (p && p.contracts > 0) all.push(p.contracts);
  }
  if (all.length === 0) return [];
  all.sort((a, b) => a - b);
  const dayMedian = all[Math.floor(all.length / 2)];
  const floor = Math.max(tuning.minContracts, tuning.dayMult * dayMedian);

  const cands: VolSpike[] = [];
  const fromT = toT - tuning.litMin * 60;
  for (const [strike, mins] of byStrike) {
    for (let i = 0; i < mins.length; i++) {
      const m = mins[i];
      if (m.t < fromT || m.t >= toT || m.t < sessionOpen + tuning.skipOpenSec) continue;
      const p = minuteNet(m);
      if (!p || p.contracts < floor) continue;
      let sum = 0;
      const lb = m.t - tuning.lookbackMin * 60;
      for (let j = i - 1; j >= 0 && mins[j].t >= lb; j--) sum += minuteNet(mins[j])?.contracts ?? 0;
      const avg = Math.max(1, sum / tuning.lookbackMin);
      if (p.contracts < tuning.selfMult * avg) continue;
      cands.push({ strike, t: m.t, kind: p.kind, side: p.side, contracts: p.contracts, ratio: p.contracts / avg });
    }
  }
  // Máximo N por minuto (los más grandes) y el más reciente por strike.
  const byMinute = new Map<number, VolSpike[]>();
  for (const c of cands) byMinute.set(c.t, [...(byMinute.get(c.t) ?? []), c]);
  const kept = [...byMinute.values()].flatMap((arr) => arr.sort((a, b) => b.contracts - a.contracts).slice(0, tuning.maxPerMinute));
  const latest = new Map<number, VolSpike>();
  for (const k of kept) { const cur = latest.get(k.strike); if (!cur || k.t > cur.t) latest.set(k.strike, k); }
  return [...latest.values()].sort((a, b) => b.contracts - a.contracts);
}
