// GET /api/registro-operaciones — estado actual del Registro de Operaciones
// (entradas abiertas + historial cerrado de SPX/TSLA). Solo lectura; las
// entradas/salidas las hace el agente vía /enter y /evaluate.

import { loadRegistroStore } from "@/lib/registroOperacionesStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await loadRegistroStore();
  return Response.json({ store });
}
