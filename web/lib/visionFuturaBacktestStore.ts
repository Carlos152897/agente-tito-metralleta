// Guardado diario de VisionFutura: la repetición de cada día
// (data/vision-futura/replay-{fecha}.json, la escribe visionFuturaReplay.ts)
// y su backtest (data/vision-futura/backtest/{fecha}.json), más el Excel con
// todos los días (hoja "Resumen" + una hoja por día). Pedido de Carlos (oct
// 2026): "que se quede guardado el botón de repetición y el backtesting de
// todas las entradas, en una hoja de Excel por día".

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import { STOP_VARIANTS, summarizeStops, type BacktestDay } from "./visionFuturaBacktest";
import { replayFileName, type ReplayPayload } from "./visionFuturaReplay";
import { loadHistorial } from "./amigaStore";

const DIR = join(process.cwd(), "data", "vision-futura");
const BT_DIR = join(DIR, "backtest");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** SPX conserva el nombre original ({fecha}.json); el resto lleva prefijo ({inst}-{fecha}.json). */
const btFile = (day: { date: string; instrument?: string }) =>
  !day.instrument || day.instrument === "SPX" ? `${day.date}.json` : `${day.instrument}-${day.date}.json`;

/** Nombre de la hoja de Excel de un día: "2026-10-22" para SPX, "NQ 2026-10-22" para el resto. */
const sheetName = (d: { date: string; instrument?: string }) => (!d.instrument || d.instrument === "SPX" ? d.date : `${d.instrument} ${d.date}`);

export function saveBacktestDay(day: BacktestDay) {
  mkdirSync(BT_DIR, { recursive: true });
  // Rearmar la repetición no borra el bloque "En vivo" ya guardado (viene de otra fuente).
  if (!day.live) {
    const prev = loadBacktestDay(day.date, day.instrument);
    if (prev?.live) day = { ...day, live: prev.live };
  }
  writeFileSync(join(BT_DIR, btFile(day)), JSON.stringify(day, null, 2), "utf8");
}

export function loadBacktestDay(date: string, instrument?: string): BacktestDay | null {
  try {
    return JSON.parse(readFileSync(join(BT_DIR, btFile({ date, instrument })), "utf8")) as BacktestDay;
  } catch {
    return null;
  }
}

export function listBacktestDays(): BacktestDay[] {
  try {
    return readdirSync(BT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(BT_DIR, f), "utf8")) as BacktestDay)
      .map((d) => ({ ...d, instrument: d.instrument ?? "SPX" }))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.instrument ?? "").localeCompare(b.instrument ?? ""));
  } catch {
    return [];
  }
}

