// "Verticales amiga" — la regla "Sombra 1–5 DTE" (SPX) que compartió una amiga
// de Carlos como script de Python (sombra1a5DTE.py), traducida TAL CUAL a
// TypeScript para VisionFutura (oct 2026). PURO: sin red ni disco.
//
// Credit spreads de 1 a 5 días en SPX, "regla A":
//   Lecturas: 10:00, 12:30 y 15:30 ET. Vencimientos: los 5 siguientes DESPUÉS de hoy.
//   Vende credit put spread (debajo del precio) o credit call spread (encima); anchos 10 y 15.
//   Compuertas (todas): L liquidez OI ≥ 800 en las dos patas · I no vender hacia el imán ·
//   σ corto a ≥ 1σ · Δ corto entre 0.10 y 0.20 · M en el muro de OI de su lado o más lejos ·
//   P bid/ask real y angosto · $ crédito ≥ 10% del ancho · N sin FOMC/CPI/NFP/PPI/PCE.
//   Si pasan los dos lados → los dos (iron condor). Gana el que más rinde: crédito ÷ (ancho − crédito).
//   Salidas: toma de ganancia (recomprar ≤ 50% del crédito) y stop (precio cruzó el corto) en las
//   lecturas de 12:30 y 15:30; al vencer, crédito − intrínseco; si cierra más allá del corto antes de
//   vencer, stop con la recompra estimada por Black-Scholes y la IV de la entrada.
//   Supuesto del GEX: dealers con calls compradas (+) y puts vendidas (−).

export const REGLA = {
  oiMinPata: 800,
  oiMinNivel: 1000,
  sigmaMin: 1.0,
  deltaMin: 0.1,
  deltaMax: 0.2,
  creditoMinPct: 0.1,
  tomaGananciaPct: 0.5,
  anchos: [10, 15],
  muroBandaPct: 0.0079,
  spreadMaxPct: 0.25,
  spreadMinUsd: 0.1,
  plazos: 5,
};

export const HORAS = ["10:00", "12:30", "15:30"] as const;
export type Hora = (typeof HORAS)[number];

export interface Cotizacion {
  strike: number;
  tipo: "put" | "call";
  bid: number | null;
  ask: number | null;
  oi: number;
}

export interface Evento { fecha: string; tipo: string }

// ── Black-Scholes sin tasa ni dividendos (igual que el script) ──
const ncdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26 (error < 1.5e-7) — el script usa math.erf; la diferencia es despreciable.
  const s = Math.sign(x), a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export function bsPrecio(s: number, k: number, t: number, iv: number, tipo: "put" | "call"): number {
  if (t <= 0 || iv <= 0) return Math.max(0, tipo === "call" ? s - k : k - s);
  const d1 = (Math.log(s / k) + 0.5 * iv * iv * t) / (iv * Math.sqrt(t));
  const d2 = d1 - iv * Math.sqrt(t);
  return tipo === "call" ? s * ncdf(d1) - k * ncdf(d2) : k * ncdf(-d2) - s * ncdf(-d1);
}

export function bsDelta(s: number, k: number, t: number, iv: number, tipo: "put" | "call"): number {
  const d1 = (Math.log(s / k) + 0.5 * iv * iv * t) / (iv * Math.sqrt(t));
  return tipo === "call" ? ncdf(d1) : ncdf(d1) - 1;
}

export function bsGamma(s: number, k: number, t: number, iv: number): number {
  const d1 = (Math.log(s / k) + 0.5 * iv * iv * t) / (iv * Math.sqrt(t));
  return Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (s * iv * Math.sqrt(t));
}

