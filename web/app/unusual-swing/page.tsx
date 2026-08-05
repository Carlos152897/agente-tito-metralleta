"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";
import { buildEntry, remove, togglePinned, upsert, type UnusualSwingEntry } from "@/lib/unusualSwingWatchlist";
import { loadEntries, saveEntries } from "@/lib/unusualSwingWatchlistLocal";
import { buildLike, mergeLikes, upsertLike, type LikedContract } from "@/lib/contractSearchLikes";
import { loadLikes, saveLikes } from "@/lib/unusualSwingLikesLocal";
import type { UnusualSwingCandidate, UnusualSwingSseEvent } from "./types";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("es", { month: "short", day: "numeric" });

export default function UnusualSwingPage() {
  const [favorites, setFavorites] = useState<UnusualSwingEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // OI EN VIVO por símbolo, para comparar contra el OI del momento en que se
  // detectó — así Carlos puede ver al día siguiente si el volumen de verdad se
  // sumó al Open Interest (posiciones nuevas reales) o si quedó en nada.
  const [currentOi, setCurrentOi] = useState<Record<string, number | null>>({});
  const [robinhoodLikes, setRobinhoodLikes] = useState<LikedContract[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const favRef = useRef<UnusualSwingEntry[]>([]);
  const likesRef = useRef<LikedContract[]>([]);
  // Símbolos que el usuario sacó en ESTA sesión — evita que un escaneo ya en
  // vuelo los vuelva a agregar justo después de un "No me gusta" (si el usuario
  // recarga la página, un escaneo nuevo puede volver a traerlos, y eso está bien).
  const dismissedRef = useRef<Set<string>>(new Set());

  const applyFavorites = useCallback((next: UnusualSwingEntry[]) => {
    favRef.current = next;
    setFavorites(next);
    saveEntries(next);
    // Copia en el servidor, best-effort: es lo que le permite a la tarea
    // programada diaria leer qué contratos están guardados y avisar por su cuenta.
    fetch("/api/unusual-swing/favorites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: next }),
    }).catch(() => null);
  }, []);

  const scan = useCallback(() => {
    esRef.current?.close();
    setBusy(true);
    setError(null);
    setSteps([]);

    const es = new EventSource("/api/unusual-swing");
    esRef.current = es;
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data) as UnusualSwingSseEvent;
      if (d.type === "step") {
        setSteps((s) => [...s.slice(-6), d.label]);
      } else if (d.type === "done") {
        const now = new Date();
        let next = favRef.current;
        for (const c of d.candidates) {
          if (dismissedRef.current.has(c.symbol)) continue;
          next = upsert(next, buildEntry(c, now));
        }
        applyFavorites(next);
        setBusy(false);
        es.close();
      } else if (d.type === "error") {
        setError(d.message);
        setBusy(false);
        es.close();
      }
    };
    es.onerror = () => {
      setError("Se cortó la conexión con el escáner.");
      setBusy(false);
      es.close();
    };
  }, [applyFavorites]);

  // Al montar: los favoritos guardados aparecen de inmediato (sin esperar el
  // escaneo), y luego se dispara el escaneo para sumar lo nuevo de hoy.
  useEffect(() => {
    applyFavorites(loadEntries());
    scan();
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresca el OI en vivo de cada favorito guardado (vía /api/option-quote,
  // que ya expone open_interest de Massive) cada vez que cambia la lista.
  useEffect(() => {
    if (favorites.length === 0) return;
    let cancelled = false;
    Promise.all(
      favorites.map(async (f) => {
        try {
          const res = await fetch(
            `/api/option-quote?underlying=${encodeURIComponent(f.ticker)}&symbol=${encodeURIComponent(f.symbol)}`,
          );
          const body: { quote?: { openInterest: number | null } } | null = res.ok ? await res.json() : null;
          return [f.symbol, body?.quote?.openInterest ?? null] as const;
        } catch {
          return [f.symbol, null] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setCurrentOi(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  const dislike = useCallback(
    (symbol: string) => {
      dismissedRef.current.add(symbol);
      applyFavorites(remove(favRef.current, symbol));
    },
    [applyFavorites],
  );

  const pin = useCallback(
    (symbol: string) => {
      applyFavorites(togglePinned(favRef.current, symbol));
    },
    [applyFavorites],
  );

  // "Agregar a Robinhood" — mismo patrón que ContractSearchTab: el agente (único
  // con la conexión MCP a Robinhood) drena esta cola por su cuenta; acá solo se
  // encola y se refleja el estado que el agente va marcando en el servidor.
  const applyLikes = useCallback((next: LikedContract[]) => {
    likesRef.current = next;
    setRobinhoodLikes(next);
    saveLikes(next);
    fetch("/api/unusual-swing/likes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: next }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { entries?: LikedContract[] } | null) => {
        if (!body?.entries) return;
        likesRef.current = body.entries;
        setRobinhoodLikes(body.entries);
        saveLikes(body.entries);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    applyLikes(loadLikes());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/unusual-swing/likes")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { entries?: LikedContract[] } | null) => {
          if (!body?.entries) return;
          const merged = mergeLikes(likesRef.current, body.entries);
          if (JSON.stringify(merged) !== JSON.stringify(likesRef.current)) {
            likesRef.current = merged;
            setRobinhoodLikes(merged);
            saveLikes(merged);
          }
        })
        .catch(() => null);
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  const likeToRobinhood = useCallback(
    (f: UnusualSwingEntry) => {
      const entry = buildLike(f, new Date());
      if (!entry) return;
      applyLikes(upsertLike(likesRef.current, entry));
    },
    [applyLikes],
  );

  return (
    <main className="ideas-page">
      <div className="hb">
        <BrandMark subtitle="🦄 Unusual Swing Trades" />
        <NavTabs />
      </div>

      <div className="ideas-body">
        <div className="card" style={{ gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>¿Qué es esto?</div>
          <p className="wheel-disclaimer" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Escanea TODO el mercado buscando contratos con actividad institucional inusual, para
            operar en los próximos días (no day-trading): fuera del dinero (OTM), vencimiento de
            de 60 a 90 días, premium de al menos $5M, volumen muy grande y muy por encima del Open
            Interest (dinero nuevo entrando de golpe), comprados agresivamente al ask, y una sola
            pata (nunca multileg).
            Los que encuentra se guardan solos, con la foto del momento (volumen y Open Interest de
            cuando se detectó) — esa foto NUNCA se pisa. Cada vez que abrís la página se refresca el{" "}
            <b>OI actual</b> de cada uno para que compares contra el OI de detección y decidas si el
            volumen de verdad se convirtió en posiciones nuevas. Revisalos todos los días y sacá con{" "}
            <b>👎 No me gusta</b> los que ya no te interesen. <b>👍 Agregar a Robinhood</b> lo suma a
            tu watchlist de opciones real; <b>📌 Mantener</b> lo blinda de una futura limpieza
            automática. Quedan guardados en este navegador aunque recargues la página.
          </p>
        </div>

        <button className="rescan" onClick={scan} disabled={busy}>
          {busy ? "Escaneando…" : "↻ Buscar más"}
        </button>

        {busy && (
          <div className="card wheel-empty">
            {steps.length > 0 ? steps[steps.length - 1] : "Escaneando el mercado…"}
          </div>
        )}
        {error && <div className="error">⚠ {error}</div>}

        {favorites.length === 0 && !busy && (
          <div className="card wheel-empty">Sin contratos guardados todavía.</div>
        )}

        {favorites.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {favorites.map((f) => {
              const ratio = f.openInterest > 0 ? f.volume / f.openInterest : null;
              const live = currentOi[f.symbol];
              const oiChange = live != null ? live - f.openInterest : null;
              const liked = robinhoodLikes.find((l) => l.symbol === f.symbol);
              return (
                <div key={f.symbol} className="card" style={{ gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {f.ticker} — {f.type === "call" ? "call" : "put"} ${f.strike} ({f.expiration}
                      {f.dte != null && <> · {f.dte}d</>})
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        className="rescan"
                        style={{ margin: 0 }}
                        disabled={!!liked}
                        onClick={() => likeToRobinhood(f)}
                      >
                        {liked?.syncedAt ? "✅ En tu Robinhood" : liked ? "⏳ Agregando…" : "👍 Agregar a Robinhood"}
                      </button>
                      <button className="rescan" onClick={() => pin(f.symbol)} style={{ margin: 0 }}>
                        {f.pinned ? "📌 Manteniendo" : "📌 Mantener"}
                      </button>
                      <button className="rescan" onClick={() => dislike(f.symbol)} style={{ margin: 0 }}>
                        👎 No me gusta
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    Subyacente al detectarlo: ${f.assetPriceAtDetection.toFixed(2)} · Premium: {money(f.premium)} ·
                    Agregado: {dateOf(f.addedAt)}
                  </div>
                  <div className="stats">
                    <div className="stat">
                      <div className="stat-label">Volumen detectado</div>
                      <div className="stat-value">{f.volume.toLocaleString("en-US")}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">OI al detectarlo</div>
                      <div className="stat-value">{f.openInterest.toLocaleString("en-US")}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">OI actual</div>
                      <div className="stat-value">{live != null ? live.toLocaleString("en-US") : "—"}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">¿Se sumó al OI?</div>
                      <div
                        className="stat-value"
                        style={{ color: oiChange == null ? undefined : oiChange > 0 ? "#12b76a" : "#f04438" }}
                      >
                        {oiChange != null ? `${oiChange >= 0 ? "+" : ""}${oiChange.toLocaleString("en-US")}` : "—"}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Volumen / OI (detección)</div>
                      <div className="stat-value">{ratio != null ? `${ratio.toFixed(1)}×` : "—"}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-label">Delta</div>
                      <div className="stat-value">{f.delta.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="disclaimer">
          Dinero 100% simulado. Actividad inusual no es garantía de movimiento — esto es material
          educativo, no consejo financiero.
        </div>
      </div>
    </main>
  );
}
