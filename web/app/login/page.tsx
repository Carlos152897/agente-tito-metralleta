"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Contraseña incorrecta.");
        return;
      }
      router.replace(params.get("next") || "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <img className="login-logo" src="/logo.png" alt="Visionary Trades" />
      <h1>Visionary Trades</h1>
      <p className="login-sub">Acceso privado — pide la contraseña a Carlos.</p>
      <input
        type="password"
        autoFocus
        placeholder="Contraseña"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="login-error">{error}</p>}
      <button type="submit" disabled={loading || !password}>
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="login-wrap">
      <style>{CSS}</style>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

const CSS = `
.login-wrap {
  min-height: 100dvh; display: flex; align-items: center; justify-content: center;
  background: var(--bg); padding: 24px;
}
.login-card {
  width: 100%; max-width: 340px; background: var(--panel); border: 1px solid var(--border);
  border-radius: 14px; padding: 32px 28px; display: flex; flex-direction: column; align-items: center;
  gap: 6px; text-align: center; box-shadow: 0 1px 2px rgba(16,24,40,0.04);
}
.login-logo { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; margin-bottom: 10px; }
.login-card h1 { margin: 0; font-size: 19px; letter-spacing: -0.2px; color: var(--text); }
.login-sub { margin: 2px 0 18px; font-size: 13px; color: var(--muted); }
.login-card input {
  width: 100%; font: inherit; font-size: 15px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); background: var(--bg); color: var(--text); text-align: center;
}
.login-card input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.login-error { color: var(--red); font-size: 12.5px; margin: 8px 0 0; }
.login-card button {
  width: 100%; margin-top: 14px; font: inherit; font-weight: 600; font-size: 14.5px;
  padding: 10px 12px; border-radius: 8px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff; cursor: pointer;
}
.login-card button:disabled { opacity: 0.6; cursor: default; }
`;
