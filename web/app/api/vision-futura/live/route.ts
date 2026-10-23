// GET /api/vision-futura/live?inst=SPX|NQ|TSLA — precio EN VIVO de VisionFutura:
// el subyacente, su ETF, su futuro y su índice de volatilidad (si tiene) en una
// sola llamada a tastytrade, pensada para pedirse cada pocos segundos. Los niveles
// (GEX de MarketSnack) siguen saliendo de /api/vision-futura, que es más pesado.
// Los nombres de los campos (`spx`, `spy`, `es`, `vix`) se conservan por
// compatibilidad: son "principal", "ETF", "futuro" y "volatilidad" del instrumento.

import { fetchActiveFuture, fetchLiveQuotes, TastytradeError } from "@/lib/tastytrade";
import { instrumentOf } from "@/lib/visionFuturaInstruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El contrato activo de cada futuro cambia solo en el roll trimestral: se cachea 1 h.
const futCache = new Map<string, { symbol: string; at: number }>();
async function activeFuture(product: string): Promise<string | null> {
  const c = futCache.get(product);
  if (c && Date.now() - c.at < 3_600_000) return c.symbol;
  const f = await fetchActiveFuture(product).catch(() => null);
  if (f) futCache.set(product, { symbol: f.symbol, at: Date.now() });
  return f?.symbol ?? c?.symbol ?? null;
}

export async function GET(req: Request) {
  const cfg = instrumentOf(new URL(req.url).searchParams.get("inst"));
  try {
    const futSymbol = cfg.future ? await activeFuture(cfg.future) : null;
    const index = [cfg.tastyMain.index, cfg.volIndex].filter((x): x is string => !!x);
    const equity = [cfg.tastyMain.equity, cfg.etf].filter((x): x is string => !!x);
    const q = await fetchLiveQuotes({ index, equity, future: futSymbol ? [futSymbol] : [] });
    const main = q.get(cfg.main);
    if (!main) return Response.json({ error: `tastytrade no devolvió ${cfg.main}.` }, { status: 502 });
    const vol = cfg.volIndex ? q.get(cfg.volIndex) : null;
    return Response.json({
      asOf: new Date().toISOString(),
      source: "tastytrade",
      instrument: cfg.id,
      spx: main.price,
      spxUpdatedAt: main.updatedAt,
      spy: cfg.etf ? q.get(cfg.etf)?.price ?? null : null,
      es: futSymbol ? q.get(futSymbol)?.price ?? null : null,
      esSymbol: futSymbol,
      vix: vol ? { last: vol.price, prevClose: vol.prevClose } : null,
    });
  } catch (err) {
    const message = err instanceof TastytradeError ? err.message : "Error leyendo precios en vivo.";
    return Response.json({ error: message }, { status: 502 });
  }
}
