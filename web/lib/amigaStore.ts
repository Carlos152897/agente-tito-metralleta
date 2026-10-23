// Datos y estado de "Verticales amiga" (regla Sombra 1–5 DTE, lib/amigaVerticales.ts):
//   - processAmigaDay(fecha): backtest de un día con datos REALES de MarketSnack (precio SPX
//     cada 5 min, OI de cada vencimiento, llenados promedio al bid/ask de cada contrato). Hace
//     las lecturas de 10:00, 12:30 y 15:30 (las que ya pasaron), registra las jugadas, revisa
//     tomas de ganancia / stops de las abiertas y, después de las 16:00, califica con el cierre.
//     Historial acumulado entre días (como historial_sombra.csv del script) en
//     data/vision-futura/amiga/historial.json.
//   - amigaLive(): lectura de AHORA con cotizaciones en vivo de tastytrade (bid/ask/OI reales).
//   - Calendario de eventos (compuerta N): data/vision-futura/amiga/eventos.json, editable.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  HORAS, calificarCierre, evaluar, seguimiento, REGLA,
  type Candidato, type Cotizacion, type Evaluacion, type Evento, type Hora, type Jugada,
} from "./amigaVerticales";
import { fetchAssetPriceChart, fetchContractTradeSummary, fetchOptionChainExtended } from "./marketsnack";
import { fetchNestedOptionChain, fetchOptionQuotesByType, fetchUnderlyingQuote } from "./tastytrade";
import { buildOccSymbol, marketDateStr } from "./occ";

const DIR = join(process.cwd(), "data", "vision-futura", "amiga");
const HIST = join(DIR, "historial.json");
const EVENTOS = join(DIR, "eventos.json");
/** Strikes que se miran alrededor del precio (los Δ 0.10–0.20 a 5 días caen a ~1–1.5σ). */
const RANGO = 250;

export interface LecturaPlazo {
  plazo: number;
  vencimiento: string;
  iv: number | null;
  sigma: number | null;
  iman: number | null;
  muroPut: number | null;
  muroCall: number | null;
  jugadas: Candidato[];
  motivo: string | null;
  mejorRechazado: Candidato | null;
  /** Fracción de patas evaluadas con precio real (resto: Black-Scholes). */
  pctReal?: number;
}

export interface Lectura { fecha: string; hora: Hora | "ahora"; spot: number; plazos: LecturaPlazo[]; at: string }

export interface AmigaHistorial {
  jugadas: Jugada[];
  lecturas: Lectura[];
  /** Pasos ya procesados ("2026-10-22:10:00", "2026-10-22:cierre"), para no duplicar. */
  procesadas: string[];
  /** Salidas registradas (para mostrarlas en la repetición). */
  eventos: { fecha: string; hora: string; jugadaId: string; texto: string }[];
}

const SEED_EVENTOS: (Evento & { nota?: string })[] = [
  { fecha: "2026-10-28", tipo: "FOMC", nota: "Decisión de la Fed (reunión 27–28 oct 2026). Confirmar en federalreserve.gov." },
];

export function loadEventos(): Evento[] {
  try {
    return JSON.parse(readFileSync(EVENTOS, "utf8")) as Evento[];
  } catch {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(EVENTOS, JSON.stringify(SEED_EVENTOS, null, 2), "utf8");
    return SEED_EVENTOS;
  }
}

export function loadHistorial(): AmigaHistorial {
  try {
    const h = JSON.parse(readFileSync(HIST, "utf8")) as Partial<AmigaHistorial>;
    return { jugadas: h.jugadas ?? [], lecturas: h.lecturas ?? [], procesadas: h.procesadas ?? [], eventos: h.eventos ?? [] };
  } catch {
    return { jugadas: [], lecturas: [], procesadas: [], eventos: [] };
  }
}

function saveHistorial(h: AmigaHistorial) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(HIST, JSON.stringify(h, null, 2), "utf8");
}

