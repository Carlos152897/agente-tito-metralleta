// /api/marketsnack-cookie — estado y actualización de la cookie de sesión de MarketSnack.
//
//   GET                    → { present, working, message, updatedAt, source, fingerprint }
//   POST { cookie, source? } → normaliza, prueba contra MarketSnack Y SOLO SI SIRVE la guarda
//
// La cookie completa NUNCA sale de aquí — ni en GET ni en la respuesta del POST, solo la
// huella parcial de `fingerprint()`. Consumido por app/ajustes/page.tsx y, vía POST, por el
// extractor automático (scripts/marketsnack-cookie/).

import { testMarketSnackCookie } from "@/lib/marketsnack";
import {
  fingerprint,
  loadCookieMeta,
  looksLikeSessionCookie,
  normalizeCookie,
  saveCookie,
} from "@/lib/marketsnackCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const meta = await loadCookieMeta();
  if (!meta.cookie) {
    return Response.json({
      present: false,
      working: false,
      message: "No hay ninguna cookie guardada todavía.",
      updatedAt: null,
      source: "none",
      fingerprint: null,
    });
  }

  const test = await testMarketSnackCookie(meta.cookie);
  return Response.json({
    present: true,
    working: test.ok,
    message: test.message,
    updatedAt: meta.updatedAt,
    source: meta.source,
    fingerprint: fingerprint(meta.cookie),
  });
}

export async function POST(request: Request) {
  let body: { cookie?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "Cuerpo inválido." }, { status: 400 });
  }

  const raw = typeof body.cookie === "string" ? body.cookie : "";
  const normalized = normalizeCookie(raw);
  if (!normalized) {
    return Response.json({ ok: false, message: "Pega la cookie primero." }, { status: 400 });
  }
  if (!looksLikeSessionCookie(normalized)) {
    return Response.json(
      {
        ok: false,
        message:
          'No encuentro "_market_snack_session" en lo que se pegó. Copia el header Cookie COMPLETO desde DevTools → Network → petición a /api/flow_feed.',
      },
      { status: 400 },
    );
  }

  // Prueba ANTES de guardar: si no sirve, se rechaza y la cookie buena (si había una) no se toca.
  const test = await testMarketSnackCookie(normalized);
  if (!test.ok) {
    return Response.json({ ok: false, message: test.message }, { status: 422 });
  }

  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "ajustes";
  const saved = await saveCookie(normalized, source);
  return Response.json({
    ok: true,
    message: test.message,
    updatedAt: saved.updatedAt,
    fingerprint: fingerprint(saved.cookie),
  });
}
