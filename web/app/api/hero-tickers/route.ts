// GET /api/hero-tickers — franja de precios en vivo de la portada (ago 2026,
// pedido explícito de Carlos a partir de un mockup de referencia). Mismo
// principio que el resto del agente: nada de datos falsos — reusa
// `fetchAssetSnapshot` (lib/marketsnack.ts, ya construido para "Análisis del
// mercado") para el % real de hoy de un puñado de mega-caps fijas.

import { fetchAssetSnapshot, MarketSnackError } from "@/lib/marketsnack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META"];

export async function GET() {
  try {
    const results = await Promise.all(
      TICKERS.map(async (ticker) => {
        const snap = await fetchAssetSnapshot(ticker).catch(() => null);
        if (!snap?.price) return null;
        return { ticker, price: snap.price, changePct: snap.regularChangePct ?? snap.extendedChangePct ?? null };
      }),
    );
    return Response.json({ tickers: results.filter((r): r is NonNullable<typeof r> => r != null) });
  } catch (err) {
    const message = err instanceof MarketSnackError ? err.message : "Error inesperado.";
    return Response.json({ error: message }, { status: 502 });
  }
}
