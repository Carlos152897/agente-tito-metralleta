// Favoritos de "Unusual Swing Trades" — PURO. Persistencia en
// lib/unusualSwingWatchlistLocal.ts (mismo split que lib/watchlist.ts, pero sin
// sizing/broker: acá solo importa la foto del contrato al momento de detectarlo).
//
// El escaneo agrega candidatos nuevos automáticamente (Carlos revisa la lista
// todos los días); el botón de "no me gusta" es lo que los saca. Volver a
// detectar el mismo contrato no pisa la foto original.

export interface UnusualSwingEntry {
  symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  addedAt: string;
  assetPriceAtDetection: number;
  volume: number;
  openInterest: number;
  premium: number;
  delta: number;
  dte: number | null;
  /** Blindado de una futura limpieza automática — no tiene efecto todavía por sí solo. */
  pinned: boolean;
}

/** Lo mínimo que necesita `buildEntry` — evita acoplar este módulo al FlowRow completo. */
export interface EntrySource {
  symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  dte: number | null;
  assetPrice: number;
  volume: number;
  openInterest: number;
  premium: number;
  delta: number;
}

export function buildEntry(source: EntrySource, now: Date): UnusualSwingEntry {
  return {
    symbol: source.symbol,
    ticker: source.ticker,
    type: source.type,
    strike: source.strike,
    expiration: source.expiration,
    addedAt: now.toISOString(),
    assetPriceAtDetection: source.assetPrice,
    volume: source.volume,
    openInterest: source.openInterest,
    premium: source.premium,
    delta: source.delta,
    dte: source.dte,
    pinned: false,
  };
}

/** Prende/apaga el blindaje de limpieza automática para un contrato ya guardado. */
export function togglePinned(entries: UnusualSwingEntry[], symbol: string): UnusualSwingEntry[] {
  return entries.map((e) => (e.symbol === symbol ? { ...e, pinned: !e.pinned } : e));
}

/** Añade por símbolo. Si ya existe, se deja la foto original — no se pisa. */
export function upsert(entries: UnusualSwingEntry[], entry: UnusualSwingEntry): UnusualSwingEntry[] {
  if (entries.some((e) => e.symbol === entry.symbol)) return entries;
  return [entry, ...entries];
}

export function remove(entries: UnusualSwingEntry[], symbol: string): UnusualSwingEntry[] {
  return entries.filter((e) => e.symbol !== symbol);
}

/** Las más recientes primero. */
export function sortEntries(entries: UnusualSwingEntry[]): UnusualSwingEntry[] {
  return [...entries].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}
