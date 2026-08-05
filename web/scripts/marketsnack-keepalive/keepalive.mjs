#!/usr/bin/env node
// "Toca" la sesión de MarketSnack cada ~25 min para que no caduque por INACTIVIDAD.
// Standalone a propósito (no importa lib/marketsnack.ts): así corre con `node` puro
// desde el Programador de tareas de Windows, sin pasar por Next ni por un compilador
// de TypeScript. Duplica la lectura de la cookie y el endpoint más liviano
// (GET /api/assets/SPY) — si tocas la forma de leer la cookie en lib/marketsnackCookie.ts,
// revisa también aquí.
//
// HONESTIDAD: esto solo ayuda si MarketSnack expira la sesión por INACTIVIDAD. Si usan
// caducidad ABSOLUTA (p. ej. "24h desde el login pase lo que pase"), tocar la sesión no
// sirve de nada y la cookie va a caducar igual. Eso solo se sabe observando el log unos
// días: si la cookie sigue viva mucho más de lo que duraba antes, funcionó.
//
// Uso: node keepalive.mjs   (o instalado como tarea programada, ver Instalar-KeepAlive.ps1)

import { readFile, appendFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "..");
const COOKIE_FILE = path.join(WEB_DIR, "data", "marketsnack-cookie.json");
const ENV_FILE = path.join(WEB_DIR, ".env.local");
const LOG_FILE = path.join(WEB_DIR, "data", "marketsnack-keepalive.log");
const MAX_LOG_LINES = 2000;

async function loadCookie() {
  try {
    const raw = await readFile(COOKIE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cookie === "string" && parsed.cookie.trim()) return parsed.cookie.trim();
  } catch {
    // sin archivo (o corrupto) — cae al respaldo de .env.local
  }
  try {
    const raw = await readFile(ENV_FILE, "utf8");
    const m = raw.match(/^MARKETSNACK_COOKIE=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch {
    // sin .env.local tampoco
  }
  return null;
}

async function log(line) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  await appendFile(LOG_FILE, stamped, "utf8").catch(() => {});
  // Recorta el log de vez en cuando para que no crezca sin límite (cada ~25 min, para
  // siempre, son muchas líneas al cabo de meses).
  try {
    const s = await stat(LOG_FILE);
    if (s.size > 400_000) {
      const raw = await readFile(LOG_FILE, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      if (lines.length > MAX_LOG_LINES) {
        const trimmed = lines.slice(-MAX_LOG_LINES).join("\n") + "\n";
        const { writeFile } = await import("node:fs/promises");
        await writeFile(LOG_FILE, trimmed, "utf8");
      }
    }
  } catch {
    // no crítico
  }
}

async function main() {
  const cookie = await loadCookie();
  if (!cookie) {
    await log("SIN COOKIE — no hay nada que tocar (falta data/marketsnack-cookie.json y MARKETSNACK_COOKIE en .env.local).");
    return;
  }

  try {
    const res = await fetch("https://app.marketsnack.com/api/assets/SPY", {
      headers: { Accept: "application/json", Cookie: cookie },
      redirect: "manual",
    });

    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      await log(`SESION EXPIRADA (status ${res.status}) — hace falta refrescar la cookie en /ajustes.`);
      return;
    }
    if (!res.ok) {
      await log(`RESPUESTA INESPERADA (status ${res.status}).`);
      return;
    }
    const json = await res.json().catch(() => ({}));
    const price = json.latest_price ?? json.regular_price ?? null;
    await log(`OK — sesion viva (SPY=${price ?? "?"}).`);
  } catch (err) {
    await log(`ERROR DE RED — ${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