function nyOffset(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T16:00:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
}
const nyMs = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00${nyOffset(date)}`);
const diasHasta = (venc: string, ms: number) => (nyMs(venc, "16:00") - ms) / 86_400_000;

function toLecturaPlazo(plazo: number, venc: string, r: Evaluacion, pctReal?: number): LecturaPlazo {
  return {
    plazo, vencimiento: venc, iv: r.iv, sigma: r.sigma,
    iman: r.niveles?.iman ?? null, muroPut: r.niveles?.muroPut?.[0] ?? null, muroCall: r.niveles?.muroCall?.[0] ?? null,
    jugadas: r.jugadas, motivo: r.motivo, mejorRechazado: r.mejorRechazado, pctReal,
  };
}

/** Los 5 vencimientos SPX siguientes a `fecha` (cadena de tastytrade, que incluye los SPXW diarios). */
async function proximosVencimientos(fecha: string): Promise<string[]> {
  const exps = await fetchNestedOptionChain("SPX");
  return [...new Set(exps.map((e) => e["expiration-date"]))].filter((d) => d > fecha).sort().slice(0, REGLA.plazos);
}

// ───────────────────────── Backtest de un día (MarketSnack) ─────────────────────────

export async function processAmigaDay(fecha: string, now: Date): Promise<{ hechas: string[]; historial: AmigaHistorial }> {
  const h = loadHistorial();
  const eventos = loadEventos();
  const pendientes = HORAS.filter((hr) => nyMs(fecha, hr) <= now.getTime() && !h.procesadas.includes(`${fecha}:${hr}`));
  const cierrePendiente = now.getTime() >= nyMs(fecha, "16:00") && !h.procesadas.includes(`${fecha}:cierre`);
  if (pendientes.length === 0 && !cierrePendiente) return { hechas: [], historial: h };

  // Precio del SPX del día (5 min). El /chart solo trae la última sesión.
  const chart = (await fetchAssetPriceChart("SPX")).map((p) => ({ ms: Date.parse(p.t), v: p.v }))
    .filter((p) => marketDateStr(new Date(p.ms)) === fecha).sort((a, b) => a.ms - b.ms);
  if (chart.length === 0) throw new Error(`MarketSnack no tiene el precio intradía del ${fecha}.`);
  const spotAt = (ms: number) => { let v = chart[0].v; for (const p of chart) { if (p.ms <= ms) v = p.v; else break; } return v; };

  const vencs = await proximosVencimientos(fecha);
  // Vencimientos de las jugadas abiertas (para el seguimiento), aunque ya no estén entre los 5.
  const abiertasVencs = [...new Set(h.jugadas.filter((j) => j.estado === "abierta" && j.vencimiento >= fecha).map((j) => j.vencimiento))];
  const todosVencs = [...new Set([...vencs, ...abiertasVencs])];

  // Cadena (OI + IV) de cada vencimiento y los contratos que hay que mirar.
  const spotRef = spotAt(nyMs(fecha, "10:00"));
  const chains = new Map<string, { strike: number; type: "call" | "put"; oi: number; iv: number | null }[]>();
  for (const v of todosVencs) {
    const c = await fetchOptionChainExtended("SPX", v).catch(() => []);
    chains.set(v, c.map((x) => ({ strike: x.strike, type: x.type, oi: x.open_interest || 0, iv: x.implied_volatility })));
  }
  const necesarios = new Set<string>(); // `${venc}|${type}|${strike}`
  for (const v of todosVencs) {
    const c = chains.get(v) ?? [];
    // ATM de cada lectura (para la IV del dinero): todos los strikes dentro del rango que
    // recorrió el SPX en el día, ± 10 pts.
    const lo = Math.min(...chart.map((p) => p.v)) - 10, hi = Math.max(...chart.map((p) => p.v)) + 10;
    for (const x of c) {
      if (Math.abs(x.strike - spotRef) > RANGO) continue;
      if (x.oi >= REGLA.oiMinPata || (x.strike >= lo && x.strike <= hi)) necesarios.add(`${v}|${x.type}|${x.strike}`);
    }
  }
  for (const j of h.jugadas.filter((j) => j.estado === "abierta")) {
    necesarios.add(`${j.vencimiento}|${j.lado}|${j.corto}`);
    necesarios.add(`${j.vencimiento}|${j.lado}|${j.largo}`);
  }
  // Llenados de cada contrato (5 min) del día.
  const fills = new Map<string, { ms: number; ask: number; askVol: number; bid: number; bidVol: number }[]>();
  const lista = [...necesarios];
  for (let i = 0; i < lista.length; i += 6) {
    await Promise.all(lista.slice(i, i + 6).map(async (key) => {
      const [venc, type, strike] = key.split("|");
      const sym = buildOccSymbol({ underlying: "SPXW", expiration: venc, type: type as "call" | "put", strike: Number(strike) });
      const b = await fetchContractTradeSummary(sym).catch(() => []);
      fills.set(key, b.map((x) => ({ ms: Date.parse(x.t), ask: x.ask_premium || 0, askVol: x.ask_volume || 0, bid: x.bid_premium || 0, bidVol: x.bid_volume || 0 })));
    }));
  }

  // Cotización de un vencimiento a la hora T, SOLO con precios reales: el promedio de los
  // llenados al ask y al bid de MarketSnack en los 30 min previos (el último bloque con
  // operaciones de cada lado). Si los dos promedios se cruzan (son de momentos distintos), el
  // menor es el bid y el mayor el ask. Con un solo lado, ese precio ± medio centavo de tick
  // ($0.05). Sin ninguna operación → sin bid/ask: la compuerta P de la regla lo rechaza (la
  // regla exige precio real; NO se inventa uno con Black-Scholes).
  const VENTANA = 30 * 60_000;
  const cotizar = (venc: string, T: number, _spot: number) => {
    const out: Cotizacion[] = [];
    let reales = 0;
    const c = chains.get(venc) ?? [];
    for (const key of necesarios) {
      const [v, type, strikeS] = key.split("|");
      if (v !== venc) continue;
      const strike = Number(strikeS);
      const info = c.find((x) => x.strike === strike && x.type === type);
      let ask: number | null = null, bid: number | null = null;
      for (const b of fills.get(key) ?? []) {
        if (b.ms >= T || b.ms < T - VENTANA) continue;
        if (b.askVol > 0) ask = b.ask / (b.askVol * 100);
        if (b.bidVol > 0) bid = b.bid / (b.bidVol * 100);
      }
      if (ask != null && bid != null) { const lo = Math.min(ask, bid), hi = Math.max(ask, bid); bid = lo; ask = hi; }
      else if (ask != null) bid = Math.max(0, ask - 0.05);
      else if (bid != null) ask = bid + 0.05;
      if (ask != null && bid != null) reales++;
      const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
      out.push({ strike, tipo: type as "call" | "put", bid: r2(bid), ask: r2(ask), oi: info?.oi ?? 0 });
    }
    // El resto de la cadena (OI < 800, sin precio pedido) entra igual, sin bid/ask: así un
    // candidato con una pata ilíquida falla L/P como en el script, en vez de "no existir".
    const pedidos = new Set(out.map((q) => `${q.tipo}:${q.strike}`));
    for (const x of c) {
      if (Math.abs(x.strike - _spot) > RANGO || pedidos.has(`${x.type}:${x.strike}`)) continue;
      out.push({ strike: x.strike, tipo: x.type, bid: null, ask: null, oi: x.oi });
    }
    return { cot: out, pctReal: reales / Math.max(1, pedidos.size) };
  };

  const hechas: string[] = [];
  for (const hora of pendientes) {
    const T = nyMs(fecha, hora);
    const spot = spotAt(T);
    // 1) Seguimiento de las abiertas (12:30 y 15:30), con los precios de AHORA.
    if (hora !== "10:00") {
      for (const j of h.jugadas) {
        if (j.estado !== "abierta" || fecha < j.fecha || (j.fecha === fecha && j.hora === hora)) continue;
        const { cot } = cotizar(j.vencimiento, T, spot);
        const s = seguimiento(j, cot, spot);
        if (s.estado === "ganancia" || s.estado === "stop") {
          // Precio de recompra: se despeja del resultado (ganancia: crédito − v; stop: crédito − min(ancho, v)).
          const v = Math.min(j.ancho, j.credito - (s.pnl ?? 0) / 100);
          const texto = `${s.estado === "ganancia" ? "Toma de ganancia" : "Stop"} a las ${hora}: se recompró a $${v.toFixed(2)}`;
          Object.assign(j, { estado: s.estado, cerradaEl: fecha, resultado: s.pnl, salida: texto });
          h.eventos.push({ fecha, hora, jugadaId: j.id, texto: `${j.id} → ${s.estado}: $${s.pnl} · ${texto}` });
        }
      }
    }
    // 2) Lectura de los 5 plazos y registro de jugadas nuevas.
    const plazos: LecturaPlazo[] = [];
    vencs.forEach((venc, i) => {
      const { cot, pctReal } = cotizar(venc, T, spot);
      const r = evaluar(cot, spot, fecha, venc, hora, diasHasta(venc, T), eventos);
      plazos.push(toLecturaPlazo(i + 1, venc, r, pctReal));
      for (const c of r.jugadas) {
        const id = `${fecha}:${hora}:SPX:${i + 1}:${c.lado}`;
        if (h.jugadas.some((j) => j.id === id)) continue;
        h.jugadas.push({
          id, fecha, hora, plazo: i + 1, vencimiento: venc, lado: c.lado, corto: c.corto, largo: c.largo, ancho: c.ancho,
          credito: c.credito, spotEntrada: spot, ivEntrada: Math.round((r.iv ?? 0) * 10_000) / 10_000,
          estado: "abierta", cerradaEl: null, resultado: null, salida: "",
          fuente: `${Math.round(pctReal * 100)}% precios reales`,
        });
      }
    });
    h.lecturas = h.lecturas.filter((l) => !(l.fecha === fecha && l.hora === hora));
    h.lecturas.push({ fecha, hora, spot, plazos, at: new Date(T).toISOString() });
    h.procesadas.push(`${fecha}:${hora}`);
    hechas.push(hora);
  }

  if (cierrePendiente) {
    const cierre = chart[chart.length - 1].v;
    for (const j of calificarCierre(h.jugadas, fecha, cierre)) {
      h.eventos.push({ fecha, hora: "16:00", jugadaId: j.id, texto: `${j.id} → ${j.estado}: $${j.resultado} · ${j.salida}` });
    }
    h.procesadas.push(`${fecha}:cierre`);
    hechas.push("cierre");
  }
  saveHistorial(h);
  return { hechas, historial: h };
}

// ───────────────────────── Lectura en vivo (tastytrade) ─────────────────────────

let liveCache: { at: number; lectura: Lectura } | null = null;

export async function amigaLive(now: Date): Promise<Lectura> {
  if (liveCache && now.getTime() - liveCache.at < 60_000) return liveCache.lectura;
  const hoy = marketDateStr(now);
  const exps = await fetchNestedOptionChain("SPX");
  const vencs = [...new Set(exps.map((e) => e["expiration-date"]))].filter((d) => d > hoy).sort().slice(0, REGLA.plazos);
  const spot = await fetchUnderlyingQuote("SPX", true);
  if (!spot) throw new Error("tastytrade no devolvió el precio del SPX.");
  const eventos = loadEventos();
  // Para la compuerta N la regla distingue la lectura de las 15:30 (el evento de hoy ya pasó).
  const nyMin = (() => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
    return (Number(p.find((x) => x.type === "hour")?.value) % 24) * 60 + Number(p.find((x) => x.type === "minute")?.value);
  })();
  const horaRegla: Hora = nyMin >= 15 * 60 + 30 ? "15:30" : nyMin >= 12 * 60 + 30 ? "12:30" : "10:00";
  const n = (v: string | number | undefined | null) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const plazos: LecturaPlazo[] = [];
  for (const [i, venc] of vencs.entries()) {
    const exp = exps.find((e) => e["expiration-date"] === venc);
    if (!exp) continue;
    const strikes = exp.strikes.filter((s) => Math.abs(Number(s["strike-price"]) - spot) <= RANGO);
    const quotes = await fetchOptionQuotesByType(strikes.flatMap((s) => [s.call, s.put]).filter(Boolean));
    const cot: Cotizacion[] = [];
    for (const s of strikes) {
      for (const [tipo, sym] of [["call", s.call], ["put", s.put]] as const) {
        const q = quotes.get(sym);
        if (!q) continue;
        cot.push({ strike: Number(s["strike-price"]), tipo, bid: n(q.bid), ask: n(q.ask), oi: n(q["open-interest"]) ?? 0 });
      }
    }
    const r = evaluar(cot, spot, hoy, venc, horaRegla, diasHasta(venc, now.getTime()), eventos);
    plazos.push(toLecturaPlazo(i + 1, venc, r, 1));
  }
  const lectura: Lectura = { fecha: hoy, hora: "ahora", spot, plazos, at: now.toISOString() };
  liveCache = { at: now.getTime(), lectura };
  return lectura;
}

// ───────────────────────── Resumen (como `resumen` del script) ─────────────────────────

export function resumenAmiga(js: Jugada[]) {
  const cal = js.filter((j) => j.resultado != null);
  const tot = cal.reduce((s, j) => s + (j.resultado ?? 0), 0);
  const peor = cal.length ? cal.reduce((a, b) => ((a.resultado ?? 0) <= (b.resultado ?? 0) ? a : b)) : null;
  const tabla = [];
  for (let plazo = 1; plazo <= REGLA.plazos; plazo++) {
    for (const hora of HORAS) {
      const g = js.filter((j) => j.plazo === plazo && j.hora === hora);
      const c = g.filter((j) => j.resultado != null);
      const t = c.reduce((s, j) => s + (j.resultado ?? 0), 0);
      tabla.push({ plazo, hora, jugadas: g.length, calificadas: c.length, ganadas: c.filter((j) => (j.resultado ?? 0) > 0).length, total: t, media: c.length ? t / c.length : null });
    }
  }
  return {
    jugadas: js.length,
    calificadas: cal.length,
    abiertas: js.filter((j) => j.estado === "abierta").length,
    ganadas: cal.filter((j) => (j.resultado ?? 0) > 0).length,
    total: tot,
    media: cal.length ? tot / cal.length : null,
    peor,
    tabla,
  };
}
