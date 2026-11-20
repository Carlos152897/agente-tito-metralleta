// IMANES PRUEBA · EN PAPEL (Carlos, 19-nov-2026: "probarla en vivo"). Aparte de todo: solo LEE las
// repeticiones que la tarea del cierre ya arma (data/vision-futura/replay-*.json) y escribe en
// data/vision-futura/imanes-prueba/ y en su propio Excel. No llama a MarketSnack, no toca la
// vigilancia en vivo, ni alertas, ni backtest, ni Telegram.
//
// Califica la regla congelada (lib/imanesPrueba.ts → PAPER_RULES) en cada día NUEVO desde
// PAPEL_START, y muestra al lado lo que la misma regla dio en los días de prueba (antes).
//
// Uso (cwd = web): npx tsx scripts/imanes-prueba/papel.ts [--desde AAAA-MM-DD]
// Tarea programada: "VisionFutura-ImanesPrueba-Papel" L–V 8:30 pm (después de la repetición de las 8 pm).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
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

const DATA = join(WEB, "data", "vision-futura");
const OUT = join(DATA, "imanes-prueba");
const LOG = join(OUT, "papel.log");
function log(m: string) {
  const line = `${new Date().toISOString()} ${m}`;
  console.log(line);
  try { mkdirSync(OUT, { recursive: true }); appendFileSync(LOG, line + "\n", "utf8"); } catch { /* sin disco */ }
}

