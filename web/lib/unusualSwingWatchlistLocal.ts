// Favoritos de "Unusual Swing Trades" en el navegador — mismo motivo que
// lib/watchlistLocal.ts: se queda en el navegador de Carlos, sin servidor de por medio.

import { sortEntries, type UnusualSwingEntry } from "./unusualSwingWatchlist";
import { migrateLegacyKey } from "./legacyStorage";

const KEY = "visionary.unusualSwing.favorites";

export function loadEntries(): UnusualSwingEntry[] {
  if (typeof window === "undefined") return [];
  migrateLegacyKey("tito.unusualSwing.favorites", KEY);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UnusualSwingEntry[];
    return Array.isArray(parsed) ? sortEntries(parsed) : [];
  } catch {
    return []; // JSON corrupto: preferimos vacío a romper la página
  }
}

export function saveEntries(entries: UnusualSwingEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // cuota llena o modo privado: la lista sigue en memoria esta sesión
  }
}
