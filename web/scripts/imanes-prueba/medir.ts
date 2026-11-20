// IMANES PRUEBA — medición (Carlos, 19-nov-2026). Aparte de todo: solo LEE las repeticiones
// guardadas y escribe en data/vision-futura/imanes-prueba/ y en un Excel propio del Escritorio.
// No toca la app, ni las alertas, ni el backtest, ni sus Excel.
//
// Uso (cwd = web): npx tsx scripts/imanes-prueba/medir.ts [SPX|NQ|...]
// Velas de 1 min: tastytrade DXLink (una sola descarga desde el primer día) y, si falta un día, Yahoo.
// Quedan guardadas en data/vision-futura/imanes-prueba/velas-{inst}.json para no bajarlas otra vez.

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

async function main() {
  const { fetchFutureCandles } = await import("../../lib/futuresCandles");
  const { fetchYahooCandles } = await import("../../lib/yahooCandles");
  const { instrumentOf } = await import("../../lib/visionFuturaInstruments");
  const { dayOpenMs } = await import("../../lib/visionFuturaRetestStore");
  const P = await import("../../lib/imanesPrueba");

  const inst = (process.argv[2] ?? "SPX").toUpperCase();
  const DATA = join(WEB, "data", "vision-futura");
  const OUT = join(DATA, "imanes-prueba");
  mkdirSync(OUT, { recursive: true });
  const re = inst === "SPX" ? /^replay-(\d{4}-\d{2}-\d{2})\.json$/ : new RegExp(`^replay-${inst}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
  const days = readdirSync(DATA).map((f) => f.match(re)?.[1]).filter((d): d is string => !!d).sort();
  console.log(`${inst}: ${days.length} días con repetición (${days[0]} → ${days.at(-1)})`);

  // ── Velas de 1 min (caché propio).
  const cfg = instrumentOf(inst);
  const sym = cfg.tastyMain.index ?? cfg.tastyMain.equity ?? cfg.main;
  const velasFile = join(OUT, `velas-${inst}.json`);
  const velas: Record<string, { time: number; high: number; low: number; close?: number }[]> = existsSync(velasFile) ? JSON.parse(readFileSync(velasFile, "utf8")) : {};
  const missing = days.filter((d) => !(velas[d]?.length > 300 && velas[d][0].close != null));
  if (missing.length) {
    console.log(`Bajando velas de 1 min de ${missing.length} días (${sym})...`);
    const all = await fetchFutureCandles(sym, dayOpenMs(missing[0]), "1m", 90_000, 0);
    console.log(`  tastytrade: ${all.length} velas`);
    for (const d of missing) {
      const o = dayOpenMs(d) / 1000;
      let bars = all.filter((b) => b.time >= o && b.time < o + 390 * 60);
      if (bars.length < 300) {
        const y = await fetchYahooCandles(sym, o * 1000, (o + 390 * 60) * 1000, 0).catch(() => []);
        if (y.length > bars.length) bars = y.filter((b) => b.time >= o && b.time < o + 390 * 60);
      }
      if (bars.length) velas[d] = bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close }));
      console.log(`  ${d}: ${bars.length} velas`);
    }
    writeFileSync(velasFile, JSON.stringify(velas));
  }

  // ── Medición.
  const obs: import("../../lib/imanesPrueba").Observation[] = [];
  const skipped: string[] = [];
  const bounces: import("../../lib/imanesPrueba").BounceEvent[] = [];
  for (const d of days) {
    const bars = velas[d] ?? [];
    if (bars.length < 300) { skipped.push(`${d} (sin velas de 1 min)`); continue; }
    const rp = JSON.parse(readFileSync(join(DATA, inst === "SPX" ? `replay-${d}.json` : `replay-${inst}-${d}.json`), "utf8"));
    if (rp.partial) { skipped.push(`${d} (repetición incompleta)`); continue; }
    const open = dayOpenMs(d) / 1000;
    const dayObs = P.observeDay(d, rp.ticks, bars, open + 390 * 60, open, rp.scale ?? 1);
    obs.push(...dayObs);
    bounces.push(...P.bounceDay(d, rp.ticks, bars, open + 390 * 60, open, rp.scale ?? 1, rp.strikeStep ?? 5));
  }
  const stats = P.summarize(obs);
  const bstats = P.summarizeBounces(bounces);
  const rstats = P.summarizeBreakouts(bounces, velas);
  writeFileSync(join(OUT, `resultado-${inst}.json`), JSON.stringify({ builtAt: new Date().toISOString(), inst, days, skipped, stats }, null, 1));

  // ── Consola.
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4);
  for (const h of P.IMANES_PRUEBA_TUNING.horizons) {
    console.log(`\n=== Horizonte ${h} min — ordenado por ventaja sobre la base ===`);
    console.log("imán".padEnd(38), "n".padStart(5), "llega", "base", "ventaja", "espejo", "dist", "falló a");
    for (const s of stats.filter((x) => x.horizon === h)) {
      console.log(s.label.padEnd(38), String(s.n).padStart(5), pct(s.hitPct).padStart(5), pct(s.basePct), `${((s.edge) * 100).toFixed(1)}`.padStart(7),
        pct(s.mirrorPct).padStart(6), s.avgDist.toFixed(1).padStart(5), (s.missMedian?.toFixed(1) ?? "-").padStart(7));
    }
  }
  const RB = P.REBOTE_TUNING;
  for (const x of RB.pts) {
    console.log(`\n=== REBOTE ±${x} pts (toque en ≤${RB.touchWithinMin} min, desenlace en ≤${RB.afterMin} min) ===`);
    console.log("imán".padEnd(38), "toques".padStart(6), "rebota", "base", "ventaja", "atraviesa", "base", "ventaja", "nada");
    for (const s of bstats.filter((b) => b.x === x)) {
      console.log(s.label.padEnd(38), String(s.toques).padStart(6), pct(s.rebotePct).padStart(6), pct(s.baseRebotePct), `${(s.ventajaRebote * 100).toFixed(1)}`.padStart(7),
        pct(s.atraviesaPct).padStart(9), pct(s.baseAtraviesaPct), `${(s.ventajaAtraviesa * 100).toFixed(1)}`.padStart(7), pct(s.nadaPct));
    }
  }
  const RT = P.RUPTURA_TUNING;
  const favLbl: Record<string, string> = { todos: "todos", a_favor: "flujo A FAVOR", en_contra: "flujo EN CONTRA", sin_lado: "" };
  for (const tgt of RT.targets) {
    console.log(`
=== RUPTURA · entrar en el toque a favor del movimiento · stop ${RT.stopPts} / objetivo ${tgt} pts / máx ${RT.afterMin} min ===`);
    console.log("imán".padEnd(38), "flujo".padEnd(16), "ops".padStart(5), "gana", "stop", "pts/op", "total", "base gana", "base pts/op", "sigue (med)");
    for (const s of rstats.filter((r) => r.target === tgt && (r.id === "base" || r.favor !== "todos" || !P.FLOW_IDS.some((f) => r.id.startsWith(f))))) {
      console.log(s.label.padEnd(38), (favLbl[s.favor] ?? "").padEnd(16), String(s.n).padStart(5), pct(s.winPct), pct(s.stopPct), s.avgPts.toFixed(2).padStart(6),
        s.totalPts.toFixed(0).padStart(6), pct(s.baseWinPct).padStart(9), s.baseAvgPts.toFixed(2).padStart(11), s.mfeMedian.toFixed(1).padStart(11));
    }
  }
  const amb = bounces.filter((b) => b.outcome === "ambiguo").length;
  console.log(`\nAmbiguos (rebote y atraviesa en la misma vela de 1 min, no cuentan): ${amb} de ${bounces.length}`);
  if (skipped.length) console.log("\nSaltados:", skipped.join(", "));

  // ── Excel propio.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Resumen");
  ws.addRow([`IMANES PRUEBA · ${inst} · ${days.length - skipped.length} días (${days[0]} → ${days.at(-1)}) · aparte de la app`]).font = { bold: true, size: 13 };
  ws.addRow(["Llega = el precio tocó el strike dentro del horizonte (velas reales de 1 min). Base = qué tan seguido se llega a un nivel cualquiera a esa misma distancia. Ventaja = llega − base (lo que importa). Espejo = llegó al nivel a la misma distancia del lado contrario."]);
  ws.addRow([]);
  const head = ws.addRow(["Horizonte (min)", "Imán", "Lecturas", "Días", "Llega %", "Base %", "Ventaja (pp)", "Espejo %", "Distancia prom (pts)", "Cuando falló, pasó a (pts, mediana)"]);
  head.font = { bold: true };
  for (const s of stats) {
    const r = ws.addRow([s.horizon, s.label, s.n, s.days, s.hitPct, s.basePct, s.edge * 100, s.mirrorPct, s.avgDist, s.missMedian ?? "-"]);
    r.getCell(5).numFmt = "0%"; r.getCell(6).numFmt = "0%"; r.getCell(7).numFmt = "0.0"; r.getCell(8).numFmt = "0%"; r.getCell(9).numFmt = "0.0";
    if (s.label.startsWith("PRUEBA")) r.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
    r.getCell(7).font = { color: { argb: s.edge >= 0 ? "FF067647" : "FFB42318" }, bold: true };
  }
  ws.columns.forEach((c, i) => { c.width = i === 1 ? 40 : 16; });

  const fmt = new Intl.DateTimeFormat("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  const wr = wb.addWorksheet("Rebote");
  wr.addRow([`REBOTE · cuando el precio TOCA el imán (≤${RB.touchWithinMin} min desde la lectura), ¿rebota X pts hacia donde venía o lo atraviesa X pts? (desenlace ≤${RB.afterMin} min). Cada toque cuenta una vez. Base = todos los strikes a ±${RB.baseRadius} pts.`]).font = { bold: true };
  wr.addRow([]);
  wr.addRow(["X (pts)", "Imán", "Toques", "Días", "Rebota %", "Base rebota %", "Ventaja rebote (pp)", "Atraviesa %", "Base atraviesa %", "Ventaja atraviesa (pp)", "Nada %"]).font = { bold: true };
  for (const s of bstats) {
    const r = wr.addRow([s.x, s.label, s.toques, s.days, s.rebotePct, s.baseRebotePct, s.ventajaRebote * 100, s.atraviesaPct, s.baseAtraviesaPct, s.ventajaAtraviesa * 100, s.nadaPct]);
    for (const c of [5, 6, 8, 9, 11]) r.getCell(c).numFmt = "0%";
    for (const c of [7, 10]) { r.getCell(c).numFmt = "0.0"; r.getCell(c).font = { bold: true, color: { argb: (r.getCell(c).value as number) >= 0 ? "FF067647" : "FFB42318" } }; }
    if (s.label.startsWith("PRUEBA")) r.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
    if (s.id === "base") r.font = { italic: true };
  }
  wr.columns.forEach((c, i) => { c.width = i === 1 ? 40 : 15; });

  const wt = wb.addWorksheet("Toques");
  wt.addRow(["Día", "Lectura NY", "Toque NY", "Imán", "Strike", "Venía de", "Distancia", "X", "Resultado"]).font = { bold: true };
  for (const b of bounces.filter((e) => e.id !== "base")) {
    wt.addRow([b.date, fmt.format(new Date(b.readT * 1000)), fmt.format(new Date(b.touchT * 1000)), P.MAGNET_LABELS[b.id] ?? b.id, b.strike, b.from, b.dist, b.x, b.outcome]);
  }
  wt.autoFilter = { from: "A1", to: "I1" };

  const wru = wb.addWorksheet("Ruptura");
  wru.addRow([`RUPTURA · en el toque se entra a favor del movimiento (sube hacia el strike → largo), stop ${RT.stopPts} pts, objetivo 5 o 10 pts, máx ${RT.afterMin} min. Stop y objetivo en la misma vela = stop. Flujo A FAVOR = Imán + tocado subiendo o Imán − tocado bajando.`]).font = { bold: true };
  wru.addRow([]);
  wru.addRow(["Objetivo (pts)", "Imán", "Flujo", "Operaciones", "Días", "Gana %", "Stop %", "Pts por op", "Pts total", "Base gana %", "Base pts por op", "Siguió de largo (mediana pts)"]).font = { bold: true };
  for (const s of rstats) {
    const r = wru.addRow([s.target, s.label, favLbl[s.favor] ?? "", s.n, s.days, s.winPct, s.stopPct, s.avgPts, s.totalPts, s.baseWinPct, s.baseAvgPts, s.mfeMedian]);
    for (const c of [6, 7, 10]) r.getCell(c).numFmt = "0%";
    for (const c of [8, 9, 11, 12]) r.getCell(c).numFmt = "0.00";
    r.getCell(8).font = { bold: true, color: { argb: s.avgPts > s.baseAvgPts ? "FF067647" : "FFB42318" } };
    if (s.label.startsWith("PRUEBA")) r.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
    if (s.id === "base") r.font = { italic: true };
  }
  wru.columns.forEach((c, i) => { c.width = i === 1 ? 40 : 15; });
  wru.autoFilter = { from: "A3", to: "L3" };

  const wd = wb.addWorksheet("Por día (30 min)");
  const ids = [...new Set(stats.map((s) => s.id))];
  wd.addRow(["Día", ...ids.map((id) => P.MAGNET_LABELS[id] ?? id)]).font = { bold: true };
  for (const d of days) {
    const row: (string | number)[] = [d];
    for (const id of ids) {
      const g = obs.filter((o) => o.date === d && o.id === id && o.horizon === 30);
      row.push(g.length ? g.filter((o) => o.hit).length / g.length : "-");
    }
    const r = wd.addRow(row);
    for (let c = 2; c <= ids.length + 1; c++) r.getCell(c).numFmt = "0%";
  }
  wd.columns.forEach((c, i) => { c.width = i === 0 ? 12 : 14; });

  const wl = wb.addWorksheet("Lecturas (30 min)");
  wl.addRow(["Día", "Hora NY", "Imán", "Strike", "Precio", "Distancia", "Llegó", "Espejo", "Más cerca (pts)"]).font = { bold: true };

  for (const o of obs.filter((x) => x.horizon === 30)) {
    wl.addRow([o.date, fmt.format(new Date(o.time * 1000)), P.MAGNET_LABELS[o.id] ?? o.id, o.strike, o.spot, o.dist, o.hit ? "Sí" : "No", o.mirrorHit ? "Sí" : "No", Number.isFinite(o.closest) ? o.closest : 0]);
  }
  wl.autoFilter = { from: "A1", to: "I1" };

  const deskDir = join(process.env.USERPROFILE ?? "C:\\Users\\carlo", "OneDrive", "Desktop", "VisionFutura Backtest");
  mkdirSync(deskDir, { recursive: true });
  const xlsx = join(deskDir, `Imanes Prueba - ${inst}.xlsx`);
  await wb.xlsx.writeFile(xlsx);
  console.log(`\nExcel: ${xlsx}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
