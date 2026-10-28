"use client";

// Buscador de acciones con opciones para VisionFutura (traído del zip "visionfutura-main", oct-2026):
// sugiere mientras escribes (tastytrade); Enter o click abre la acción. Con el cuadro vacío muestra
// las recientes. La acción se ve igual que TSLA: solo la acción, umbrales escalados por su IV.

import { useEffect, useRef, useState } from "react";
import { isEquityTicker } from "@/lib/visionFuturaInstruments";

type Match = { symbol: string; description: string; etf: boolean };

export default function VisionFuturaTickerSearch({ onPick, recientes = [] }: { onPick: (ticker: string) => void; recientes?: string[] }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (!text) { setItems([]); return; }
    let stop = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/vision-futura/buscar?q=${encodeURIComponent(text)}`, { cache: "no-store" });
        const j = (await r.json()) as { items: Match[]; error?: string };
        if (stop) return;
        setItems(j.items ?? []);
        setError(j.error ?? null);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => { stop = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const showRecent = !q.trim() && recientes.length > 0;
  const list: Match[] = showRecent ? recientes.map((s) => ({ symbol: s, description: "reciente", etf: false })) : items;

  const pick = (sym: string) => {
    const t = sym.trim().toUpperCase();
    if (!isEquityTicker(t)) return;
    onPick(t);
    setQ("");
    setItems([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        value={q}
        placeholder="🔎 Buscar acción (AAPL, NVDA…)"
        aria-label="Buscar acción"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { setActive(0); if (list.length) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(list[active]?.symbol ?? q); }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: 210, padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13 }}
      />
      {open && (list.length > 0 || error) && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 40, width: 300, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", overflow: "hidden" }}>
          {error && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--red-soft)" }}>{error}</div>}
          {list.map((m, i) => (
            <button
              key={m.symbol}
              onMouseDown={(e) => { e.preventDefault(); pick(m.symbol); }}
              onMouseEnter={() => setActive(i)}
              style={{ display: "flex", width: "100%", gap: 10, alignItems: "baseline", padding: "7px 10px", border: "none", cursor: "pointer", textAlign: "left", background: i === active ? "var(--accent-dim)" : "transparent", color: "var(--text)" }}
            >
              <b style={{ minWidth: 56 }}>{m.symbol}</b>
              <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}{m.etf ? " · ETF" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
