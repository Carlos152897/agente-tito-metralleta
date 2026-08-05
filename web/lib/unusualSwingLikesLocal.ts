// "Agregar a Robinhood" de Unusual Swing Trades en el navegador — mismo patrón
// que lib/contractSearchLikesLocal.ts (tipo genérico LikedContract, reusado tal
// cual), pero con su propia clave: es un "me gusta" independiente del de
// Búsqueda de contratos, cada pestaña con su propia cola pendiente.

import { sortLikes, type LikedContract } from "./contractSearchLikes";

const KEY = "tito.unusualSwing.robinhoodLikes";

export function loadLikes(): LikedContract[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LikedContract[];
    return Array.isArray(parsed) ? sortLikes(parsed) : [];
  } catch {
    return []; // JSON corrupto: preferimos vacío a romper la página
  }
}

export function saveLikes(entries: LikedContract[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // cuota llena o modo privado: la lista sigue en memoria esta sesión
  }
}
