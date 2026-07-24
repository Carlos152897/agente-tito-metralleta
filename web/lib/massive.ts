// Cliente de Massive (massive.com — antes Polygon.io). Solo se usa en el servidor.

import type { CompanyInfo, DailyBar, RawContract, TfBar } from "./types";

const BASE_URL = "https://api.massive.com";

const EXCHANGE_NAMES: Record<string, string> = {
  XNAS: "Nasdaq",
  XNYS: "NYSE",
  ARCX: "NYSE Arca",
  XASE: "NYSE American",
  BATS: "Cboe BZX",
  IEXG: "IEX",
};

export class MassiveError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MassiveError";
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new MassiveError("Falta MASSIVE_API_KEY en el entorno (.env.local).");
  return key;
}

function maxPages(): number {
  const n = Number(process.env.MASSIVE_MAX_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
}

export interface FetchProgress {
  /** Se llama al terminar cada página, con el número de página y el total acumulado. */
  onPage?: (page: number, accumulated: number) => void | Promise<void>;
}

export interface ChainResult {
  contracts: RawContract[];
  underlyingPrice: number | null;
  pages: number;
  truncated: boolean;
}

/**
 * Descarga la option chain completa de un ticker siguiendo la paginación por `next_url`.
 * Emite progreso por página. Corta en MASSIVE_MAX_PAGES como salvaguarda.
 */
export async function fetchOptionChain(
  ticker: string,
  progress: FetchProgress = {},
): Promise<ChainResult> {
  const key = apiKey();
  const limit = maxPages();
  const clean = ticker.trim().toUpperCase();
  if (!clean) throw new MassiveError("Ticker vacío.");

  const contracts: RawContract[] = [];
  let underlyingPrice: number | null = null;
  let url: string | null =
    `${BASE_URL}/v3/snapshot/options/${encodeURIComponent(clean)}?limit=250`;
  let page = 0;
  let truncated = false;

  while (url) {
    page += 1;
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MassiveError(
        describeStatus(res.status, clean, body),
        res.status,
      );
    }

    const json: {
      results?: RawContract[];
      next_url?: string;
    } = await res.json();

    const results = json.results ?? [];
    for (const c of results) {
      contracts.push(c);
      if (underlyingPrice === null && typeof c.underlying_asset?.price === "number") {
        underlyingPrice = c.underlying_asset.price;
      }
    }

    await progress.onPage?.(page, contracts.length);

    if (page >= limit) {
      truncated = Boolean(json.next_url);
      break;
    }
    url = json.next_url ?? null;
  }

  return { contracts, underlyingPrice, pages: page, truncated };
}

interface TickerDetails {
  name?: string;
  market_cap?: number;
  primary_exchange?: string;
  homepage_url?: string;
  total_employees?: number;
  list_date?: string;
  sic_description?: string;
  description?: string;
  branding?: { logo_url?: string; icon_url?: string };
}

interface StockSnapshot {
  todaysChange?: number;
  todaysChangePerc?: number;
  day?: { o?: number; h?: number; l?: number; c?: number; v?: number };
  min?: { c?: number };
  prevDay?: { c?: number };
}

async function getJson<T>(path: string): Promise<T | null> {
  const key = apiKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MassiveError(describeStatus(res.status, "", body), res.status);
  }
  return (await res.json()) as T;
}

/** Detalles de referencia + snapshot de precio, combinados en CompanyInfo. */
export async function fetchCompany(ticker: string): Promise<CompanyInfo> {
  const clean = ticker.trim().toUpperCase();
  const [details, snap] = await Promise.all([
    getJson<{ results?: TickerDetails }>(
      `/v3/reference/tickers/${encodeURIComponent(clean)}`,
    ).catch(() => null),
    getJson<{ ticker?: StockSnapshot }>(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(clean)}`,
    ).catch(() => null),
  ]);

  const d = details?.results ?? {};
  const t = snap?.ticker ?? {};
  const exchangeCode = d.primary_exchange;

  return {
    ticker: clean,
    name: d.name ?? null,
    exchange: exchangeCode ? EXCHANGE_NAMES[exchangeCode] ?? exchangeCode : null,
    marketCap: d.market_cap ?? null,
    homepageUrl: d.homepage_url ?? null,
    employees: d.total_employees ?? null,
    listDate: d.list_date ?? null,
    sector: d.sic_description ?? null,
    description: d.description ?? null,
    hasLogo: Boolean(d.branding?.logo_url || d.branding?.icon_url),
    price: t.day?.c ?? t.min?.c ?? t.prevDay?.c ?? null,
    change: t.todaysChange ?? null,
    changePercent: t.todaysChangePerc ?? null,
    dayOpen: t.day?.o ?? null,
    dayHigh: t.day?.h ?? null,
    dayLow: t.day?.l ?? null,
    dayVolume: t.day?.v ?? null,
    prevClose: t.prevDay?.c ?? null,
  };
}

interface AggBar {
  t: number; // epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
}

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Barras diarias del subyacente en los últimos `days` días (para la gráfica). */
export async function fetchDailyBars(ticker: string, days = 365): Promise<DailyBar[]> {
  const clean = ticker.trim().toUpperCase();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(clean)}/range/1/day/` +
    `${toDateStr(from.getTime())}/${toDateStr(to.getTime())}` +
    `?adjusted=true&sort=asc&limit=500`;
  const json = await getJson<{ results?: AggBar[] }>(path).catch(() => null);
  const bars = json?.results ?? [];
  return bars.map((b) => ({
    time: toDateStr(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));
}

/** Barras del subyacente (diario o intradía) con tiempo UNIX en segundos. */
export async function fetchBars(
  ticker: string,
  multiplier: number,
  timespan: "day" | "minute",
  days: number,
): Promise<TfBar[]> {
  const clean = ticker.trim().toUpperCase();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(clean)}/range/${multiplier}/${timespan}/` +
    `${toDateStr(from.getTime())}/${toDateStr(to.getTime())}` +
    `?adjusted=true&sort=asc&limit=50000`;
  const json = await getJson<{ results?: AggBar[] }>(path).catch(() => null);
  const bars = json?.results ?? [];
  return bars.map((b) => ({
    time: Math.floor(b.t / 1000),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));
}

/** Descarga la imagen del logo (o icono) para servirla por proxy. */
export async function fetchLogoImage(
  ticker: string,
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const key = apiKey();
  const clean = ticker.trim().toUpperCase();
  const details = await getJson<{ results?: TickerDetails }>(
    `/v3/reference/tickers/${encodeURIComponent(clean)}`,
  ).catch(() => null);
  const url = details?.results?.branding?.logo_url ?? details?.results?.branding?.icon_url;
  if (!url) return null;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "image/png";
  return { data: await res.arrayBuffer(), contentType };
}

function describeStatus(status: number, ticker: string, body: string): string {
  switch (status) {
    case 401:
    case 403:
      return "Autenticación rechazada por Massive. Revisa la API key.";
    case 404:
      return `Massive no encontró datos para "${ticker}".`;
    case 429:
      return "Límite de tasa de Massive alcanzado. Reintenta en unos segundos.";
    default:
      return `Massive respondió ${status}. ${body.slice(0, 200)}`.trim();
  }
}
