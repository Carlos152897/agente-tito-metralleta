// Copia en servidor de "Agregar a Robinhood" de Unusual Swing Trades — solo
// servidor. Mismo motivo que lib/contractSearchLikesStore.ts: el agente no
// puede leer el localStorage del navegador, así que necesita esta copia para
// drenarla por MCP hacia Robinhood.

import { promises as fs } from "fs";
import path from "path";
import type { LikedContract } from "./contractSearchLikes";

const FILE = path.join(process.cwd(), "data", "unusualSwingRobinhoodLikes.json");

export async function loadLikes(): Promise<LikedContract[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as LikedContract[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLikes(entries: LikedContract[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(entries), "utf8");
}
