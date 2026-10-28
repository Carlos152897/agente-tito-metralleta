// Guardado diario de los datos de la terminal de MarketSnack para VisionFutura (Carlos, 28-oct-2026:
// "mezclar toda esa información en mi proyecto", etapa 1 = base + guardado). MarketSnack SOLO da
// el día de hoy de estos 3 datos, así que se guardan mientras el día corre:
//   - presión por strike (una pata vs spreads): fotos cada 5 min → la repetición sabe cómo iba;
//   - prima neta minuto a minuto: la serie más larga del día (ya viene acumulada por minuto);
//   - operaciones inusuales: lista sin repetidos (por id).
// Archivo: data/vision-futura/marketsnack/{inst}-{fecha}.json. Imports relativos (scripts con tsx).

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  fetchNetPremiumSentiment, fetchOptionPressure, fetchUnusualTrades,
  type MsPremiumMinute, type MsPressure, type MsUnusualTrade,
} from "./marketsnack";
import { marketDateStr } from "./occ";

const DIR = join(process.cwd(), "data", "vision-futura", "marketsnack");

/** Cada cuánto se guarda una foto nueva de la presión por strike. */
export const PRESSURE_SNAP_MS = 5 * 60_000;
/** Cada cuánto se vuelve a pedir a MarketSnack (por instrumento) desde la carga en vivo. */
export const MS_REFRESH_MS = 60_000;

export interface MsPressureSnap extends MsPressure {
  /** ms de la foto. */
  t: number;
  spot: number;
}

export interface MsDay {
  inst: string;
  date: string;
  msTicker: string;
  expiration: string;
  updatedAt: number;
  premium: MsPremiumMinute[];
  pressure: MsPressureSnap[];
  unusual: MsUnusualTrade[];
}

export interface MsFresh {
  premium: MsPremiumMinute[];
  pressure: MsPressure;
  unusual: MsUnusualTrade[];
  spot: number;
}

/** Junta lo nuevo con lo guardado (PURO). `final` = última foto del día: se guarda aunque no hayan pasado 5 min. */
export function mergeMsDay(prev: MsDay | null, base: Omit<MsDay, "updatedAt" | "premium" | "pressure" | "unusual">, fresh: MsFresh, now: number, final = false): MsDay {
  const day: MsDay = prev && prev.expiration === base.expiration
    ? { ...prev }
    : { ...base, updatedAt: now, premium: [], pressure: [], unusual: [] };
  // Prima por minuto: la respuesta trae todo el día; se queda la más completa.
  if (fresh.premium.length >= day.premium.length) day.premium = fresh.premium;
  // Presión: foto nueva cada 5 min (o la final), solo si trae strikes.
  const lastSnap = day.pressure.at(-1);
  if (fresh.pressure.rows.length && (!lastSnap || final || now - lastSnap.t >= PRESSURE_SNAP_MS)) {
    day.pressure = [...day.pressure, { t: now, spot: fresh.spot, ...fresh.pressure }];
  }
  // Inusuales: sin repetidos, en orden de hora.
  const seen = new Set(day.unusual.map((u) => u.id));
  const add = fresh.unusual.filter((u) => !seen.has(u.id));
  if (add.length) day.unusual = [...day.unusual, ...add].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  day.updatedAt = now;
  return day;
}

const fileOf = (inst: string, date: string) => join(DIR, `${inst}-${date}.json`);

export function loadMsDay(inst: string, date: string): MsDay | null {
  try {
    return JSON.parse(readFileSync(fileOf(inst, date), "utf8")) as MsDay;
  } catch {
    return null;
  }
}

function saveMsDay(day: MsDay) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileOf(day.inst, day.date), JSON.stringify(day), "utf8");
}

// Última captura por instrumento (memoria del proceso): no pedir más de 1 vez por minuto.
const lastRun = new Map<string, { at: number; day: MsDay }>();

/**
 * Pide los 3 datos a MarketSnack, los junta con lo guardado y los guarda. Devuelve el día.
 * `force` = ignora el límite de 1/min y guarda foto final (tarea del cierre). Nunca lanza
 * error por MarketSnack: si falla, devuelve lo último guardado (o null).
 */
export async function captureMsDay(opts: { inst: string; msTicker: string; expiration: string; spot: number; now: Date; force?: boolean }): Promise<MsDay | null> {
  const date = marketDateStr(opts.now);
  const t = opts.now.getTime();
  const key = `${opts.inst}|${date}|${opts.expiration}`;
  const cached = lastRun.get(key);
  if (!opts.force && cached && t - cached.at < MS_REFRESH_MS) return cached.day;
  try {
    const [premium, pressure, unusual] = await Promise.all([
      fetchNetPremiumSentiment(opts.msTicker, opts.expiration),
      fetchOptionPressure(opts.msTicker, opts.expiration, opts.spot),
      fetchUnusualTrades(opts.msTicker, opts.expiration),
    ]);
    // Si MarketSnack todavía no tiene nada del día, no se crea archivo vacío.
    if (!premium.length && !pressure.rows.length && !unusual.length) return cached?.day ?? loadMsDay(opts.inst, date);
    const day = mergeMsDay(
      loadMsDay(opts.inst, date),
      { inst: opts.inst, date, msTicker: opts.msTicker, expiration: opts.expiration },
      { premium, pressure, unusual, spot: opts.spot },
      t,
      !!opts.force,
    );
    saveMsDay(day);
    lastRun.set(key, { at: t, day });
    return day;
  } catch {
    return cached?.day ?? loadMsDay(opts.inst, date);
  }
}
