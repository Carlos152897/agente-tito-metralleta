"use client";

// Pestañas de POP mínimo (§2 del prompt): ≥60/70/80/90%, por defecto ≥70%.
// Filtran en el CLIENTE — el escaneo no cambia, solo qué filas se muestran.

export const POP_TABS = [60, 70, 80, 90] as const;
export type PopTab = (typeof POP_TABS)[number];
export const DEFAULT_POP_TAB: PopTab = 70;

export default function PopFilterTabs({
  value,
  onChange,
}: {
  value: PopTab;
  onChange: (v: PopTab) => void;
}) {
  return (
    <div className="wheel-preset-tabs" role="tablist" aria-label="POP mínimo">
      {POP_TABS.map((p) => (
        <button
          key={p}
          type="button"
          className={`wheel-preset-tab ${value === p ? "on" : ""}`}
          onClick={() => onChange(p)}
          role="tab"
          aria-selected={value === p}
        >
          POP ≥{p}%
        </button>
      ))}
    </div>
  );
}
