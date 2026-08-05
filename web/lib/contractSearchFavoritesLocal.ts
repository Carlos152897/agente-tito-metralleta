// Favoritos de "Búsqueda de contratos" en el navegador — mismo motivo que
// lib/unusualSwingWatchlistLocal.ts: se queda en el navegador de Carlos, sin
// servidor de por medio (nadie más necesita leer esta lista).

import { sortEntries, type ContractSearchFavoriteEntry } from "./contractSearchFavorites";
import { migrateLegacyKey } from "./legacyStorage";

const KEY = "visionary.contractSearch.favorites";

export function loadEntries(): ContractSearchFavoriteEntry[] {
  if (typeof window === "undefined") return [];
  migrateLegacyKey("tito.contractSearch.favorites", KEY);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContractSearchFavoriteEntry[];
    return Array.isArray(parsed) ? sortEntries(parsed) : [];
  } catch {
    return []; // JSON corrupto: preferimos vacío a romper la página
  }
}

export function saveEntries(entries: ContractSearchFavoriteEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // cuota llena o modo privado: la lista sigue en memoria esta sesión
  }
}
