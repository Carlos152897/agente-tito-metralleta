// Vigilancia EN VIVO de VisionFutura todo el día, sin la página abierta (Carlos, 27-oct-2026:
// "guardar también las alertas en vivo con su resultado y dejar la página abierta todo el día").
//
// Corre el mismo ciclo que la pestaña (lib/visionFuturaAlertStore.ts → runVisionFuturaCycle) para
// SPX, NQ y TSLA cada 30 s, de 9:30 a 16:00 NY: las alertas, la señal del dinero y los lottos se
// disparan y guardan en data/vision-futura/alert-state*.json igual que con la página abierta (si la
// página también está abierta, las dos alimentan el mismo estado). Al cierre hace un último ciclo
// (liquida lottos y señales abiertas) y archiva el estado del día en data/vision-futura/live/.
// La tarea de las 3:20pm (vision-futura-replay/run.ts) lo califica con velas de 1 min y lo mete al
// backtest. NO necesita el servidor de la app. Ventana = ±60 y vencimiento de hoy (lo de la página
// por defecto).
//
// Uso (cwd = web): npx tsx scripts/vision-futura-live/poll.ts
// Log: data/vision-futura/live-task.log

import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

const WEB_DIR = process.cwd();
try {
  for (const rawLine of readFileSync(join(WEB_DIR, ".env.local"), "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
} catch { /* sin .env.local */ }

const LOG_DIR = join(WEB_DIR, "data", "vision-futura");
const LOG = join(LOG_DIR, "live-task.log");
function log(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(LOG, line + "\n", "utf8"); } catch { /* sin disco */ }
}

const INSTRUMENTS = ["SPX", "NQ", "TSLA"];
const EVERY_MS = 30_000;
const RADIUS = 60;

/** Minuto del día y fecha en Nueva York. */
function ny(ms = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Candado: UNA sola vigilancia a la vez (28-oct-2026: tras reiniciar la tarea quedaron hasta 3
// procesos escribiendo los mismos archivos y se borró el estado de NQ). Si ya hay otra viva, esta
// se cierra sin hacer nada. Para reiniciar con código nuevo: Reiniciar-Vigilancia.ps1 (mata la vieja).
const LOCK = join(LOG_DIR, "live.lock");
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};
function takeLock(): boolean {
  try {
    const cur = JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number; at: number };
    if (cur.pid !== process.pid && alive(cur.pid) && Date.now() - cur.at < 14 * 3600_000) {
      log(`ya hay una vigilancia corriendo (proceso ${cur.pid}); esta se cierra.`);
      return false;
    }
  } catch { /* sin candado o candado roto: se toma */ }
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }), "utf8");
  const free = () => {
    try { if ((JSON.parse(readFileSync(LOCK, "utf8")) as { pid: number }).pid === process.pid) unlinkSync(LOCK); } catch { /* ya no está */ }
  };
  process.on("exit", free);
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(sig, () => { free(); process.exit(0); });
  return true;
}

async function main() {
  if (!takeLock()) return;
  const { runVisionFuturaCycle } = await import("../../lib/visionFuturaAlertStore");
  const { archiveLiveState } = await import("../../lib/visionFuturaLiveStore");

  const START = 9 * 60 + 29, END = 16 * 60;
  const { date } = ny();
  if (ny().min >= END + 5) { log(`${date}: la sesión ya terminó, no hay nada que vigilar.`); return; }
  log(`${date}: arranca la vigilancia en vivo (${INSTRUMENTS.join(", ")}, cada ${EVERY_MS / 1000} s).`);
  while (ny().min < START) await sleep(20_000);

  const fired: Record<string, number> = {};
  const lastErr: Record<string, { msg: string; at: number }> = {};
  let lastBeat = 0;
  const cycle = async () => {
    for (const inst of INSTRUMENTS) {
      try {
        const r = await runVisionFuturaCycle(new Date(), RADIUS, inst, 0);
        const n = r.alerts.length;
        if (n > (fired[inst] ?? 0)) {
          const a = r.alerts[0];
          log(`${inst}: ALERTA ${a.title} · ${a.order.side} entrada ${a.order.entry.spx.toFixed(2)} stop ${a.order.stop.spx.toFixed(2)} obj ${a.order.target?.spx.toFixed(2) ?? "—"}`);
        }
        fired[inst] = n;
        delete lastErr[inst];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const prev = lastErr[inst];
        if (!prev || prev.msg !== msg || Date.now() - prev.at > 10 * 60_000) { log(`${inst}: FALLÓ el ciclo — ${msg}`); lastErr[inst] = { msg, at: Date.now() }; }
      }
    }
  };

  while (ny().min < END) {
    const t0 = Date.now();
    await cycle();
    if (Date.now() - lastBeat > 60 * 60_000) { lastBeat = Date.now(); log(`sigue vigilando · alertas hoy: ${INSTRUMENTS.map((i) => `${i} ${fired[i] ?? 0}`).join(", ")}`); }
    await sleep(Math.max(1_000, EVERY_MS - (Date.now() - t0)));
  }
  // Último ciclo después de las 16:00: liquida lottos y cierra señales abiertas al último precio.
  await sleep(60_000);
  await cycle();
  for (const inst of INSTRUMENTS) archiveLiveState(inst, date);
  log(`${date}: terminó la vigilancia · alertas: ${INSTRUMENTS.map((i) => `${i} ${fired[i] ?? 0}`).join(", ")} · estado archivado en data/vision-futura/live/`);
}

main().then(() => process.exit(0)).catch((e) => { log(`FALLÓ — ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