/** IV por bisección; null si el precio no tiene sentido. */
export function ivImplicita(precio: number, s: number, k: number, t: number, tipo: "put" | "call"): number | null {
  let lo = 0.01, hi = 3.0;
  if (!(bsPrecio(s, k, t, lo, tipo) <= precio && precio <= bsPrecio(s, k, t, hi, tipo))) return null;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (bsPrecio(s, k, t, m, tipo) > precio) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

/** Años de calendario con piso de 30 min. */
export const anios = (dias: number) => Math.max(dias, 0.5 / 24) / 365;

export function medio(q: Cotizacion | undefined): number | null {
  if (q && q.bid != null && q.ask != null && q.bid > 0 && q.ask >= q.bid) return (q.bid + q.ask) / 2;
  return null;
}

// ── Niveles: IV del dinero, imán, muros ──
export function ivDelDinero(cot: Cotizacion[], spot: number, t: number): number | null {
  const strikes = [...new Set(cot.map((q) => q.strike))].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 2);
  const ivs: number[] = [];
  for (const k of strikes) {
    for (const tipo of ["call", "put"] as const) {
      const q = cot.find((x) => x.strike === k && x.tipo === tipo);
      const m = medio(q);
      const iv = m != null ? ivImplicita(m, spot, k, t, tipo) : null;
      if (iv && iv > 0.03 && iv < 3) ivs.push(iv);
    }
  }
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

export interface Niveles {
  iman: number | null;
  oiIman: number;
  muroPut: [number, number] | null;
  muroCall: [number, number] | null;
}

export function niveles(cot: Cotizacion[], spot: number, t: number, iv: number): Niveles {
  const oiC = new Map<number, number>(), oiP = new Map<number, number>();
  for (const q of cot) (q.tipo === "call" ? oiC : oiP).set(q.strike, q.oi);
  const gex = new Map<number, number>();
  for (const k of new Set([...oiC.keys(), ...oiP.keys()])) {
    const c = oiC.get(k) ?? 0, p = oiP.get(k) ?? 0;
    if (c || p) gex.set(k, bsGamma(spot, k, t, iv) * 100 * spot * spot * 0.01 * (c - p));
  }
  let iman: number | null = null;
  for (const [k, g] of gex) if (iman == null || Math.abs(g) > Math.abs(gex.get(iman)!)) iman = k;
  const banda = spot * REGLA.muroBandaPct;
  const maxOi = (m: Map<number, number>, pred: (k: number) => boolean): [number, number] | null => {
    let best: [number, number] | null = null;
    for (const [k, o] of m) if (o > 0 && pred(k) && Math.abs(k - spot) <= banda && (!best || o > best[1])) best = [k, o];
    return best;
  };
  return {
    iman,
    oiIman: iman != null ? (oiC.get(iman) ?? 0) + (oiP.get(iman) ?? 0) : 0,
    muroCall: maxOi(oiC, (k) => k >= spot),
    muroPut: maxOi(oiP, (k) => k <= spot),
  };
}

// ── Compuertas ──
export interface Compuerta { id: "L" | "I" | "σ" | "Δ" | "M" | "P" | "$" | "N"; ok: boolean; detalle: string }

function compuertaPrecio(patas: Cotizacion[]): Compuerta {
  const malas: string[] = [];
  for (const q of patas) {
    const nom = `${q.strike}${q.tipo === "put" ? "P" : "C"}`;
    if (q.bid == null || !(q.bid > 0) || q.ask == null || !(q.ask >= q.bid)) { malas.push(`${nom} sin bid/ask`); continue; }
    const sp = q.ask - q.bid;
    if (sp > Math.max(REGLA.spreadMinUsd, REGLA.spreadMaxPct * (q.bid + q.ask) / 2)) malas.push(`${nom} spread ${sp.toFixed(2)}`);
  }
  return { id: "P", ok: malas.length === 0, detalle: malas.join(", ") || "ok" };
}

const addDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

function compuertaNoticias(hoy: string, venc: string, hora: Hora, eventos: Evento[]): Compuerta {
  const desde = hora === "15:30" ? addDay(hoy) : hoy;
  const ev = eventos.filter((e) => desde <= e.fecha && e.fecha <= venc).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { id: "N", ok: ev.length === 0, detalle: ev.length ? `${ev[0].tipo} el ${ev[0].fecha}` : "sin eventos" };
}

export interface Candidato {
  lado: "put" | "call";
  corto: number;
  largo: number;
  ancho: number;
  credito: number;
  /** Precios usados: bid de la pata vendida y ask de la comprada. */
  bidCorto: number | null;
  askLargo: number | null;
  comp: Compuerta[];
  pasa: boolean;
}

export interface Evaluacion {
  iv: number | null;
  sigma: number | null;
  niveles: Niveles | null;
  dias: number;
  jugadas: Candidato[];
  mejorRechazado: Candidato | null;
  motivo: string | null;
}

const fmtK = (k: number) => `${k}`;

/** `dias` = días de calendario desde la lectura hasta las 16:00 ET del vencimiento. */
export function evaluar(cot: Cotizacion[], spot: number, hoy: string, venc: string, hora: Hora, dias: number, eventos: Evento[]): Evaluacion {
  const t = anios(dias);
  const iv = ivDelDinero(cot, spot, t);
  if (iv == null) return { iv: null, sigma: null, niveles: null, dias, jugadas: [], mejorRechazado: null, motivo: "sin cotizaciones para calcular la IV" };
  const sigma = spot * iv * Math.sqrt(t);
  const nv = niveles(cot, spot, t, iv);
  const imanFiable = nv.iman != null && nv.oiIman >= REGLA.oiMinNivel;
  const por = new Map(cot.map((q) => [`${q.tipo}:${q.strike}`, q]));
  const n = compuertaNoticias(hoy, venc, hora, eventos);
  const cands: Candidato[] = [];
  for (const lado of ["put", "call"] as const) {
    const muro = lado === "put" ? nv.muroPut : nv.muroCall;
    const muroVale = muro != null && muro[1] >= REGLA.oiMinNivel;
    for (const q of cot) {
      if (q.tipo !== lado || !(lado === "put" ? q.strike < spot : q.strike > spot)) continue;
      for (const ancho of REGLA.anchos) {
        const kLargo = lado === "put" ? q.strike - ancho : q.strike + ancho;
        const l = por.get(`${lado}:${kLargo}`);
        if (!l) continue;
        const credito = q.bid != null && l.ask != null ? Math.round((q.bid - l.ask) * 100) / 100 : 0;
        const m = medio(q);
        const ivCorto = (m != null ? ivImplicita(m, spot, q.strike, t, lado) : null) || iv;
        const delta = Math.abs(bsDelta(spot, q.strike, t, ivCorto, lado));
        const dist = Math.abs(spot - q.strike) / sigma;
        const contraIman = imanFiable && (lado === "call" ? nv.iman! > spot : nv.iman! < spot);
        const comp: Compuerta[] = [
          { id: "L", ok: Math.min(q.oi, l.oi) >= REGLA.oiMinPata, detalle: `OI ${q.oi}/${l.oi}` },
          { id: "I", ok: !contraIman, detalle: nv.iman != null ? `imán ${fmtK(nv.iman)}` : "sin imán" },
          { id: "σ", ok: dist >= REGLA.sigmaMin, detalle: `${dist.toFixed(2)}σ` },
          { id: "Δ", ok: REGLA.deltaMin <= delta && delta <= REGLA.deltaMax, detalle: `Δ ${delta.toFixed(2)}` },
          { id: "M", ok: !muroVale || (lado === "put" ? q.strike <= muro![0] : q.strike >= muro![0]), detalle: muroVale ? `muro ${fmtK(muro![0])}` : "sin muro" },
          compuertaPrecio([q, l]),
          { id: "$", ok: credito >= REGLA.creditoMinPct * ancho, detalle: `$${credito.toFixed(2)}/${ancho}` },
          n,
        ];
        cands.push({ lado, corto: q.strike, largo: kLargo, ancho, credito, bidCorto: q.bid, askLargo: l.ask, comp, pasa: comp.every((c) => c.ok) });
      }
    }
  }
  const rinde = (c: Candidato) => (c.ancho > c.credito ? c.credito / (c.ancho - c.credito) : 0);
  const okCount = (c: Candidato) => c.comp.filter((x) => x.ok).length;
  cands.sort((a, b) => Number(b.pasa) - Number(a.pasa) || okCount(b) - okCount(a) || rinde(b) - rinde(a));
  const out: Evaluacion = { iv, sigma, niveles: nv, dias, jugadas: [], mejorRechazado: null, motivo: null };
  if (cands.length === 0) out.motivo = "sin strikes cotizados";
  else if (cands[0].pasa) {
    out.jugadas.push(cands[0]);
    const otro = cands.find((c) => c.pasa && c.lado !== cands[0].lado);
    if (otro) out.jugadas.push(otro);
  } else {
    out.mejorRechazado = cands[0];
    out.motivo = "ningún spread pasa";
  }
  return out;
}

// ── Salidas ──
export interface Jugada {
  id: string;
  fecha: string;
  hora: Hora;
  plazo: number;
  vencimiento: string;
  lado: "put" | "call";
  corto: number;
  largo: number;
  ancho: number;
  credito: number;
  spotEntrada: number;
  ivEntrada: number;
  estado: "abierta" | "ganancia" | "stop" | "vencida";
  cerradaEl: string | null;
  resultado: number | null;
  salida: string;
  /** Precios de la entrada: "real" (llenados de MarketSnack / tastytrade) o "estimado" (Black-Scholes). */
  fuente?: string;
}

export function valorSpread(j: Pick<Jugada, "lado" | "corto" | "largo">, cot: Cotizacion[]): number | null {
  const c = cot.find((q) => q.tipo === j.lado && q.strike === j.corto);
  const l = cot.find((q) => q.tipo === j.lado && q.strike === j.largo);
  if (!c || !l || c.ask == null || l.bid == null) return null;
  return Math.max(0, Math.round((c.ask - l.bid) * 100) / 100);
}

/** Lecturas de 12:30 y 15:30: primero la toma de ganancia, luego el stop si cruzó el corto. */
export function seguimiento(j: Jugada, cot: Cotizacion[], spot: number): { estado: "ganancia" | "stop" | "abierta"; pnl: number | null; nota?: string } {
  const v = valorSpread(j, cot);
  if (v != null && v <= j.credito * (1 - REGLA.tomaGananciaPct)) return { estado: "ganancia", pnl: Math.round((j.credito - v) * 100) };
  if (j.lado === "put" ? spot < j.corto : spot > j.corto) {
    if (v == null) return { estado: "abierta", pnl: null, nota: "sin precio para salir, lo califica el cierre" };
    return { estado: "stop", pnl: Math.round((j.credito - Math.min(j.ancho, v)) * 100) };
  }
  return { estado: "abierta", pnl: null };
}

export function alVencer(j: Pick<Jugada, "lado" | "corto" | "ancho" | "credito">, cierre: number): number {
  const intr = Math.min(j.ancho, j.lado === "put" ? Math.max(0, j.corto - cierre) : Math.max(0, cierre - j.corto));
  return Math.round((j.credito - intr) * 100);
}

/** Después de las 16:00: vencida → crédito − intrínseco; antes de vencer y más allá del corto → stop estimado (BS, IV de entrada). */
export function calificarCierre(js: Jugada[], fecha: string, cierre: number): Jugada[] {
  const cambios: Jugada[] = [];
  for (const j of js) {
    if (j.estado !== "abierta" || fecha < j.fecha) continue;
    if (fecha >= j.vencimiento) {
      Object.assign(j, { estado: "vencida", cerradaEl: fecha, resultado: alVencer(j, cierre), salida: `Al vencimiento, cierre ${cierre.toFixed(2)}` });
      cambios.push(j);
      continue;
    }
    const cruzo = j.lado === "put" ? cierre < j.corto : cierre > j.corto;
    if (!cruzo || fecha === j.fecha) continue;
    const dias = (Date.parse(`${j.vencimiento}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000;
    const t = anios(dias);
    const v = Math.min(j.ancho, Math.max(0, bsPrecio(cierre, j.corto, t, j.ivEntrada, j.lado) - bsPrecio(cierre, j.largo, t, j.ivEntrada, j.lado)));
    Object.assign(j, { estado: "stop", cerradaEl: fecha, resultado: Math.round((j.credito - v) * 100), salida: `Stop: cerró en ${cierre.toFixed(2)}, más allá del corto (recompra estimada)` });
    cambios.push(j);
  }
  return cambios;
}
