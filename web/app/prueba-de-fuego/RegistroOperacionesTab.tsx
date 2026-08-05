"use client";

// Panel de Registro de Operaciones — SOLO LECTURA desde el navegador, igual
// que era Paper Trading. Las entradas y salidas las decide y ejecuta el
// agente (schedule de Prueba de Fuego), no esta UI: acá solo se refleja el
// historial de señales de SPX y TSLA (lib/registroOperaciones.ts, una entrada
// por ticker por día de mercado) y se pollea el precio en vivo de cada
// entrada abierta.

import { useCallback, useEffect, useRef, useState } from "react";
import { pnlOf, type RegistroClosedEntry, type RegistroOpenEntry, type RegistroStore } from "@/lib/registroOperaciones";

const POLL_MS = 20_000;
const STORE_POLL_MS = 15_000;

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const EXIT_LABELS: Record<string, string> = {
  target: "🎯 target alcanzado",
  reversal: "🔄 reversión (contratos vecinos o gamma flip)",
  eod: "🌙 cierre de sesión (day-trading, no se carga de un día para otro)",
};

const ROLE_LABELS: Record<string, string> = {
  continuation: "✅ confirmada",
  gex_only: "⚠️ solo GEX (débil)",
};

function OpenEntryCard({ entry }: { entry: RegistroOpenEntry }) {
  const [livePrice, setLivePrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`/api/option-quote?underlying=${entry.ticker}&symbol=${encodeURIComponent(entry.symbol)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { quote?: { mid: number | null; lastTrade: number | null } } | null) => {
          if (cancelled) return;
          setLivePrice(body?.quote?.mid ?? body?.quote?.lastTrade ?? null);
        })
        .catch(() => null);
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [entry.ticker, entry.symbol]);

  const unrealized = livePrice != null ? pnlOf(entry.entryPrice, livePrice) : null;

  return (
    <div className="card" style={{ gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>
        {entry.ticker} — {entry.type === "call" ? "call" : "put"} ${entry.strike} ({entry.expiration}){" "}
        <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>{ROLE_LABELS[entry.signalRole]}</span>
      </div>
      <p className="wheel-disclaimer" style={{ fontSize: 12 }}>{entry.reason}</p>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Precio de entrada</div>
          <div className="stat-value">${entry.entryPrice.toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Precio actual</div>
          <div className="stat-value">{livePrice != null ? `$${livePrice.toFixed(2)}` : "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">P/L no realizado</div>
          <div className="stat-value" style={{ color: (unrealized?.usd ?? 0) >= 0 ? "#12b76a" : "#f04438" }}>
            {unrealized ? `${money(unrealized.usd)} (${pct(unrealized.pct)})` : "—"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Target sugerido</div>
          <div className="stat-value">${entry.target} ({entry.side === "above" ? "arriba" : "abajo"})</div>
        </div>
      </div>
    </div>
  );
}

function ClosedEntryRow({ entry }: { entry: RegistroClosedEntry }) {
  return (
    <div className="card" style={{ gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>
        {entry.ticker} — {entry.type === "call" ? "call" : "put"} ${entry.strike} ({entry.expiration}){" "}
        <span style={{ fontSize: 12, fontWeight: 400 }}>{entry.outcome === "win" ? "✅" : "❌"}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        Entró a ${entry.entryPrice.toFixed(2)} · Salió a ${entry.exitPrice.toFixed(2)} · {EXIT_LABELS[entry.exitReason] ?? entry.exitReason} ·{" "}
        {ROLE_LABELS[entry.signalRole]}
      </div>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Ganancia / pérdida %</div>
          <div className="stat-value" style={{ color: entry.pnlPct >= 0 ? "#12b76a" : "#f04438" }}>{pct(entry.pnlPct)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ganancia / pérdida $</div>
          <div className="stat-value" style={{ color: entry.pnlUsd >= 0 ? "#12b76a" : "#f04438" }}>{money(entry.pnlUsd)}</div>
        </div>
      </div>
    </div>
  );
}

export default function RegistroOperacionesTab() {
  const [store, setStore] = useState<RegistroStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const loadStore = useCallback(() => {
    fetch("/api/registro-operaciones")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { store?: RegistroStore } | null) => {
        if (!body?.store) return;
        setStore(body.store);
        setError(null);
        loadedOnce.current = true;
      })
      .catch(() => setError("No se pudo leer el registro de operaciones."));
  }, []);

  useEffect(() => {
    loadStore();
    const id = setInterval(loadStore, STORE_POLL_MS);
    return () => clearInterval(id);
  }, [loadStore]);

  if (!store) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card wheel-empty">{error ?? "Cargando el registro…"}</div>
      </div>
    );
  }

  const wins = store.closed.filter((e) => e.outcome === "win").length;
  const losses = store.closed.length - wins;
  const winRate = store.closed.length > 0 ? (wins / store.closed.length) * 100 : null;
  const avgPnl = store.closed.length > 0 ? store.closed.reduce((sum, e) => sum + e.pnlUsd, 0) / store.closed.length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>🗒 Registro de Operaciones — SPX y TSLA</div>
        <p className="wheel-disclaimer" style={{ fontSize: 13, lineHeight: 1.6 }}>
          TSLA: el agente registra solo la señal de HOY (una por día de mercado). SPX: bitácora
          completa — una entrada nueva cada 5 minutos, sin importar cuántas ya estén abiertas.
          Cada una sale cuando el precio toca el target sugerido O cuando la señal se revierte (net
          premium de contratos vecinos, y para SPX también un cruce del gamma flip) — lo que llegue
          primero. Esta pantalla es solo lectura: las entradas y salidas las decide y ejecuta el
          agente, no un botón acá.
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Sesiones registradas</div>
          <div className="stat-value">{store.closed.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ganadas / perdidas</div>
          <div className="stat-value">{wins} / {losses}</div>
        </div>
        <div className="stat">
          <div className="stat-label">% de acierto</div>
          <div className="stat-value">{winRate != null ? `${winRate.toFixed(0)}%` : "—"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ganancia / pérdida promedio</div>
          <div className="stat-value" style={{ color: avgPnl >= 0 ? "#12b76a" : "#f04438" }}>{money(avgPnl)}</div>
        </div>
      </div>

      {store.open.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {store.open.map((e) => (
            <OpenEntryCard key={e.id} entry={e} />
          ))}
        </div>
      ) : (
        <div className="card wheel-empty">Sin entradas abiertas ahora mismo.</div>
      )}

      {store.closed.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Historial ({store.closed.length})</div>
          {store.closed.map((e, i) => (
            <ClosedEntryRow key={`${e.symbol}-${e.enteredAt}-${i}`} entry={e} />
          ))}
        </div>
      )}

      <div className="disclaimer">Registro de señales, dinero real nunca se toca. No es consejo financiero.</div>
    </div>
  );
}
