// Persistencia del Registro de Operaciones. web/data/registro-operaciones.json
// (gitignored, mismo patrón que paperTradingStore.ts/outboxStore.ts). Solo
// servidor — la lógica pura vive en lib/registroOperaciones.ts. Un solo
// agente escribe acá (la tarea programada de Prueba de Fuego), así que no
// hace falta lock de concurrencia.

import { promises as fs } from "fs";
import path from "path";
import { emptyStore, type RegistroStore } from "./registroOperaciones";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "registro-operaciones.json");

export async function loadRegistroStore(): Promise<RegistroStore> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as RegistroStore;
    if (!Array.isArray(parsed.open) || !Array.isArray(parsed.closed)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore(); // primera vez: todavía no existe el archivo
  }
}

export async function saveRegistroStore(store: RegistroStore): Promise<RegistroStore> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
  return store;
}
