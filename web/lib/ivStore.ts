// Historial diario de IV (sub-agente 5 — Contexto IV).
// El IV Rank real necesita 52 semanas de IV histórica y ninguna de nuestras fuentes
// la vende. Igual que con la cadena, guardamos una foto por día de mercado para que
// el rank real vaya reemplazando al proxy de volatilidad realizada. Solo servidor.

import { promises as fs } from "fs";
import path from "path";
import { marketDateStr } from "./occ";
import type { IvContextScore } from "./ivcontext";

const DATA_DIR = path.join(process.cwd(), "data", "iv");

/** 52 semanas — la ventana estándar del IV Rank. */
export const IV_HISTORY_DAYS = 365;

export interface IvSnapshot {
  date: string; // fecha de mercado (ET)
  savedAt: string;
  avgIv: number; // IV ponderada por premium, en %
  minIv: number | null;
  maxIv: number | null;
  contracts: number;
  frontSkew: number | null;
}

export interface IvHistory {
  ticker: string;
  updatedAt: string;
  snapshots: IvSnapshot[]; // más reciente primero
}

function fileFor(ticker: string): string {
  const safe = ticker.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function loadIvHistory(ticker: string): Promise<IvHistory | null> {
  try {
    const raw = await fs.readFile(fileFor(ticker), "utf8");
    const parsed = JSON.parse(raw) as IvHistory;
    return Array.isArray(parsed.snapshots) ? parsed : null;
  } catch {
    return null;
  }
}

/** Guarda la IV del día (una por fecha de mercado) y devuelve el historial recortado. */
export async function saveIvSnapshot(
  ticker: string,
  s: IvContextScore,
  now: Date = new Date(),
): Promise<IvHistory> {
  const clean = ticker.trim().toUpperCase();
  const date = marketDateStr(now);

  const existing = await loadIvHistory(clean);
  if (s.iv.current == null) {
    return existing ?? { ticker: clean, updatedAt: now.toISOString(), snapshots: [] };
  }

  const snapshot: IvSnapshot = {
    date,
    savedAt: now.toISOString(),
    avgIv: s.iv.current,
    minIv: s.iv.min,
    maxIv: s.iv.max,
    contracts: s.iv.contracts,
    frontSkew: s.frontSkew,
  };

  const byDate = new Map<string, IvSnapshot>();
  for (const snap of existing?.snapshots ?? []) byDate.set(snap.date, snap);
  byDate.set(date, snapshot);

  const snapshots = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, IV_HISTORY_DAYS);

  const payload: IvHistory = { ticker: clean, updatedAt: now.toISOString(), snapshots };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fileFor(clean), JSON.stringify(payload), "utf8");
  return payload;
}
