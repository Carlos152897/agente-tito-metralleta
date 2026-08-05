// Favoritos de "Búsqueda de contratos" — PURO. Mismo patrón que
// lib/unusualSwingWatchlist.ts: el escaneo agrega candidatos nuevos solo
// (Carlos los revisa y decide), "👎 No me gusta" los saca, "📌 Mantener" los
// blinda de una futura limpieza automática. La foto (target/convicción al
// momento de detectarlo) nunca se pisa, aunque un rescaneo la vuelva a traer.

import type { GexReference } from "@/app/prueba-de-fuego/types";

export interface ContractSearchFavoriteEntry {
  symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  addedAt: string;
  assetPrice: number;
  premium: number;
  size: number;
  target: number | null;
  convictionPct: number | null;
  changePctToTarget: number | null;
  estUsdGain: number | null;
  pinned: boolean;
  /** Solo SPY/SPX/QQQ (ver route.ts) — null para el resto (acciones: solo MarketSnack). */
  gexReference: GexReference | null;
}

/** Lo mínimo que necesita `buildEntry` — evita acoplar este módulo al SSE completo. */
export interface EntrySource {
  symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number | null;
  expiration: string | null;
  assetPrice: number;
  premium: number;
  size: number;
  target: number | null;
  convictionPct: number | null;
  changePctToTarget: number | null;
  estUsdGain: number | null;
  gexReference?: GexReference | null;
}

export function buildEntry(source: EntrySource, now: Date): ContractSearchFavoriteEntry | null {
  if (source.strike == null || source.expiration == null) return null;
  return {
    symbol: source.symbol,
    ticker: source.ticker,
    type: source.type,
    strike: source.strike,
    expiration: source.expiration,
    addedAt: now.toISOString(),
    assetPrice: source.assetPrice,
    premium: source.premium,
    size: source.size,
    target: source.target,
    convictionPct: source.convictionPct,
    changePctToTarget: source.changePctToTarget,
    estUsdGain: source.estUsdGain,
    pinned: false,
    gexReference: source.gexReference ?? null,
  };
}

/** Añade por símbolo. Si ya existe, se deja la foto original — no se pisa. */
export function upsert(
  entries: ContractSearchFavoriteEntry[],
  entry: ContractSearchFavoriteEntry,
): ContractSearchFavoriteEntry[] {
  if (entries.some((e) => e.symbol === entry.symbol)) return entries;
  return [entry, ...entries];
}

export function remove(entries: ContractSearchFavoriteEntry[], symbol: string): ContractSearchFavoriteEntry[] {
  return entries.filter((e) => e.symbol !== symbol);
}

/** Prende/apaga el blindaje de limpieza automática para un contrato ya guardado. */
export function togglePinned(entries: ContractSearchFavoriteEntry[], symbol: string): ContractSearchFavoriteEntry[] {
  return entries.map((e) => (e.symbol === symbol ? { ...e, pinned: !e.pinned } : e));
}

/** Las más recientes primero. */
export function sortEntries(entries: ContractSearchFavoriteEntry[]): ContractSearchFavoriteEntry[] {
  return [...entries].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/**
 * Saca los favoritos ya VENCIDOS (expiration < hoy) — la "futura limpieza
 * automática" de la que ya hablaba el comentario de arriba de 📌 Mantener,
 * que hasta ahora nunca se había construido (Carlos, 2026-07-30: "me estás
 * dando expirados"). Un contrato que vence HOY (0DTE) se conserva hasta que
 * pase el día de mercado — solo lo que ya quedó atrás se saca. Los
 * 📌 Mantenidos quedan blindados a propósito, tal como se documentó siempre.
 * `todayStr` en el mismo formato YYYY-MM-DD que `expiration` (ver
 * lib/occ.ts `marketDateStr`).
 */
export function pruneExpired(
  entries: ContractSearchFavoriteEntry[],
  todayStr: string,
): ContractSearchFavoriteEntry[] {
  return entries.filter((e) => e.pinned || e.expiration >= todayStr);
}
