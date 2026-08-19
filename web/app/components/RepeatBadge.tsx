"use client";

import type { FlowRow } from "@/lib/flow";
import { useLocale } from "@/lib/i18n";

/**
 * Burbuja para trades repetitivos — mismo contrato golpeado varias veces
 * (regla del agente: mismo strike ≥3× en una ventana de 5 min → flags.repeated).
 * El ×N cuenta cuántas veces aparece ese contrato en la tabla.
 */

export function repeatKey(r: Pick<FlowRow, "underlying" | "strike" | "type" | "expiration">): string {
  return `${r.underlying}|${r.strike}|${r.type}|${r.expiration ?? ""}`;
}

/** Cuántas veces aparece cada contrato en el conjunto de filas. */
export function buildRepeatCounts(rows: FlowRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(repeatKey(r), (m.get(repeatKey(r)) ?? 0) + 1);
  return m;
}

export default function RepeatBadge({ count }: { count: number }) {
  const { t } = useLocale();
  return (
    <span className="repeat-badge" title={t("repeatBadge.title", { n: count })}>
      🔁 ×{Math.max(count, 2)}
    </span>
  );
}
