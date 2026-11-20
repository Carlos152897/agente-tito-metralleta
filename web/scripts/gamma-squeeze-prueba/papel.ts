// GAMMA SQUEEZE PRUEBA · EN PAPEL (Carlos, 19-nov-2026: "sí, en papel"). Aparte de todo: lee las
// repeticiones que arma la tarea del cierre, baja por DXLink las velas de 1 min de los contratos 0DTE
// de SPX de ese día (14:30–16:00, una conexión) y califica las reglas congeladas
// (lib/gammaSqueezePrueba.ts → SQUEEZE_RULES) en los días nuevos desde SQUEEZE_PAPEL_START. Muestra
// al lado lo que dieron en los días de prueba (antes). No toca la app ni manda nada.
//
// Uso (cwd = web): npx tsx scripts/gamma-squeeze-prueba/papel.ts [--desde AAAA-MM-DD]
// Corre en la tarea "VisionaryTrades-ImanesPruebaPapel" (8:30 pm), después de Imanes Prueba.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { pullOhlc, type Bar } from "./dx";

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
const OUT = join(WEB, "data", "gamma-squeeze-prueba");
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
  const G = await import("../../lib/gammaSqueezePrueba");
  const T = G.SQUEEZE_TUNING;

  const argi = process.argv.indexOf("--desde");
  const desde = argi > 0 ? process.argv[argi + 1] : G.SQUEEZE_PAPEL_START;
  const days = readdirSync(DATA).map((f) => f.match(/^replay-(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter((d): d is string => !!d).sort();

  // Velas de SPX (mismo caché que Imanes Prueba; si falta el día se bajan aquí).
  type SB = { time: number; high: number; low: number; close?: number };
  const velasFile = join(DATA, "imanes-prueba", "velas-SPX.json");
  const velas: Record<string, SB[]> = existsSync(velasFile) ? JSON.parse(readFileSync(velasFile, "utf8")) : {};
  let velasChanged = false;
  async function spxOf(d: string): Promise<SB[]> {
    if (velas[d]?.length >= 385 && velas[d][0].close != null) return velas[d];
    const o = dayOpenMs(d);
    const inDay = (b: { time: number }) => b.time * 1000 >= o && b.time * 1000 < o + 390 * 60_000;
    let bars: SB[] = (await fetchFutureCandles("SPX", o, "1m", 30_000, 0).catch(() => [])).filter(inDay);
    if (bars.length < 385) {
      const y = (await fetchYahooCandles("SPX", o, o + 390 * 60_000, 0).catch(() => [])).filter(inDay);
      if (y.length > bars.length) bars = y;
    }
    bars = bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close }));
    if (bars.length >= 385) { velas[d] = bars; velasChanged = true; }
    return bars;
  }

  const trades: import("../../lib/gammaSqueezePrueba").SqueezeTrade[] = [];
  const nuevos: string[] = [];
  const pendientes: string[] = [];
  for (const d of days) {
    const rp = JSON.parse(readFileSync(join(DATA, `replay-${d}.json`), "utf8"));
    if (rp.partial) { pendientes.push(`${d} (repetición incompleta)`); continue; }
    if (rp.expiration !== d) continue; // sin 0DTE ese día
    const spx = await spxOf(d);
    if (spx.length < 385) { pendientes.push(`${d} (faltan velas SPX)`); continue; }
    const open = dayOpenMs(d) / 1000;
    const lastHour = spx.filter((b) => b.time >= open + 300 * 60);
    const lo = Math.floor((Math.min(...lastHour.map((b) => b.low)) - T.maxDistPts - 5) / 5) * 5;
    const hi = Math.ceil((Math.max(...lastHour.map((b) => b.high)) + T.maxDistPts + 5) / 5) * 5;
    const yymmdd = d.slice(2).replace(/-/g, "");
    const file = join(OUT, `opciones-SPX-${d}.json`);
    const raw: Record<string, Bar[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const want: string[] = [];
    for (let k = lo; k <= hi; k += 5) for (const ty of ["C", "P"]) want.push(`.SPXW${yymmdd}${ty}${k}`);
    const missing = want.filter((s) => !(s in raw));
    if (missing.length) {
      const got = await pullOhlc(missing, (open + 300 * 60) * 1000);
      const withBars = missing.filter((s) => (got.get(s) ?? []).length > 0).length;
      if (withBars === 0) { pendientes.push(`${d} (DXLink no dio velas de opciones)`); continue; }
      for (const s of missing) raw[s] = (got.get(s) ?? []).filter((b) => b.time < open + 390 * 60);
      writeFileSync(file, JSON.stringify(raw));
    }
    const contracts = Object.entries(raw).map(([s, bars]) => {
      const m = s.match(/([CP])(\d+(?:\.\d+)?)$/)!;
      return { type: m[1] === "C" ? "call" as const : "put" as const, strike: Number(m[2]), bars };
    });
    trades.push(...G.paperSqueezeDay(G.squeezeCandidates(d, open, rp.ticks, spx, contracts)));
    if (d >= desde) nuevos.push(d);
  }
  if (velasChanged) writeFileSync(velasFile, JSON.stringify(velas));
  writeFileSync(join(OUT, "papel-SPX.json"), JSON.stringify({ builtAt: new Date().toISOString(), desde, nuevos, pendientes, trades }, null, 1));

  const sum = (g: typeof trades) => ({
    n: g.length, sold: g.filter((t) => t.salida === "vendido").length, usd: g.reduce((a, t) => a + t.pnlUsd, 0),
    cost: g.reduce((a, t) => a + t.entry * 100, 0), best: g.reduce((m, t) => Math.max(m, t.maxMult), 0), dias: new Set(g.map((t) => t.date)).size,
  });
  log(`Squeeze en papel desde ${desde}: ${nuevos.length} días nuevos (${nuevos.join(", ") || "ninguno todavía"})${pendientes.length ? ` · pendientes: ${pendientes.join(", ")}` : ""}`);
  for (const r of G.SQUEEZE_RULES) {
    const a = sum(trades.filter((t) => t.rule === r.id && t.date >= desde));
    const b = sum(trades.filter((t) => t.rule === r.id && t.date < desde));
    const f = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}`;
    log(`  ${r.label}: EN PAPEL ${a.n} ops, ${a.sold} vendidas en ${r.exitMult}×, ${f(a.usd)} · antes ${b.n} ops, ${b.sold} vendidas, ${f(b.usd)} (costo ${f(b.cost)})`);
  }

  // ── Excel propio.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.addRow([`GAMMA SQUEEZE PRUEBA · EN PAPEL · SPX 0DTE · reglas congeladas el 19-nov-2026, calificadas desde ${desde}`]).font = { bold: true, size: 13 };
  ws.addRow(["Una operación por día y lado (la primera señal de 15:00–15:50), 1 contrato, precio real de 1 min + $0.05; vender todo en 3× (orden límite) o sostener al vencimiento. Solo papel."]);
  ws.addRow([]);
  ws.addRow(["Regla", "Periodo", "Operaciones", "Vendidas en 3×", "% vendidas", "Costo total $", "Resultado $", "Resultado por $1", "Mejor múltiplo", "Días"]).font = { bold: true };
  for (const r of G.SQUEEZE_RULES) {
    for (const [lbl, g] of [["EN PAPEL (días nuevos)", trades.filter((t) => t.rule === r.id && t.date >= desde)], ["Antes (días de prueba)", trades.filter((t) => t.rule === r.id && t.date < desde)]] as const) {
      const s = sum(g as typeof trades);
      const row = ws.addRow([r.label, lbl, s.n, s.sold, s.n ? s.sold / s.n : 0, s.cost, s.usd, s.cost ? s.usd / s.cost : 0, s.best, s.dias]);
      row.getCell(5).numFmt = "0%"; row.getCell(6).numFmt = "$#,##0"; row.getCell(7).numFmt = "+$#,##0;-$#,##0"; row.getCell(8).numFmt = "+0.00;-0.00"; row.getCell(9).numFmt = "0.0\"×\"";
      row.getCell(7).font = { bold: true, color: { argb: s.usd >= 0 ? "FF067647" : "FFB42318" } };
      if (lbl.startsWith("EN PAPEL")) row.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
    }
  }
  ws.columns.forEach((c, i) => { c.width = i === 0 ? 62 : i === 1 ? 24 : 14; });

  const wo = wb.addWorksheet("Operaciones");
  const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  wo.addRow(["Día", "Periodo", "Regla", "Tipo", "Strike", "Lectura NY", "Entrada NY", "Entrada $", "Máximo $", "Máx ×", "Salida", "Precio de salida $", "Resultado $ (1 contrato)", "Condiciones"]).font = { bold: true };
  for (const t of trades) {
    const r = wo.addRow([t.date, t.date >= desde ? "EN PAPEL" : "antes", t.rule, t.type, t.strike, fmt.format(new Date((dayOpenMs(t.date) / 1000 + t.readMin * 60) * 1000)),
      fmt.format(new Date(t.entryT * 1000)), Math.round(t.entry * 100) / 100, t.maxPrice, Math.round(t.maxMult * 10) / 10, t.salida,
      Math.round(t.exitPrice * 100) / 100, Math.round(t.pnlUsd), t.score]);
    r.getCell(13).font = { color: { argb: t.pnlUsd >= 0 ? "FF067647" : "FFB42318" } };
  }
  wo.autoFilter = { from: "A1", to: "N1" };

  const deskDir = join(process.env.USERPROFILE ?? "C:\\Users\\carlo", "OneDrive", "Desktop", "VisionFutura Backtest");
  mkdirSync(deskDir, { recursive: true });
  const xlsx = join(deskDir, "Gamma Squeeze Prueba - En papel SPX.xlsx");
  try { await wb.xlsx.writeFile(xlsx); log(`Excel: ${xlsx}`); }
  catch (e) { log(`No se pudo escribir el Excel (¿está abierto?): ${(e as Error).message}`); }
  process.exit(0);
}

main().catch((e) => { log(`ERROR ${(e as Error).stack ?? e}`); process.exit(1); });
