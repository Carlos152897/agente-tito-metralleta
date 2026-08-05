export interface UnusualSwingCandidate {
  symbol: string;
  ticker: string;
  type: "call" | "put";
  strike: number;
  expiration: string;
  dte: number | null;
  assetPrice: number;
  volume: number;
  openInterest: number;
  premium: number;
  delta: number;
  timestamp: string;
}

export type UnusualSwingSseEvent =
  | { type: "step"; label: string }
  | { type: "done"; candidates: UnusualSwingCandidate[]; meta: { scanned: number; pages: number; truncated: boolean } }
  | { type: "error"; message: string };
