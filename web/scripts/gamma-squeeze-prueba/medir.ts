// GAMMA SQUEEZE PRUEBA — medición (Carlos, 19-nov-2026). Aparte de todo: solo LEE las repeticiones
// guardadas, baja velas de 1 min de los contratos 0DTE de SPX (14:30–16:00) por DXLink (una
// conexión por día) y escribe en data/gamma-squeeze-prueba/ y en su propio Excel. No toca la app.
//
// Uso (cwd = web): npx tsx scripts/gamma-squeeze-prueba/medir.ts

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";

const WEB = process.cwd();
try {
  for (const raw of readFileSync(join(WEB, ".env.local"), "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[line.slice(0, i).trim()] = v;
  }
} catch { /* sin .env.local */ }

import { pullOhlc, type Bar } from "./dx";

async function main() {
  const { dayOpenMs } = await import("../../lib/visionFuturaRetestStore");
  const G = await import("../../lib/gammaSqueezePrueba");
  const T = G.SQUEEZE_TUNING;

  const DATA = join(WEB, "data", "vision-futura");
  const OUT = join(WEB, "data", "gamma-squeeze-prueba");
  mkdirSync(OUT, { recursive: true });
  const velas: Record<string, { time: number; high: number; low: number; close?: number }[]> =
    JSON.parse(readFileSync(join(DATA, "imanes-prueba", "velas-SPX.json"), "utf8"));
  const days = readdirSync(DATA).map((f) => f.match(/^replay-(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter((d): d is string => !!d).sort();

  const all: import("../../lib/gammaSqueezePrueba").SqCandidate[] = [];
  const skipped: string[] = [];
  for (const d of days) {
    const rp = JSON.parse(readFileSync(join(DATA, `replay-${d}.json`), "utf8"));
    if (rp.partial || rp.expiration !== d) { skipped.push(`${d} (sin 0DTE del día)`); continue; }
    const spx = velas[d] ?? [];
    if (spx.length < 380) { skipped.push(`${d} (sin velas SPX)`); continue; }
    const open = dayOpenMs(d) / 1000;
    const lastHour = spx.filter((b) => b.time >= open + 300 * 60);
    const lo = Math.floor((Math.min(...lastHour.map((b) => b.low)) - T.maxDistPts - 5) / 5) * 5;
    const hi = Math.ceil((Math.max(...lastHour.map((b) => b.high)) + T.maxDistPts + 5) / 5) * 5;
    const yymmdd = d.slice(2).replace(/-/g, "");
    const file = join(OUT, `opciones-SPX-${d}.json`);
    let raw: Record<string, Bar[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const want: string[] = [];
    for (let k = lo; k <= hi; k += 5) for (const ty of ["C", "P"]) want.push(`.SPXW${yymmdd}${ty}${k}`);
    const missing = want.filter((s) => !(s in raw));
    if (missing.length) {
      const got = await pullOhlc(missing, (open + 300 * 60) * 1000);
      for (const s of missing) raw[s] = (got.get(s) ?? []).filter((b) => b.time < open + 390 * 60);
      writeFileSync(file, JSON.stringify(raw));
    }
    const withData = Object.values(raw).filter((b) => b.length > 0).length;
    const contracts = Object.entries(raw).map(([s, bars]) => {
      const m = s.match(/([CP])(\d+(?:\.\d+)?)$/)!;
      return { type: m[1] === "C" ? "call" as const : "put" as const, strike: Number(m[2]), bars };
    });
    const cands = G.squeezeCandidates(d, open, rp.ticks, spx, contracts);
    all.push(...cands);
    console.log(`${d}: ${withData}/${want.length} contratos con velas · ${cands.length} candidatos ≤ $1 · mejor ${cands.reduce((m, c) => Math.max(m, c.maxMult), 0).toFixed(1)}×`);
  }

  const S = G.summarizeSqueeze(all);
  writeFileSync(join(OUT, "resultado-SPX.json"), JSON.stringify({ builtAt: new Date().toISOString(), days, skipped, summary: S }, null, 1));

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const line = (s: import("../../lib/gammaSqueezePrueba").SqGroupStats) =>
    `${s.label.padEnd(52)} ${String(s.n).padStart(5)} ${String(s.days).padStart(3)}d ${T.mults.map((m) => pct(s.hit[m])).join(" ")}  ${(s.avgPnl >= 0 ? "+" : "") + s.avgPnl.toFixed(2)}  ${s.best.toFixed(0)}×`;
  console.log(`\n${"".padEnd(52)} ${"n".padStart(5)} días ${T.mults.map((m) => `≥${m}×`.padStart(6)).join(" ")}  $/1$  mejor`);
  console.log(line(S.base));
  console.log("\n— Cada condición (SÍ vs NO):");
  for (const c of S.byCond) { console.log(line(c.yes)); console.log(line(c.no)); }
  console.log("\n— Por cuántas condiciones a la vez:");
  for (const s of S.byScore) console.log(line(s));
  if (skipped.length) console.log("\nSaltados:", skipped.join(", "));

  // ── Excel propio.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.addRow([`GAMMA SQUEEZE PRUEBA · SPX 0DTE · ${new Set(all.map((c) => c.date)).size} días · precios reales de 1 min (tastytrade) · aparte de la app`]).font = { bold: true, size: 13 };
  ws.addRow([`Candidato = call arriba / put abajo a ${T.minDistPts}–${T.maxDistPts} pts con último precio $${T.minPrice}–$${T.maxPrice}, en lecturas cada 5 min de 15:00 a 15:50. Entrada = apertura de la vela siguiente + $${T.slippage}. "≥5×" = llegó a 5 veces la entrada antes del cierre. $/1$ = resultado por cada $1 vendiendo en ${T.exitMult}× si llega, si no al vencimiento.`]);
  ws.addRow([]);
  ws.addRow(["Grupo", "Candidatos", "Días", ...T.mults.map((m) => `Llegó a ${m}× %`), "Resultado por $1", "Mejor múltiplo"]).font = { bold: true };
  const put = (s: import("../../lib/gammaSqueezePrueba").SqGroupStats, bold = false) => {
    const r = ws.addRow([s.label, s.n, s.days, ...T.mults.map((m) => s.hit[m]), s.avgPnl, s.best]);
    T.mults.forEach((_, i) => { r.getCell(4 + i).numFmt = "0.0%"; });
    r.getCell(4 + T.mults.length).numFmt = "+0.00;-0.00"; r.getCell(5 + T.mults.length).numFmt = "0.0\"×\"";
    r.getCell(4 + T.mults.length).font = { bold: true, color: { argb: s.avgPnl >= 0 ? "FF067647" : "FFB42318" } };
    if (bold) r.getCell(1).font = { bold: true };
  };
  put(S.base, true);
  ws.addRow([]); ws.addRow(["Cada condición"]).font = { bold: true };
  for (const c of S.byCond) { put(c.yes); put(c.no); }
  ws.addRow([]); ws.addRow(["Condiciones a la vez"]).font = { bold: true };
  for (const s of S.byScore) put(s);
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 52 : 15; });

  const wc = wb.addWorksheet("Candidatos");
  const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  wc.addRow(["Día", "Lectura NY", "Tipo", "Strike", "SPX", "Distancia", "σ restante", "Último $", "Entrada $", "Máximo $", "Máx ×", "Hora del máximo", "Vence en $", "Resultado por $1", "Condiciones", ...G.CONDITIONS.map((k) => G.CONDITION_LABELS[k])]).font = { bold: true };
  for (const c of all) {
    wc.addRow([c.date, fmt.format(new Date((dayOpenMs(c.date) / 1000 + c.readMin * 60) * 1000)), c.type, c.strike, Math.round(c.spot * 100) / 100, Math.round(c.dist * 10) / 10,
      c.sigma != null ? Math.round(c.sigma * 10) / 10 : "-", c.lastPrice, Math.round(c.entry * 100) / 100, c.maxPrice, Math.round(c.maxMult * 10) / 10, fmt.format(new Date(c.maxT * 1000)),
      Math.round(c.expiryValue * 100) / 100, Math.round(c.pnlPerDollar * 100) / 100, c.score, ...G.CONDITIONS.map((k) => (c.cond[k] ? "Sí" : ""))]);
  }
  wc.autoFilter = { from: "A1", to: { row: 1, column: 15 + G.CONDITIONS.length } };

  const deskDir = join(process.env.USERPROFILE ?? "C:\\Users\\carlo", "OneDrive", "Desktop", "VisionFutura Backtest");
  mkdirSync(deskDir, { recursive: true });
  const xlsx = join(deskDir, "Gamma Squeeze Prueba - SPX.xlsx");
  await wb.xlsx.writeFile(xlsx);
  console.log(`\nExcel: ${xlsx}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
