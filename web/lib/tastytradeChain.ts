// Cadena de opciones del Agente 0DTE vía tastytrade — reemplaza a
// zerodteSchwab.ts::fetchZeroDteChain, mismo contrato de salida exacto para
// que el swap en zerodte.ts sea de una sola línea. `delayed` siempre false:
// producción de tastytrade es tiempo real de fábrica, a diferencia del
// isDelayed=true que devolvía Schwab acá.

import {
  fetchNestedOptionChain,
  fetchOptionQuotesByType,
  fetchUnderlyingQuote,
  type NestedChainExpiration,
  type TastyQuote,
} from "./tastytrade";
import { INDEX_UNDERLYINGS } from "./zerodteTickers";
import type { ContractType, ZContractGreeks, ZRow } from "./zerodteTypes";
import type { NearTermChainResult, NearTermContract } from "./massive";
import { marketDateStr } from "./occ";

function num(v: string | number | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function pos(v: string | number | undefined | null): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

/** A diferencia de Schwab (`volatility` en %, hay que ÷100), tastytrade ya la da en decimal (0.30 = 30%). */
function toGreeks(q: TastyQuote | undefined): ZContractGreeks | null {
  if (!q) return null;
  const delta = num(q.delta);
  const gamma = num(q.gamma);
  const theta = num(q.theta);
  const vega = num(q.vega);
  const iv = num(q.volatility);
  if (delta == null && gamma == null && theta == null && vega == null && iv == null) return null;
  return { delta, gamma, theta, vega, iv };
}

/**
 * Cadena de UN vencimiento (day), con cotizaciones reales en bloque. Mismo
 * shape que fetchZeroDteChain de Schwab — swap directo en zerodte.ts.
 */
export async function fetchZeroDteChain(
  symbol: string, day: string, preloadedExpirations?: NestedChainExpiration[],
): Promise<{ rows: ZRow[]; underlyingPrice: number | null; delayed: boolean }> {
  const clean = symbol.replace(/^\$/, "").toUpperCase();
  const expirations = preloadedExpirations ?? (await fetchNestedOptionChain(clean));
  const target = expirations.find((e) => e["expiration-date"] === day);
  if (!target) return { rows: [], underlyingPrice: null, delayed: false };

  const symbols = target.strikes.flatMap((s) => [s.call, s.put]).filter(Boolean);
  const [quotes, underlyingPrice] = await Promise.all([
    fetchOptionQuotesByType(symbols),
    fetchUnderlyingQuote(clean, INDEX_UNDERLYINGS.has(clean)),
  ]);

  const rows: ZRow[] = [];
  for (const s of target.strikes) {
    const strike = num(s["strike-price"]);
    if (strike == null) continue;
    const legs: [ContractType, string][] = [["call", s.call], ["put", s.put]];
    for (const [contractType, rawSymbol] of legs) {
      if (!rawSymbol) continue;
      const q = quotes.get(rawSymbol);
      rows.push({
        optionTicker: rawSymbol.replace(/\s+/g, ""),
        contractType,
        expiration: day,
        strike,
        openInterest: num(q?.["open-interest"]) ?? 0,
        volume: num(q?.volume) ?? 0,
        bid: pos(q?.bid),
        ask: pos(q?.ask),
        greeks: toGreeks(q),
      });
    }
  }

  return { rows, underlyingPrice, delayed: false };
}

/**
 * Cadena de vencimientos cercanos (calls y puts) desde la cadena anidada de
 * tastytrade — reemplaza a `fetchNearTermChain` de Massive en Grandes empresas
 * (1.0 y 2.0): el plan de Massive dejó de incluir opciones (403 "not entitled",
 * visto 2026-10-27). Mismo shape de salida (`NearTermChainResult`) para que el
 * cambio en las rutas sea de una línea. Solo trae la ESTRUCTURA (strike,
 * vencimiento, tipo, símbolo OCC sin espacios, igual al de MarketSnack); las
 * cotizaciones las piden las rutas aparte. `spot` = null: las rutas ya lo sacan
 * de MarketSnack o de las velas.
 */
export async function fetchNearTermChainTasty(
  ticker: string,
  opts: { dteMin?: number; dteMax: number; now?: Date },
  preloadedExpirations?: NestedChainExpiration[],
): Promise<NearTermChainResult> {
  const clean = ticker.trim().toUpperCase();
  const now = opts.now ?? new Date();
  const day = 24 * 60 * 60 * 1000;
  const todayMs = Date.parse(`${marketDateStr(now)}T00:00:00Z`);
  const from = new Date(todayMs + (opts.dteMin ?? 0) * day).toISOString().slice(0, 10);
  const to = new Date(todayMs + opts.dteMax * day).toISOString().slice(0, 10);
  const expirations = preloadedExpirations ?? (await fetchNestedOptionChain(clean));
  const contracts: NearTermContract[] = [];
  for (const e of expirations) {
    const exp = e["expiration-date"];
    if (exp < from || exp > to) continue;
    for (const s of e.strikes) {
      const strike = num(s["strike-price"]);
      if (strike == null) continue;
      if (s.call) contracts.push({ strike, expiration: exp, contractType: "call", optionTicker: s.call.replace(/\s+/g, "") });
      if (s.put) contracts.push({ strike, expiration: exp, contractType: "put", optionTicker: s.put.replace(/\s+/g, "") });
    }
  }
  return { spot: null, contracts };
}
