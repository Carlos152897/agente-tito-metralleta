// POST /api/registro-operaciones/enter — registra la señal de HOY para SPX o
// TSLA. Lo llama el agente (schedule de Prueba de Fuego) cuando ve una
// sugerencia nueva de `/api/daytrade`, nunca la UI. Se guarda CUALQUIER
// sugerencia real (continuation o gex_only, ver `suggestion.role`) —
// confirmado con Carlos: las dos ya combinan flujo + GEX en su origen.
//
// TSLA: una entrada por día de mercado (mismo criterio que
// `dayTradePosition.ts`, "la sugerencia se fija una vez por día") — server-side
// valida de nuevo `hasLoggedToday`, no confía en que quien llama ya chequeó.
// SPX (pedido explícito de Carlos, 2026-08-04): modo "bitácora" — cada corrida
// del agente (cada 5 min) agrega una entrada NUEVA sin importar cuántas ya
// estén abiertas o cerradas hoy (`isContinuousLogTicker`), así queda un
// registro completo de cada lectura, no una sola posición fija por día.

import { buildEntry, hasLoggedToday, isContinuousLogTicker, openEntry } from "@/lib/registroOperaciones";
import { loadRegistroStore, saveRegistroStore } from "@/lib/registroOperacionesStore";
import { marketDateStr } from "@/lib/occ";
import type { ContractSuggestion } from "@/lib/dayTrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnterBody {
  suggestion: ContractSuggestion;
  entryPrice: number;
  entryGammaFlip: number | null;
}

function validSuggestion(s: unknown): s is ContractSuggestion {
  if (!s || typeof s !== "object") return false;
  const c = s as Partial<ContractSuggestion>;
  return (
    (c.ticker === "TSLA" || c.ticker === "SPX") &&
    typeof c.occRoot === "string" &&
    (c.type === "call" || c.type === "put") &&
    typeof c.strike === "number" &&
    c.strike > 0 &&
    typeof c.expiration === "string" &&
    !!c.expiration &&
    (c.role === "continuation" || c.role === "gex_only") &&
    typeof c.reason === "string" &&
    typeof c.target === "number" &&
    typeof c.spot === "number" &&
    c.spot > 0
  );
}

export async function POST(request: Request) {
  let body: EnterBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body JSON inválido." }, { status: 400 });
  }

  const { suggestion, entryPrice, entryGammaFlip } = body;
  if (!validSuggestion(suggestion) || !(entryPrice > 0)) {
    return Response.json({ error: "suggestion (válida) y entryPrice (> 0) son requeridos." }, { status: 400 });
  }
  if (entryGammaFlip !== null && typeof entryGammaFlip !== "number") {
    return Response.json({ error: "entryGammaFlip debe ser number o null." }, { status: 400 });
  }

  const now = new Date();
  const dayKey = marketDateStr(now);
  const store = await loadRegistroStore();
  if (!isContinuousLogTicker(suggestion.ticker) && hasLoggedToday(store, suggestion.ticker, dayKey)) {
    return Response.json({ error: `Ya hay una entrada registrada hoy para ${suggestion.ticker}.` }, { status: 409 });
  }

  const entry = buildEntry(suggestion, entryPrice, entryGammaFlip, now);
  const updated = openEntry(store, entry);
  await saveRegistroStore(updated);
  return Response.json({ store: updated });
}