async function main() {
  const { fetchFutureCandles } = await import("../../lib/futuresCandles");
  const { fetchYahooCandles } = await import("../../lib/yahooCandles");
  const { dayOpenMs } = await import("../../lib/visionFuturaRetestStore");
  const P = await import("../../lib/imanesPrueba");

  const argi = process.argv.indexOf("--desde");
  const desde = argi > 0 ? process.argv[argi + 1] : P.PAPEL_START;
  const days = readdirSync(DATA).map((f) => f.match(/^replay-(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter((d): d is string => !!d).sort();

  type B = { time: number; high: number; low: number; close?: number };
  const velasFile = join(OUT, "velas-SPX.json");
  const velas: Record<string, B[]> = existsSync(velasFile) ? JSON.parse(readFileSync(velasFile, "utf8")) : {};
  let changed = false;
  async function barsOf(d: string): Promise<B[]> {
    if (velas[d]?.length >= 385 && velas[d][0].close != null) return velas[d];
    const o = dayOpenMs(d);
    const inDay = (b: { time: number }) => b.time * 1000 >= o && b.time * 1000 < o + 390 * 60_000;
    let bars: B[] = (await fetchFutureCandles("SPX", o, "1m", 30_000, 0).catch(() => [])).filter(inDay);
    if (bars.length < 385) {
      const y = (await fetchYahooCandles("SPX", o, o + 390 * 60_000, 0).catch(() => [])).filter(inDay);
      if (y.length > bars.length) bars = y;
    }
    bars = bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close }));
    if (bars.length >= 385) { velas[d] = bars; changed = true; }
    return bars;
  }

  const trades: import("../../lib/imanesPrueba").PaperTrade[] = [];
  const nuevos: string[] = [];
  const pendientes: string[] = [];
  for (const d of days) {
    const rp = JSON.parse(readFileSync(join(DATA, `replay-${d}.json`), "utf8"));
    if (rp.partial) { pendientes.push(`${d} (repetición incompleta)`); continue; }
    const bars = await barsOf(d);
    if (bars.length < 385) { pendientes.push(`${d} (faltan velas de 1 min: ${bars.length})`); continue; }
    const o = dayOpenMs(d) / 1000;
    trades.push(...P.paperDay(d, rp.ticks, bars, o + 390 * 60, o, rp.scale ?? 1, rp.strikeStep ?? 5));
    if (d >= desde) nuevos.push(d);
  }
  if (changed) writeFileSync(velasFile, JSON.stringify(velas));
  writeFileSync(join(OUT, "papel-SPX.json"), JSON.stringify({ builtAt: new Date().toISOString(), desde, nuevos, pendientes, trades }, null, 1));

  const sum = (g: typeof trades) => ({
    n: g.length, w: g.filter((t) => t.outcome === "objetivo").length, s: g.filter((t) => t.outcome === "stop").length,
    pts: g.reduce((a, t) => a + t.pts, 0), dias: new Set(g.map((t) => t.date)).size,
    diasPos: [...new Set(g.map((t) => t.date))].filter((d) => g.filter((t) => t.date === d).reduce((a, t) => a + t.pts, 0) > 0).length,
  });

  // ── Consola / log.
  log(`En papel desde ${desde}: ${nuevos.length} días nuevos (${nuevos.join(", ") || "ninguno todavía"})${pendientes.length ? ` · pendientes: ${pendientes.join(", ")}` : ""}`);
  for (const r of P.PAPER_RULES) {
    const a = sum(trades.filter((t) => t.rule === r.id && t.date >= desde));
    const b = sum(trades.filter((t) => t.rule === r.id && t.date < desde));
    log(`  ${r.label}: EN PAPEL ${a.n} ops ${a.w}G/${a.s}P ${a.pts >= 0 ? "+" : ""}${a.pts.toFixed(1)} pts (${a.diasPos}/${a.dias} días +) · antes ${b.n} ops ${b.pts >= 0 ? "+" : ""}${b.pts.toFixed(1)} pts (${b.diasPos}/${b.dias} días +)`);
  }

  // ── Excel propio.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.addRow([`IMANES PRUEBA · EN PAPEL · SPX · regla congelada el 19-nov-2026, calificada desde ${desde}`]).font = { bold: true, size: 13 };
  ws.addRow(["Corto en la ruptura: el precio cae y toca un Imán + de flujo (debajo del precio) → corto en el strike, stop 3 pts, objetivo 5 o 10 pts, máx 30 min, una operación a la vez. Solo papel: no manda nada ni toca la app. 1 pt de SPX = $50 en /ES, $5 en /MES."]);
  ws.addRow([]);
  ws.addRow(["Regla", "Periodo", "Operaciones", "Ganadas", "Stops", "% ganadas", "Pts total", "Pts por op", "Días", "Días +", "$ /ES", "$ /MES"]).font = { bold: true };
  for (const r of P.PAPER_RULES) {
    for (const [lbl, g] of [["EN PAPEL (días nuevos)", trades.filter((t) => t.rule === r.id && t.date >= desde)], ["Antes (días de prueba)", trades.filter((t) => t.rule === r.id && t.date < desde)]] as const) {
      const s = sum(g as typeof trades);
      const row = ws.addRow([r.label, lbl, s.n, s.w, s.s, s.n ? s.w / s.n : 0, s.pts, s.n ? s.pts / s.n : 0, s.dias, s.diasPos, s.pts * 50, s.pts * 5]);
      row.getCell(6).numFmt = "0%"; row.getCell(7).numFmt = "0.0"; row.getCell(8).numFmt = "0.00";
      row.getCell(11).numFmt = "$#,##0"; row.getCell(12).numFmt = "$#,##0";
      row.getCell(7).font = { bold: true, color: { argb: s.pts >= 0 ? "FF067647" : "FFB42318" } };
      if (lbl.startsWith("EN PAPEL")) row.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
    }
  }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 46 : i === 1 ? 24 : 13; });

  const wdia = wb.addWorksheet("Por día");
  wdia.addRow(["Día", "Periodo", ...P.PAPER_RULES.map((r) => r.label)]).font = { bold: true };
  for (const d of [...new Set(trades.map((t) => t.date))].sort()) {
    const row = wdia.addRow([d, d >= desde ? "EN PAPEL" : "antes", ...P.PAPER_RULES.map((r) => trades.filter((t) => t.rule === r.id && t.date === d).reduce((a, t) => a + t.pts, 0))]);
    for (let c = 3; c <= P.PAPER_RULES.length + 2; c++) row.getCell(c).numFmt = "0.0";
  }
  wdia.columns.forEach((c, i) => { c.width = i < 2 ? 12 : 30; });

  const wo = wb.addWorksheet("Operaciones");
  const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  wo.addRow(["Día", "Periodo", "Regla", "Imán", "Strike", "Lectura NY", "Entrada NY", "Salida NY", "Lado", "Entrada", "Stop", "Objetivo", "Resultado", "Pts"]).font = { bold: true };
  for (const t of trades) {
    wo.addRow([t.date, t.date >= desde ? "EN PAPEL" : "antes", P.PAPER_RULES.find((r) => r.id === t.rule)?.label ?? t.rule, P.MAGNET_LABELS[t.magnet] ?? t.magnet, t.strike,
      fmt.format(new Date(t.readT * 1000)), fmt.format(new Date(t.entryT * 1000)), fmt.format(new Date(t.exitT * 1000)), t.side, t.entry, t.stop, t.target, t.outcome, Math.round(t.pts * 100) / 100]);
  }
  wo.autoFilter = { from: "A1", to: "N1" };

  const deskDir = join(process.env.USERPROFILE ?? "C:\\Users\\carlo", "OneDrive", "Desktop", "VisionFutura Backtest");
  mkdirSync(deskDir, { recursive: true });
  const xlsx = join(deskDir, "Imanes Prueba - En papel SPX.xlsx");
  try { await wb.xlsx.writeFile(xlsx); log(`Excel: ${xlsx}`); }
  catch (e) { log(`No se pudo escribir el Excel (¿está abierto?): ${(e as Error).message}`); }
}

main().catch((e) => { log(`ERROR ${(e as Error).stack ?? e}`); process.exit(1); });