/** Días con repetición guardada de un instrumento (más reciente primero). */
export function listReplayDays(inst = "SPX"): string[] {
  const re = inst === "SPX" ? /^replay-(\d{4}-\d{2}-\d{2})\.json$/ : new RegExp(`^replay-${inst}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
  try {
    return readdirSync(DIR)
      .map((f) => re.exec(f)?.[1])
      .filter((d): d is string => !!d)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export function loadSavedReplay(date: string, inst = "SPX"): ReplayPayload | null {
  if (!DATE_RE.test(date) || !/^[A-Z]{2,5}$/.test(inst)) return null;
  try {
    return JSON.parse(readFileSync(join(DIR, replayFileName(inst, date)), "utf8")) as ReplayPayload;
  } catch {
    return null;
  }
}

const hmNy = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const FONT = { name: "Arial", size: 10 };

/** $ por punto de cada instrumento (fila de la tabla editable del Resumen). */
const MULTS = [
  { row: 2, inst: "SPX", big: 50, micro: 5, desc: "/ES $50 y /MES $5 por punto (CME)", bigLabel: "$ por 1 /ES", microLabel: "$ por 1 /MES" },
  { row: 3, inst: "NQ", big: 20, micro: 2, desc: "/NQ $20 y /MNQ $2 por punto (CME)", bigLabel: "$ por 1 /NQ", microLabel: "$ por 1 /MNQ" },
  { row: 4, inst: "TSLA", big: 100, micro: 10, desc: "100 y 10 acciones de TSLA ($ por $1 de movimiento)", bigLabel: "$ por 100 acciones", microLabel: "$ por 10 acciones" },
];
const multOf = (inst?: string) => MULTS.find((m) => m.inst === (inst ?? "SPX")) ?? MULTS[0];
const HEAD = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A68" } };
const INPUT_FONT = { name: "Arial", size: 10, color: { argb: "FF0000FF" } };
const PTS_FMT = '0.00;[Red]-0.00;"-"';
const USD_FMT = '$#,##0;[Red]-$#,##0;"-"';

/** Excel con todos los días guardados: "Resumen" + una hoja por día (fórmulas, con resultado ya calculado). */
export async function buildBacktestWorkbook(): Promise<Buffer> {
  const days = listBacktestDays();
  const wb = new ExcelJS.Workbook();
  wb.creator = "VisionFutura";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Resumen ──
  const res = wb.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 6 }] });
  res.getCell("A1").value = "VisionFutura — Backtest diario (SPX, NQ, TSLA · alertas de pantalla)";
  res.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  // Multiplicadores por instrumento ($ por punto), editables: cada fila usa el de su instrumento.
  for (const m of MULTS) {
    res.getCell(`A${m.row}`).value = m.inst;
    res.getCell(`B${m.row}`).value = m.big;
    res.getCell(`C${m.row}`).value = m.micro;
    res.getCell(`D${m.row}`).value = m.desc;
    for (const c of [`B${m.row}`, `C${m.row}`]) res.getCell(c).font = INPUT_FONT;
  }
  res.getCell("E2").value =
    "Precio cada 5 min (MarketSnack); si stop y objetivo caen en el mismo intervalo se cuenta el stop. Sin comisiones ni deslizamiento. Puntos del subyacente de cada instrumento (SPX, NDX o $ de TSLA), no P&L de opciones. Los puntos de instrumentos distintos no se suman: el total es en $.";
  res.getCell("E2").font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };

  const headers = ["Fecha", "Entradas", "Ganadas", "Perdidas", "% acierto", "Puntos (del instrumento)", "$ contrato grande", "$ contrato micro", "Mejor (pts)", "Peor (pts)",
    "Spreads", "Spreads ganados", "Spreads perdidos", "Resultado spreads ($)", "Instrumento", "Lottos", "Lottos ganados", "Resultado lottos ($)", "Señales del dinero", "Señales ganadas", "Puntos señales", "$ señales (contrato grande)"];
  res.getRow(6).values = headers;
  res.getRow(6).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center" }; });

  days.forEach((d, i) => {
    const r = 7 + i;
    const n = d.trades.length;
    const sheetRef = `'${sheetName(d)}'`;
    const pts = n > 0 ? `${sheetRef}!P2:P${n + 1}` : null;
    const row = res.getRow(r);
    row.getCell(1).value = d.instrument && d.instrument !== "SPX" ? `${d.date} · ${d.instrument}` : d.date;
    if (pts) {
      row.getCell(2).value = { formula: `COUNT(${pts})`, result: n };
      row.getCell(3).value = { formula: `COUNTIF(${pts},">0")`, result: d.wins };
      row.getCell(4).value = { formula: `COUNTIF(${pts},"<0")`, result: d.losses };
      row.getCell(6).value = { formula: `SUM(${pts})`, result: d.points };
      row.getCell(9).value = { formula: `MAX(${pts})`, result: Math.max(...d.trades.map((t) => t.points)) };
      row.getCell(10).value = { formula: `MIN(${pts})`, result: Math.min(...d.trades.map((t) => t.points)) };
    } else {
      for (const c of [2, 3, 4, 6, 9, 10]) row.getCell(c).value = 0;
    }
    row.getCell(5).value = { formula: `IF(B${r}>0,C${r}/B${r},0)`, result: n > 0 ? d.wins / n : 0 };
    const sp = d.spreads ?? [];
    if (sp.length > 0) {
      const usdRange = `'${sheetName(d)} spreads'!N2:N${sp.length + 1}`;
      const usd = sp.map((x) => Math.round((x.pnl ?? 0) * 100));
      row.getCell(11).value = { formula: `COUNT(${usdRange})`, result: sp.length };
      row.getCell(12).value = { formula: `COUNTIF(${usdRange},">0")`, result: usd.filter((v) => v > 0).length };
      row.getCell(13).value = { formula: `COUNTIF(${usdRange},"<0")`, result: usd.filter((v) => v < 0).length };
      row.getCell(14).value = { formula: `SUM(${usdRange})`, result: usd.reduce((a, b) => a + b, 0) };
    } else {
      for (const c of [11, 12, 13, 14]) row.getCell(c).value = 0;
    }
    const lt = d.lottos ?? [];
    if (lt.length > 0) {
      const rng = `'${sheetName(d)} lottos'!N2:N${lt.length + 1}`;
      row.getCell(16).value = { formula: `COUNT(${rng})`, result: lt.length };
      row.getCell(17).value = { formula: `COUNTIF(${rng},">0")`, result: lt.filter((x) => (x.pnlUsd ?? 0) > 0).length };
      row.getCell(18).value = { formula: `SUM(${rng})`, result: lt.reduce((a, x) => a + (x.pnlUsd ?? 0), 0) };
    } else {
      for (const c of [16, 17, 18]) row.getCell(c).value = 0;
    }
    const mt = d.money ?? [];
    if (mt.length > 0) {
      const rng = `'${sheetName(d)} dinero'!N2:N${mt.length + 1}`;
      row.getCell(19).value = { formula: `COUNT(${rng})`, result: mt.length };
      row.getCell(20).value = { formula: `COUNTIF(${rng},">0")`, result: mt.filter((x) => (x.points ?? 0) > 0).length };
      row.getCell(21).value = { formula: `SUM(${rng})`, result: mt.reduce((a, x) => a + (x.points ?? 0), 0) };
    } else {
      for (const c of [19, 20, 21]) row.getCell(c).value = 0;
    }
    row.getCell(22).value = { formula: `U${r}*INDEX($B$2:$B$4,MATCH(O${r},$A$2:$A$4,0))`, result: mt.reduce((a, x) => a + (x.points ?? 0), 0) * multOf(d.instrument).big };
    const m = multOf(d.instrument);
    row.getCell(15).value = m.inst;
    row.getCell(7).value = { formula: `F${r}*INDEX($B$2:$B$4,MATCH(O${r},$A$2:$A$4,0))`, result: d.points * m.big };
    row.getCell(8).value = { formula: `F${r}*INDEX($C$2:$C$4,MATCH(O${r},$A$2:$A$4,0))`, result: d.points * m.micro };
  });
  if (days.length > 0) {
    const first = 7, lastR = 6 + days.length, t = lastR + 1;
    const sum = (col: string) => days.reduce((s, d) => s + (col === "B" ? d.trades.length : col === "C" ? d.wins : col === "D" ? d.losses : d.points), 0);
    const tot = res.getRow(t);
    tot.getCell(1).value = "Total";
    tot.getCell(2).value = { formula: `SUM(B${first}:B${lastR})`, result: sum("B") };
    tot.getCell(3).value = { formula: `SUM(C${first}:C${lastR})`, result: sum("C") };
    tot.getCell(4).value = { formula: `SUM(D${first}:D${lastR})`, result: sum("D") };
    tot.getCell(5).value = { formula: `IF(B${t}>0,C${t}/B${t},0)`, result: sum("B") > 0 ? sum("C") / sum("B") : 0 };
    // Puntos de instrumentos distintos no se suman; los $ sí.
    tot.getCell(6).value = "—";
    tot.getCell(7).value = { formula: `SUM(G${first}:G${lastR})`, result: days.reduce((a, d) => a + d.points * multOf(d.instrument).big, 0) };
    tot.getCell(8).value = { formula: `SUM(H${first}:H${lastR})`, result: days.reduce((a, d) => a + d.points * multOf(d.instrument).micro, 0) };
    const spUsd = days.flatMap((d) => (d.spreads ?? []).map((x) => Math.round((x.pnl ?? 0) * 100)));
    tot.getCell(11).value = { formula: `SUM(K${first}:K${lastR})`, result: spUsd.length };
    tot.getCell(12).value = { formula: `SUM(L${first}:L${lastR})`, result: spUsd.filter((v) => v > 0).length };
    tot.getCell(13).value = { formula: `SUM(M${first}:M${lastR})`, result: spUsd.filter((v) => v < 0).length };
    tot.getCell(14).value = { formula: `SUM(N${first}:N${lastR})`, result: spUsd.reduce((a, b) => a + b, 0) };
    const lt = days.flatMap((d) => d.lottos ?? []);
    tot.getCell(16).value = { formula: `SUM(P${first}:P${lastR})`, result: lt.length };
    tot.getCell(17).value = { formula: `SUM(Q${first}:Q${lastR})`, result: lt.filter((x) => (x.pnlUsd ?? 0) > 0).length };
    tot.getCell(18).value = { formula: `SUM(R${first}:R${lastR})`, result: lt.reduce((a, x) => a + (x.pnlUsd ?? 0), 0) };
    const mt = days.flatMap((d) => d.money ?? []);
    tot.getCell(19).value = { formula: `SUM(S${first}:S${lastR})`, result: mt.length };
    tot.getCell(20).value = { formula: `SUM(T${first}:T${lastR})`, result: mt.filter((x) => (x.points ?? 0) > 0).length };
    tot.getCell(21).value = "—"; // puntos de instrumentos distintos no se suman
    tot.getCell(22).value = { formula: `SUM(V${first}:V${lastR})`, result: days.reduce((a, d) => a + (d.money ?? []).reduce((b, x) => b + (x.points ?? 0), 0) * multOf(d.instrument).big, 0) };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  }
  res.columns.forEach((c, i) => {
    c.width = [18, 10, 10, 10, 11, 14, 15, 15, 12, 12, 10, 14, 15, 19, 12, 9, 13, 17, 12, 12, 12, 16][i] ?? 12;
  });
  res.getColumn(5).numFmt = "0.0%";
  for (const c of [6, 9, 10]) res.getColumn(c).numFmt = PTS_FMT;
  for (const c of [7, 8, 14, 18, 22]) res.getColumn(c).numFmt = USD_FMT;
  res.getColumn(21).numFmt = PTS_FMT;
  res.eachRow((row, rn) => { if (rn > 1 && rn !== 6) row.eachCell((c) => { c.font = { ...FONT, ...(c.font ?? {}), name: "Arial" }; }); });
  res.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  for (const m of MULTS) for (const c of [`B${m.row}`, `C${m.row}`]) res.getCell(c).font = INPUT_FONT;

  // ── Una hoja por día ──
  for (const d of days) {
    const ws = wb.addWorksheet(sheetName(d), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Hora entrada (NY)", width: 12 },
      { header: "Alerta", width: 44 },
      { header: "Tipo", width: 15 },
      { header: "Lado", width: 8 },
      { header: "Nivel SPX", width: 10 },
      { header: "Fuentes del nivel", width: 30 },
      { header: "Condiciones", width: 11 },
      { header: "Trampa", width: 40 },
      { header: "Entrada SPX", width: 12 },
      { header: "Entrada SPY", width: 12 },
      { header: "Stop SPX", width: 11 },
      { header: "Objetivo SPX", width: 12 },
      { header: "Salida SPX", width: 11 },
      { header: "Hora salida (NY)", width: 12 },
      { header: "Resultado", width: 10 },
      { header: "Puntos", width: 9 },
      { header: multOf(d.instrument).bigLabel, width: 14 },
      { header: multOf(d.instrument).microLabel, width: 14 },
      { header: "Detalle de condiciones", width: 90 },
      { header: "Nota GEX", width: 44 },
      { header: "Stop ATR×1: distancia", width: 12 },
      { header: "Stop ATR×1: resultado", width: 12 },
      { header: "Stop ATR×1: puntos", width: 11 },
      { header: "Stop nivel+½ATR: distancia", width: 13 },
      { header: "Stop nivel+½ATR: resultado", width: 13 },
      { header: "Stop nivel+½ATR: puntos", width: 12 },
    ];
    ws.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    d.trades.forEach((t, i) => {
      const r = i + 2;
      const row = ws.getRow(r);
      row.values = [
        hmNy(t.entryAt), t.title, t.kind.replace("_", " "), t.side.toUpperCase(), t.level, t.sources, `${t.score}/5`,
        t.trap ?? "", t.entry, t.entrySpy ?? "", t.stop, t.target ?? "", t.exit, hmNy(t.exitAt), t.outcome,
      ];
      row.getCell(16).value = { formula: `IF(D${r}="CORTO",I${r}-M${r},M${r}-I${r})`, result: t.points };
      const m = multOf(d.instrument);
      row.getCell(17).value = { formula: `P${r}*Resumen!$B$${m.row}`, result: t.points * m.big };
      row.getCell(18).value = { formula: `P${r}*Resumen!$C$${m.row}`, result: t.points * m.micro };
      row.getCell(19).value = t.conditions;
      row.getCell(20).value = t.regimeNote ?? "";
      const va = t.stopVariants?.find((v) => v.id === "atr"), vn = t.stopVariants?.find((v) => v.id === "nivel");
      if (va) { row.getCell(21).value = va.risk; row.getCell(22).value = va.outcome; row.getCell(23).value = va.points; }
      if (vn) { row.getCell(24).value = vn.risk; row.getCell(25).value = vn.outcome; row.getCell(26).value = vn.points; }
      row.font = FONT;
      const color = t.points > 0 ? "FF0E9F5F" : t.points < 0 ? "FFD92D20" : "FF666666";
      row.getCell(15).font = { ...FONT, bold: true, color: { argb: color } };
    });
    const n = d.trades.length;
    if (n > 0) {
      const t = n + 2;
      const tot = ws.getRow(t);
      tot.getCell(1).value = "Total";
      tot.getCell(15).value = { formula: `COUNTIF(P2:P${n + 1},">0")&" G / "&COUNTIF(P2:P${n + 1},"<0")&" P"`, result: `${d.wins} G / ${d.losses} P` };
      tot.getCell(16).value = { formula: `SUM(P2:P${n + 1})`, result: d.points };
      tot.getCell(17).value = { formula: `SUM(Q2:Q${n + 1})`, result: d.points * multOf(d.instrument).big };
      tot.getCell(18).value = { formula: `SUM(R2:R${n + 1})`, result: d.points * multOf(d.instrument).micro };
      const sc = d.stopCompare ?? summarizeStops(d.trades);
      tot.getCell(23).value = { formula: `SUM(W2:W${n + 1})`, result: sc.find((r) => r.id === "atr")?.points ?? 0 };
      tot.getCell(26).value = { formula: `SUM(Z2:Z${n + 1})`, result: sc.find((r) => r.id === "nivel")?.points ?? 0 };
      tot.font = { ...FONT, bold: true };
      tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    }
    for (const c of [5, 9, 10, 11, 12, 13]) ws.getColumn(c).numFmt = "#,##0.00";
    ws.getColumn(16).numFmt = PTS_FMT;
    for (const c of [17, 18]) ws.getColumn(c).numFmt = USD_FMT;
    for (const c of [21, 24]) ws.getColumn(c).numFmt = "#,##0.00";
    for (const c of [23, 26]) ws.getColumn(c).numFmt = PTS_FMT;
  }

  // ── Comparación de stops (registro en paralelo; el motor sigue con el fijo) ──
  if (days.length > 0) {
    const ws = wb.addWorksheet("Comparación de stops", { views: [{ state: "frozen", ySplit: 2 }] });
    const top = ws.getRow(1);
    top.getCell(1).value = "Mismas entradas, 3 stops (objetivo a la misma distancia, 1:1). Puntos del instrumento. Fijo = el del motor; ATR×1 = promedio del |cambio| de 5 min de las 12 velas previas; Nivel + ½ ATR = stop detrás del nivel con colchón.";
    top.getCell(1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
    const head = ["Fecha", "Instrumento", "Entradas"];
    for (const v of STOP_VARIANTS) head.push(`${v.label}: G`, `${v.label}: P`, `${v.label}: puntos`, `${v.label}: stop prom.`);
    head.push("Mejor stop del día");
    ws.getRow(2).values = head;
    ws.getRow(2).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    ws.getRow(2).height = 30;
    days.forEach((d, i) => {
      const sc = d.stopCompare ?? summarizeStops(d.trades);
      const vals: (string | number)[] = [d.date, d.instrument ?? "SPX", d.trades.length];
      for (const v of STOP_VARIANTS) {
        const r = sc.find((x) => x.id === v.id);
        vals.push(r?.wins ?? 0, r?.losses ?? 0, r?.points ?? 0, r?.avgRisk ?? 0);
      }
      const best = sc.filter((r) => r.trades > 0).sort((a, b) => b.points - a.points)[0];
      vals.push(best ? best.label : "—");
      const row = ws.getRow(3 + i);
      row.values = vals;
      row.font = FONT;
    });
    // Totales por instrumento (los puntos de instrumentos distintos no se suman entre sí).
    const last = 2 + days.length;
    let r = last + 2;
    ws.getRow(r).getCell(1).value = "Total por instrumento";
    ws.getRow(r).font = { ...FONT, bold: true };
    for (const inst of [...new Set(days.map((d) => d.instrument ?? "SPX"))]) {
      r++;
      const row = ws.getRow(r);
      row.getCell(1).value = "Total";
      row.getCell(2).value = inst;
      const colL = (c: number) => String.fromCharCode(64 + c);
      for (let c = 3; c <= 3 + STOP_VARIANTS.length * 4; c++) {
        const L = colL(c);
        const isAvg = c > 3 && (c - 3) % 4 === 0;
        row.getCell(c).value = isAvg
          ? { formula: `IFERROR(AVERAGEIF($B$3:$B$${last},B${r},${L}3:${L}${last}),0)` }
          : { formula: `SUMIF($B$3:$B$${last},B${r},${L}3:${L}${last})` };
      }
      row.font = { ...FONT, bold: true };
    }
    ws.columns.forEach((c, i) => { c.width = i === 0 ? 12 : i === 1 ? 12 : i === 3 + STOP_VARIANTS.length * 4 ? 18 : 11; });
    STOP_VARIANTS.forEach((_, k) => {
      ws.getColumn(6 + k * 4).numFmt = PTS_FMT;
      ws.getColumn(7 + k * 4).numFmt = "#,##0.00";
    });
  }

  // ── Spreads por día ──
  for (const d of days) {
    const sp = d.spreads ?? [];
    if (sp.length === 0) continue;
    const ws = wb.addWorksheet(`${sheetName(d)} spreads`, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Hora (NY)", width: 9 },
      { header: "Alerta que lo ejecutó", width: 40 },
      { header: "Tipo", width: 11 },
      { header: "Spread", width: 26 },
      { header: "Patas (precio de ejecución)", width: 64 },
      { header: "Fuente del precio", width: 16 },
      { header: "Neto por acción (+cobra / −paga)", width: 16 },
      { header: "Ganancia máx ($)", width: 13 },
      { header: "Pérdida máx ($)", width: 13 },
      { header: "Prob. de ganar al abrir", width: 13 },
      { header: "SPX al abrir", width: 11 },
      { header: "SPX al vencimiento", width: 12 },
      { header: "Resultado por acción", width: 12 },
      { header: "Resultado ($)", width: 12 },
    ];
    ws.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    sp.forEach((x, i) => {
      const r = i + 2;
      const row = ws.getRow(r);
      row.values = [
        hmNy(x.openedAt), x.alertTitle, x.kind === "credito" ? "prima" : "direccional", x.title, x.legs, x.priceSource,
        x.netPrice, x.maxGainUsd, x.maxLossUsd, x.pop, x.spotAtOpen, x.settle ?? "", x.pnl ?? "",
      ];
      row.getCell(14).value = { formula: `M${r}*100`, result: Math.round((x.pnl ?? 0) * 100) };
      row.font = FONT;
      const color = (x.pnl ?? 0) > 0 ? "FF0E9F5F" : (x.pnl ?? 0) < 0 ? "FFD92D20" : "FF666666";
      row.getCell(14).font = { ...FONT, bold: true, color: { argb: color } };
    });
    const t = sp.length + 2;
    const tot = ws.getRow(t);
    tot.getCell(1).value = "Total";
    tot.getCell(13).value = { formula: `COUNTIF(N2:N${sp.length + 1},">0")&" G / "&COUNTIF(N2:N${sp.length + 1},"<0")&" P"`, result: `${sp.filter((x) => (x.pnl ?? 0) > 0).length} G / ${sp.filter((x) => (x.pnl ?? 0) < 0).length} P` };
    tot.getCell(14).value = { formula: `SUM(N2:N${sp.length + 1})`, result: sp.reduce((a, x) => a + Math.round((x.pnl ?? 0) * 100), 0) };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    ws.getRow(t + 2).getCell(1).value =
      "Resultado al vencimiento = neto cobrado/pagado + valor intrínseco de cada pata al cierre del SPX (SPXW 0DTE). Precio de cada pata = promedio real al que se llenó en MarketSnack en los últimos 15 min (si no hubo operaciones, teórico con el VIX). Sin comisiones.";
    ws.getRow(t + 2).getCell(1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
    for (const c of [7, 11, 12, 13]) ws.getColumn(c).numFmt = "#,##0.00";
    for (const c of [8, 9]) ws.getColumn(c).numFmt = "$#,##0";
    ws.getColumn(10).numFmt = "0.0%";
    ws.getColumn(14).numFmt = USD_FMT;
  }

  // ── Lottos al cierre por día ──
  for (const d of days) {
    const lt = d.lottos ?? [];
    if (lt.length === 0) continue;
    const ws = wb.addWorksheet(`${sheetName(d)} lottos`, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Lectura (NY)", width: 10 }, { header: "Tipo", width: 7 }, { header: "Strike", width: 9 }, { header: "Prima", width: 8 },
      { header: "Precio", width: 12 }, { header: "Objetivo", width: 22 }, { header: "Nivel objetivo", width: 11 }, { header: "Spot al comprar", width: 12 },
      { header: "Paga si llega (×)", width: 11 }, { header: "Mejor venta", width: 10 }, { header: "Hora mejor venta", width: 11 },
      { header: "Cierre", width: 10 }, { header: "Valor al cierre", width: 10 }, { header: "Resultado $ (1 contrato)", width: 13 }, { header: "Confirmaciones", width: 90 },
    ];
    ws.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    lt.forEach((t, i) => {
      const r = i + 2;
      const row = ws.getRow(r);
      row.values = [t.lectura, t.side.toUpperCase(), t.strike, t.price, t.priceReal ? "llenado real" : "estimado", t.target.label, t.target.spx, t.spotAtOpen,
        t.payoff ?? "", t.bestExit?.price ?? "", t.bestExit ? hmNy(t.bestExit.at) : "", t.settle ?? ""];
      row.getCell(13).value = { formula: `IF(B${r}="CALL",MAX(0,L${r}-C${r}),MAX(0,C${r}-L${r}))`, result: t.settle == null ? 0 : Math.max(0, t.side === "call" ? t.settle - t.strike : t.strike - t.settle) };
      row.getCell(14).value = { formula: `(M${r}-D${r})*100`, result: t.pnlUsd ?? 0 };
      row.getCell(15).value = t.conditions.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}: ${c.detail}`).join(" | ");
      row.font = FONT;
      row.getCell(14).font = { ...FONT, bold: true, color: { argb: (t.pnlUsd ?? 0) > 0 ? "FF0E9F5F" : "FFD92D20" } };
    });
    const n = lt.length, t = n + 2;
    const tot = ws.getRow(t);
    tot.getCell(1).value = "Total";
    tot.getCell(4).value = { formula: `SUM(D2:D${n + 1})*100`, result: Math.round(lt.reduce((a, x) => a + x.price, 0) * 100) };
    tot.getCell(14).value = { formula: `SUM(N2:N${n + 1})`, result: lt.reduce((a, x) => a + (x.pnlUsd ?? 0), 0) };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    ws.getRow(t + 2).getCell(1).value = "Total de la columna Prima = $ invertidos (×100). Regla: lib/visionFuturaLottos.ts (objetivo al alcance + 2 de 3: GEX negativo, momentum 15 min, flujo 15 min; prima $0.05–$1.00; paga ≥ 3× si llega). 1 contrato, al vencimiento.";
    ws.getRow(t + 2).getCell(1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
    for (const c of [4, 10, 13]) ws.getColumn(c).numFmt = "$0.00";
    for (const c of [7, 8, 12]) ws.getColumn(c).numFmt = "#,##0.00";
    ws.getColumn(14).numFmt = USD_FMT;
  }

  // ── Señales del dinero por día ──
  for (const d of days) {
    const mt = d.money ?? [];
    if (mt.length === 0) continue;
    const m = multOf(d.instrument);
    const ws = wb.addWorksheet(`${sheetName(d)} dinero`, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Hora (NY)", width: 9 }, { header: "Lado", width: 8 }, { header: "Entrada", width: 11 }, { header: "Objetivo", width: 11 },
      { header: "Nivel objetivo", width: 22 }, { header: "Stop", width: 11 }, { header: "Stop basado en", width: 24 }, { header: "Riesgo (pts)", width: 10 },
      { header: "Ganancia posible (pts)", width: 12 }, { header: "R:B", width: 7 }, { header: "Resultado", width: 10 }, { header: "Salida", width: 11 },
      { header: "Hora salida", width: 10 }, { header: "Puntos", width: 9 }, { header: m.bigLabel, width: 14 }, { header: m.microLabel, width: 14 }, { header: "Votos", width: 110 },
    ];
    ws.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    mt.forEach((t, i) => {
      const r = i + 2;
      const row = ws.getRow(r);
      row.values = [hmNy(t.openedAt), t.side.toUpperCase(), t.entry, t.target, t.targetLabel, t.stop, t.stopLabel, t.riskPts, t.rewardPts, t.rb, t.outcome ?? "", t.exit ?? "", t.exitAt ? hmNy(t.exitAt) : ""];
      row.getCell(14).value = { formula: `IF(B${r}="CORTO",C${r}-L${r},L${r}-C${r})`, result: t.points ?? 0 };
      row.getCell(15).value = { formula: `N${r}*Resumen!$B$${m.row}`, result: (t.points ?? 0) * m.big };
      row.getCell(16).value = { formula: `N${r}*Resumen!$C$${m.row}`, result: (t.points ?? 0) * m.micro };
      row.getCell(17).value = t.votes.map((v) => `${v.vote > 0 ? "↑" : v.vote < 0 ? "↓" : "·"} ${v.label}: ${v.detail}`).join(" | ");
      row.font = FONT;
      row.getCell(11).font = { ...FONT, bold: true, color: { argb: (t.points ?? 0) > 0 ? "FF0E9F5F" : "FFD92D20" } };
    });
    const n = mt.length, t = n + 2;
    const tot = ws.getRow(t);
    tot.getCell(1).value = "Total";
    tot.getCell(11).value = { formula: `COUNTIF(N2:N${n + 1},">0")&" G / "&COUNTIF(N2:N${n + 1},"<0")&" P"` };
    tot.getCell(14).value = { formula: `SUM(N2:N${n + 1})`, result: mt.reduce((a, x) => a + (x.points ?? 0), 0) };
    tot.getCell(15).value = { formula: `SUM(O2:O${n + 1})` };
    tot.getCell(16).value = { formula: `SUM(P2:P${n + 1})` };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    ws.getRow(t + 2).getCell(1).value = "Regla (lib/visionFuturaMoneyFlow.ts): dispara cuando el dinero nuevo de 15 min tiene dirección y al menos 2 de 3 (Magneto, apuestas del día, barra más grande) lo acompañan. Objetivo = nivel más cercano a ≥ 8 pts; stop detrás del nivel en contra + 2 pts (5–15 pts); R:B ≥ 1.2. Precio de 5 min, si stop y objetivo caen en el mismo intervalo cuenta el stop.";
    ws.getRow(t + 2).getCell(1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
    for (const c of [3, 4, 6, 12]) ws.getColumn(c).numFmt = "#,##0.00";
    ws.getColumn(14).numFmt = PTS_FMT;
    for (const c of [15, 16]) ws.getColumn(c).numFmt = USD_FMT;
  }

  // ── Verticales amiga (regla Sombra 1–5 DTE): historial acumulado ──
  const amiga = loadHistorial().jugadas.sort((a, b) => a.id.localeCompare(b.id));
  if (amiga.length > 0) {
    const ws = wb.addWorksheet("Verticales amiga", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Fecha", width: 11 }, { header: "Hora (ET)", width: 9 }, { header: "Plazo", width: 7 }, { header: "Vencimiento", width: 12 },
      { header: "Lado", width: 7 }, { header: "Corto", width: 9 }, { header: "Largo", width: 9 }, { header: "Ancho", width: 7 },
      { header: "Crédito", width: 9 }, { header: "SPX entrada", width: 11 }, { header: "IV entrada", width: 10 },
      { header: "Estado", width: 16 }, { header: "Cerrada el", width: 11 }, { header: "Resultado ($)", width: 13 }, { header: "Salida", width: 60 },
    ];
    ws.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
    amiga.forEach((j, i) => {
      const row = ws.getRow(i + 2);
      row.values = [j.fecha, j.hora, j.plazo, j.vencimiento, j.lado, j.corto, j.largo, j.ancho, j.credito, j.spotEntrada, j.ivEntrada,
        j.estado, j.cerradaEl ?? "", j.resultado ?? "", j.salida];
      row.font = FONT;
      if (j.resultado != null) row.getCell(14).font = { ...FONT, bold: true, color: { argb: j.resultado >= 0 ? "FF0E9F5F" : "FFD92D20" } };
    });
    const n = amiga.length, t = n + 2;
    const cal = amiga.filter((j) => j.resultado != null);
    const tot = ws.getRow(t);
    tot.getCell(1).value = "Total";
    tot.getCell(12).value = { formula: `COUNT(N2:N${n + 1})&" calificadas / "&COUNTIF(L2:L${n + 1},"abierta")&" abiertas"`, result: `${cal.length} calificadas / ${n - cal.length} abiertas` };
    tot.getCell(13).value = { formula: `COUNTIF(N2:N${n + 1},">0")&" G"`, result: `${cal.filter((j) => (j.resultado ?? 0) > 0).length} G` };
    tot.getCell(14).value = { formula: `SUM(N2:N${n + 1})`, result: cal.reduce((a, j) => a + (j.resultado ?? 0), 0) };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    ws.getRow(t + 2).getCell(1).value =
      "Regla Sombra 1–5 DTE (script de la amiga, traducido y verificado contra el original). Precios de entrada/salida = promedio real de llenados al bid/ask en MarketSnack (30 min previos). Las abiertas se califican en los días siguientes.";
    ws.getRow(t + 2).getCell(1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
    ws.getColumn(11).numFmt = "0.0%";
    ws.getColumn(14).numFmt = USD_FMT;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
