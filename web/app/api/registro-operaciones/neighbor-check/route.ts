// GET /api/registro-operaciones/neighbor-check?ticker=X&type=call|put&strike=N&expiration=YYYY-MM-DD
// Señal mecánica de "¿el net premium real de los contratos vecinos sigue
// confirmando la dirección de la entrada?" (lib/neighborContracts.ts
// `neighborContractsConfirmPosition`) — port literal de
// app/api/paper-trading/neighbor-check/route.ts, misma lógica, ticker-agnóstica.

import { toRow } from "@/lib/compute";
import { candidateStrikesForSide } from "@/lib/backtest";
import { fetchContractPremiumSummaries, MarketSnackError } from "@/lib/marketsnack";
import { fetchOptionChain, MassiveError } from "@/lib/massive";
import {
  neighborContractsConfirmPosition,
  NEIGHBOR_WALK_COUNT,
  profitSideOf,
  resolveStrikeContracts,
  toStrikePremiums,
} from "@/lib/neighborContracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  const type = searchParams.get("type");
  const strike = Number(searchParams.get("strike"));
  const expiration = searchParams.get("expiration") ?? "";

  if (!ticker || (type !== "call" && type !== "put") || !(strike > 0) || !expiration) {
    return Response.json({ error: "ticker, type, strike y expiration son requeridos." }, { status: 400 });
  }

  try {
    const { contracts } = await fetchOptionChain(ticker);
    const sameExpiryRows = contracts.map(toRow).filter((r) => r.expiration === expiration);
    const chainStrikes = sameExpiryRows.map((r) => r.strike);

    const now = new Date();
    const neighborStrikes = candidateStrikesForSide(chainStrikes, strike, profitSideOf(type), NEIGHBOR_WALK_COUNT);
    const strikeContracts = resolveStrikeContracts(neighborStrikes, sameExpiryRows, now, ticker);
    const occSymbols = [...strikeContracts.values()].flatMap((c) => [c.call, c.put]).filter((s): s is string => s != null);
    const premiumsBySymbol = await fetchContractPremiumSummaries(occSymbols);
    const strikePremiums = toStrikePremiums(strikeContracts, premiumsBySymbol);

    const confirms = neighborContractsConfirmPosition({ position: { type, strike }, chainStrikes, strikePremiums });
    return Response.json({ confirms });
  } catch (err) {
    const message =
      err instanceof MassiveError || err instanceof MarketSnackError
        ? err.message
        : "Error inesperado revisando el net premium de los vecinos.";
    return Response.json({ error: message }, { status: 502 });
  }
}
