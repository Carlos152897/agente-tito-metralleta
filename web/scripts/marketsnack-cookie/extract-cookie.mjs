#!/usr/bin/env node
// Segunda mitad del extractor automatico. PowerShell (Extraer-Cookie-MarketSnack.ps1) ya
// hizo lo que solo el puede hacer -- descifrar la clave maestra del navegador con DPAPI -- y
// copio la base de cookies sin cerrar el navegador. Este script hace lo que Node sabe hacer
// y PowerShell 5.1 no: descifrar cada cookie con AES-256-GCM (node:sqlite + node:crypto,
// sin dependencias nuevas).
//
// Formato de valor de Chrome/Edge/Brave en Windows (desde ~2015):
//   [ "v10" | "v11" | "v20" ][ nonce 12 bytes ][ ciphertext ][ tag 16 bytes ]
// v10/v11 -> AES-256-GCM con la clave maestra protegida por DPAPI (lo que sabemos descifrar).
// v20     -> App-Bound Encryption. Por diseño de Chrome/Windows esto NO se puede descifrar
//            fuera del propio navegador -- no hay rodeo, y este script no intenta ninguno.
//
// Uso: node extract-cookie.mjs <manifest.json> <apiUrl> <logFile>

import { DatabaseSync } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";

const [, , manifestPath, apiUrl, logPath] = process.argv;

function log(msg) {
  console.log(msg);
  if (logPath) {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} [node] ${msg}\n`, "utf8");
    } catch {
      // no critico -- ya se imprimio por consola
    }
  }
}

/** @returns {{ ok: true, value: string } | { ok: false, appBound?: boolean, error?: string }} */
function decryptValue(masterKey, blob) {
  if (blob.length === 0) return { ok: true, value: "" };
  const prefix = blob.subarray(0, 3).toString("latin1");
  if (prefix === "v20") return { ok: false, appBound: true };
  if (prefix !== "v10" && prefix !== "v11") {
    return { ok: false, error: `formato desconocido (prefijo "${prefix}")` };
  }
  const nonce = blob.subarray(3, 15);
  const ciphertext = blob.subarray(15, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { ok: true, value: plain.toString("utf8") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function tryEntry(entry) {
  const masterKey = Buffer.from(entry.masterKeyBase64, "base64");
  log(`Probando ${entry.browser} / ${entry.profile}…`);

  let db;
  try {
    db = new DatabaseSync(entry.cookiesDb, { readOnly: true });
  } catch (err) {
    log(`  No se pudo abrir la base de ${entry.browser}/${entry.profile}: ${err.message}`);
    return null;
  }

  let rows;
  try {
    rows = db
      .prepare("SELECT name, value, encrypted_value FROM cookies WHERE host_key LIKE '%marketsnack.com'")
      .all();
  } catch (err) {
    log(`  No se pudo leer la tabla cookies de ${entry.browser}/${entry.profile}: ${err.message}`);
    return null;
  } finally {
    db.close();
  }

  if (rows.length === 0) {
    log(`  Sin cookies de marketsnack.com en ${entry.browser}/${entry.profile}.`);
    return null;
  }

  const parts = [];
  let sawAppBound = false;
  let hasSession = false;
  for (const row of rows) {
    const encrypted = Buffer.from(row.encrypted_value ?? []);
    let value;
    if (encrypted.length === 0) {
      value = typeof row.value === "string" ? row.value : "";
    } else {
      const res = decryptValue(masterKey, encrypted);
      if (!res.ok) {
        if (res.appBound) {
          sawAppBound = true;
        } else {
          log(`  No se pudo descifrar la cookie "${row.name}": ${res.error}`);
        }
        continue;
      }
      value = res.value;
    }
    if (row.name === "_market_snack_session") hasSession = true;
    parts.push(`${row.name}=${value}`);
  }

  if (!hasSession) {
    if (sawAppBound) return { appBoundOnly: true };
    log(
      `  Se descifraron ${parts.length} cookies de marketsnack.com pero ninguna es _market_snack_session (¿sesión cerrada en ${entry.browser}/${entry.profile}?).`,
    );
    return null;
  }
  return { cookie: parts.join("; "), browser: entry.browser, profile: entry.profile, count: parts.length };
}

async function saveViaApi(cookie) {
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie, source: "extractor" }),
    });
    const json = await res.json();
    return { reachable: true, ...json };
  } catch (err) {
    return { reachable: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const manifestRaw = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entries = Array.isArray(manifestRaw) ? manifestRaw : [manifestRaw];

  let appBoundSeen = false;
  for (const entry of entries) {
    const result = tryEntry(entry);
    if (!result) continue;
    if (result.appBoundOnly) {
      appBoundSeen = true;
      continue;
    }

    log(`Encontrada sesión de MarketSnack en ${result.browser} / ${result.profile} (${result.count} cookies).`);
    log("Probándola contra MarketSnack y guardándola si sirve…");

    const saved = await saveViaApi(result.cookie);
    if (!saved.reachable) {
      log(
        `No se pudo contactar a Visionary Trades en ${apiUrl} — ¿está corriendo \`npm run dev\`? (${saved.message})`,
      );
      log("La cookie SÍ se extrajo del navegador pero no se pudo guardar automáticamente. Corre `npm run dev` y vuelve a intentar.");
      process.exitCode = 4;
      return;
    }
    if (saved.ok) {
      log(`ÉXITO — cookie guardada (huella ${saved.fingerprint}). Visionary Trades ya la está usando, sin reiniciar el servidor.`);
      process.exitCode = 0;
      return;
    }
    log(`RECHAZADA por Visionary Trades: ${saved.message}`);
    // Sigue probando otras entradas del manifiesto por si hay otro navegador/perfil con
    // una sesión distinta que sí sirva.
  }

  if (appBoundSeen) {
    log(
      "Tu navegador protege las cookies con App-Bound Encryption (prefijo v20) — esto NO se puede descifrar desde fuera del navegador, por diseño de Chrome/Windows. No hay rodeo posible. Usa el método manual: copia la cookie desde DevTools y pégala en /ajustes.",
    );
    process.exitCode = 3;
    return;
  }

  log(
    "No se encontró una sesión válida de MarketSnack en ningún navegador revisado. Asegúrate de tener la sesión abierta en app.marketsnack.com (inicia sesión si hace falta) y vuelve a intentar.",
  );
  process.exitCode = 2;
}

main();
