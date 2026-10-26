// Lectura automática del pre-mercado de VisionFutura (SPX, NQ, TSLA), para que el pronóstico del
// día quede guardado aunque la app no esté abierta (la última lectura antes de las 9:30 NY es la
// que se califica al cierre). Hace lo mismo que abrir la sección "🌅 Pre-mercado".
// NO necesita el servidor. Uso (cwd = web): npx tsx scripts/vision-futura-premarket/run.ts
// Log: data/vision-futura/premarket-task.log

import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const WEB_DIR = process.cwd();
try {
  for (const rawLine of readFileSync(join(WEB_DIR, ".env.local"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[line.slice(0, idx).trim()] = val;
  }
} catch { /* sin .env.local */ }

const LOG_DIR = join(WEB_DIR, "data", "vision-futura");
function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(join(LOG_DIR, "premarket-task.log"), line + "\n", "utf8"); } catch { /* sin disco */ }
}

async function main() {
  const { loadPremarket } = await import("../../lib/visionFuturaPremarketData");
  let fallas = 0;
  for (const inst of ["SPX", "NQ", "TSLA"]) {
    try {
      const p = await loadPremarket(inst, new Date(), { force: true });
      const r = p.day?.report;
      if (p.error || !r) { fallas++; log(`${inst} ${p.date}: FALLÓ — ${p.error ?? "sin reporte"}`); continue; }
      log(`${inst} ${p.date} (${p.phase}): precio ${r.spot} · ±${r.sigma} (${r.sigmaSource}) · rango ${r.range.low}–${r.range.high} · Magneto ${r.levels.magnet} · GEX ${r.regime} · confianza ${r.confidence}`);
    } catch (e) {
      fallas++;
      log(`${inst}: FALLÓ — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (fallas > 0) process.exitCode = 1;
}

main().catch((e) => { log(`FALLÓ — ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
