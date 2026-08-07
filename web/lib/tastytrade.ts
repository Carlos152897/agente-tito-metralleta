// Cliente tastytrade — Open API REST (sin WebSocket/DXLink: alcanza con
// /market-data/by-type, que da bid/ask/griegos/OI de hasta cientos de
// contratos en una sola llamada). OAuth2 con grant personal (ver
// .env.example): el refresh_token no expira, el access_token dura 15 min y se
// cachea en memoria del proceso hasta que vence.
//
// Reemplaza a Schwab como fuente de la cadena de opciones del Agente 0DTE —
// verificado en vivo (ago 2026): producción de tastytrade es tiempo real de
// fábrica (updated-at a segundos de la hora real), sin el isDelayed=true que
// daba Schwab acá. Ver lib/zerodteSchwab.ts, que queda solo para las barras
// intradía del subyacente (tastytrade no tiene REST de velas, solo DXLink).

export class TastytradeError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TastytradeError";
    this.status = status;
  }
}

const API_BASE = "https://api.tastyworks.com";
const USER_AGENT = "visionary-trades/1.0";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 10_000) return cachedToken.token;

  const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
  const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN;
  if (!clientSecret || !refreshToken) {
    throw new TastytradeError("Faltan TASTYTRADE_CLIENT_SECRET / TASTYTRADE_REFRESH_TOKEN en .env.local.");
  }

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new TastytradeError(`No se pudo autenticar con tastytrade (HTTP ${res.status}).`, res.status);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return cachedToken.token;
}

async function tastyGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const token = await getAccessToken();
  const url = `${API_BASE}${path}${params ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TastytradeError(`tastytrade ${path} → HTTP ${res.status}. ${body.slice(0, 160)}`.trim(), res.status);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export interface NestedChainStrike {
  "strike-price": string;
  call: string;
  put: string;
}

export interface NestedChainExpiration {
  "expiration-date": string;
  "days-to-expiration": number;
  strikes: NestedChainStrike[];
}

interface NestedChainItem {
  "underlying-symbol": string;
  expirations: NestedChainExpiration[];
}

/** Cadena anidada completa (todos los vencimientos) de un subyacente. */
export async function fetchNestedOptionChain(underlying: string): Promise<NestedChainExpiration[]> {
  const data = await tastyGet<{ items: NestedChainItem[] }>(
    `/option-chains/${encodeURIComponent(underlying)}/nested`,
  );
  return data.items?.[0]?.expirations ?? [];
}

export interface TastyQuote {
  symbol: string;
  bid?: string;
  ask?: string;
  last?: string;
  mark?: string;
  "open-interest"?: number;
  volume?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  volatility?: string;
}

/** Tope de símbolos por request — la URL de 100 ronda los ~2200 caracteres, con margen de sobra. */
const CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Cotizaciones en bloque de opciones (bid/ask/griegos/OI/volumen), en tandas paralelas. */
export async function fetchOptionQuotesByType(symbols: string[]): Promise<Map<string, TastyQuote>> {
  const out = new Map<string, TastyQuote>();
  const batches = chunk([...new Set(symbols)], CHUNK_SIZE);
  await Promise.all(
    batches.map(async (batch) => {
      if (batch.length === 0) return;
      const params = new URLSearchParams({ "equity-option": batch.join(",") });
      const data = await tastyGet<{ items: TastyQuote[] }>("/market-data/by-type", params);
      for (const q of data.items ?? []) out.set(q.symbol, q);
    }),
  );
  return out;
}

/** Precio del subyacente — índice (SPX/NDX) o equity/ETF (SPY/QQQ). */
export async function fetchUnderlyingQuote(symbol: string, isIndex: boolean): Promise<number | null> {
  const params = new URLSearchParams({ [isIndex ? "index" : "equity"]: symbol });
  const data = await tastyGet<{ items: TastyQuote[] }>("/market-data/by-type", params);
  const q = data.items?.[0];
  if (!q) return null;
  const n = (v: string | undefined) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  return n(q.last) ?? n(q.mark) ?? null;
}
