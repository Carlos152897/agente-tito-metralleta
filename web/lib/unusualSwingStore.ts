// Copia en servidor de los favoritos de "Unusual Swing Trades" — solo servidor.
//
// El watchlist normal (lib/watchlistLocal.ts) vive SOLO en el navegador porque
// guarda saldo/sizing del usuario (privado). Acá no hay nada de eso — solo
// identidad de contrato + foto de mercado (volumen, OI, premium) — así que
// guardarlo también en el servidor no rompe esa regla, y es lo que permite que
// una tarea programada (que no puede leer el localStorage del navegador) revise
// el OI al día siguiente y avise.
//
// El navegador sigue siendo la fuente de verdad para la UI (localStorage,
// respuesta inmediata); esta copia se sincroniza en cada cambio, best-effort.

import { promises as fs } from "fs";
import path from "path";
import type { UnusualSwingEntry } from "./unusualSwingWatchlist";

const FILE = path.join(process.cwd(), "data", "unusualSwingFavorites.json");

export async function loadFavorites(): Promise<UnusualSwingEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as UnusualSwingEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveFavorites(entries: UnusualSwingEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(entries), "utf8");
}
