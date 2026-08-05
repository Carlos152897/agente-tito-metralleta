"use client";

import { useCallback, useEffect, useState } from "react";
import BrandMark from "@/app/components/BrandMark";
import NavTabs from "@/app/components/NavTabs";

interface CookieStatus {
  present: boolean;
  working: boolean;
  message: string;
  updatedAt: string | null;
  source: string;
  fingerprint: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  ajustes: "pegada a mano en /ajustes",
  extractor: "extractor automático",
  env: "respaldo de .env.local",
  none: "ninguna",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function AjustesPage() {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/marketsnack-cookie", { cache: "no-store" });
      const json = (await res.json()) as CookieStatus;
      setStatus(json);
    } catch {
      setStatus({
        present: false,
        working: false,
        message: "No se pudo consultar el estado.",
        updatedAt: null,
        source: "none",
        fingerprint: null,
      });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!draft.trim()) {
      setFeedback({ ok: false, message: "Pega la cookie primero." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/marketsnack-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: draft, source: "ajustes" }),
      });
      const json = (await res.json()) as { ok: boolean; message: string };
      setFeedback(json);
      if (json.ok) {
        setDraft("");
        await refresh();
      }
    } catch (err) {
      setFeedback({ ok: false, message: `No se pudo guardar: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="ideas-page">
      <div className="hb">
        <BrandMark subtitle="⚙️ Ajustes" />
        <NavTabs />
      </div>

      <div className="ideas-body">
        <div className="page-stack">
          <div className="header">
            <h1>Cookie de MarketSnack</h1>
            <p>
              El sub-agente Time &amp; Sales se autentica contra app.marketsnack.com con esta
              cookie de sesión. Caduca cada uno o dos días — actualízala aquí, surte efecto al
              instante, sin reiniciar el servidor.
            </p>
          </div>

          <section className="card">
            <div className="card-title">Estado actual</div>
            {loadingStatus ? (
              <p className="muted">Comprobando…</p>
            ) : status?.present ? (
              <div className="stack-tight">
                <div className={`ms-status-row ${status.working ? "ok" : "bad"}`}>
                  <span className="ms-dot" aria-hidden="true" />
                  <strong>{status.working ? "Funciona" : "Expirada / inválida"}</strong>
                </div>
                <p className="muted" style={{ margin: 0 }}>{status.message}</p>
                <div className="ms-meta">
                  <span>
                    Actualizada: <strong>{fmtDate(status.updatedAt)}</strong>
                  </span>
                  <span>
                    Origen: <strong>{SOURCE_LABEL[status.source] ?? status.source}</strong>
                  </span>
                  {status.fingerprint && (
                    <span>
                      Huella: <code>{status.fingerprint}</code>
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No hay ninguna cookie guardada todavía. Pégala abajo para empezar.
              </p>
            )}
          </section>

          <section className="card">
            <div className="card-title">Actualizar</div>
            <p className="card-sub" style={{ margin: 0 }}>
              DevTools → pestaña Network → busca una petición a <code>/api/flow_feed</code> en
              app.marketsnack.com → copia el header <code>Cookie</code> completo → pégalo abajo.
              Se prueba contra MarketSnack antes de guardarse; si no sirve, se rechaza y la
              cookie que ya funcionaba no se toca.
            </p>
            <textarea
              className="ms-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="_ga=...; _market_snack_session=...; ..."
              rows={6}
              spellCheck={false}
              aria-label="Cookie de sesión de MarketSnack"
            />
            <div className="ms-actions">
              <button className="ms-save-btn" onClick={save} disabled={saving}>
                {saving ? "Probando…" : "Guardar"}
              </button>
              {feedback && (
                <span className={`ms-feedback ${feedback.ok ? "ok" : "bad"}`}>
                  {feedback.message}
                </span>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
