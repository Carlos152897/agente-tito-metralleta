#!/usr/bin/env node
// Autorización inicial (o re-autorización) de Schwab Trader API — flujo OAuth2 manual.
// El refresh_token dura 7 días, así que este script se vuelve a correr cuando expire.
//
// Uso (desde web/):
//   node --env-file=.env.local scripts/schwab-auth.mjs

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const clientId = process.env.SCHWAB_CLIENT_ID;
const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
const redirectUri = process.env.SCHWAB_REDIRECT_URI || "https://127.0.0.1";

if (!clientId || !clientSecret) {
  console.error(
    "Falta SCHWAB_CLIENT_ID/SCHWAB_CLIENT_SECRET.\nCorre este script con: node --env-file=.env.local scripts/schwab-auth.mjs",
  );
  process.exit(1);
}

const authorizeUrl =
  `${"https://api.schwabapi.com/v1/oauth/authorize"}?client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}`;

console.log("1. Abre esta URL en el navegador y loguéate con tu cuenta de Schwab:\n");
console.log(`   ${authorizeUrl}\n`);
console.log("2. Tras aprobar el acceso, el navegador intentará ir a algo como:");
console.log(`   ${redirectUri}/?code=C0.b2F1dGgy...&session=...`);
console.log("   (va a fallar o quedarse en blanco — es normal, ahí no hay servidor).\n");
console.log("3. Copia la URL completa de la barra de direcciones (o solo el código) y pégala abajo.\n");

const rl = createInterface({ input: stdin, output: stdout });
const pasted = (await rl.question("URL o código: ")).trim();
rl.close();

let code = pasted;
try {
  const u = new URL(pasted);
  code = u.searchParams.get("code") ?? pasted;
} catch {
  // no era una URL completa — se asume que ya pegaron el código
}
code = decodeURIComponent(code);

if (!code) {
  console.error("No se encontró un código en lo que pegaste.");
  process.exit(1);
}

const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

const res = await fetch("https://api.schwabapi.com/v1/oauth/token", {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: body.toString(),
});

if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(`\nFalló el intercambio de código (${res.status}): ${text}`);
  process.exit(1);
}

const json = await res.json();
const tokenFile = path.join(process.cwd(), "data", "schwab-token.json");
await mkdir(path.dirname(tokenFile), { recursive: true });
await writeFile(
  tokenFile,
  JSON.stringify(
    {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + json.expires_in * 1000,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\nListo — token guardado en ${tokenFile}`);
console.log("El refresh_token dura 7 días; si expira, vuelve a correr este script.");
