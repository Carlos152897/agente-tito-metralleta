// Guardado diario de VisionFutura: la repetición de cada día
// (data/vision-futura/replay-{fecha}.json, la escribe visionFuturaReplay.ts)
// y su backtest (data/vision-futura/backtest/{fecha}.json), más el Excel con
// todos los días (hoja "Resumen" + una hoja por día). Pedido de Carlos (oct
// 2026): "que se quede guardado el botón de repetición y el backtesting de
// todas las entradas, en una hoja de Excel por día".

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import ExcelJS from "exceljs";
import type { BacktestDay } from "./visionFuturaBacktest";
import type { ReplayPayload } from "./visionFuturaReplay";
import { loadHistorial } from "./amigaStore";

const DIR = join(process.cwd(), "data", "vision-futura");
const BT_DIR = join(DIR, "backtest");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function saveBacktestDay(day: BacktestDay) {
  mkdirSync(BT_DIR, { recursive: true });
  writeFileSync(join(BT_DIR, `${day.date}.json`), JSON.stringify(day, null, 2), "utf8");
}

export function listBacktestDays(): BacktestDay[] {
  try {
    return readdirSync(BT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(BT_DIR, f), "utf8")) as BacktestDay)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/** Días con repetición guardada (más reciente primero). */
export function listReplayDays(): string[] {
  try {
    return readdirSync(DIR)
      .map((f) => /^replay-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
      .filter((d): d is string => !!d)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export function loadSavedReplay(date: string): ReplayPayload | null {
  if (!DATE_RE.test(date)) return null;
  try {
    return JSON.parse(readFileSync(join(DIR, `replay-${date}.json`), "utf8")) as ReplayPayload;
  } catch {
    return null;
  }
}

const hmNy = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const FONT = { name: "Arial", size: 10 };
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

  // ── Resumen ──
  const res = wb.addWorksheet("Resumen", { views: [{ state: "frozen", ySplit: 6 }] });
  res.getCell("A1").value = "VisionFutura — Backtest diario (SPX, alertas de pantalla)";
  res.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  res.getCell("A2").value = "$ por punto, 1 contrato /ES";
  res.getCell("B2").value = 50;
  res.getCell("A3").value = "$ por punto, 1 contrato /MES";
  res.getCell("B3").value = 5;
  for (const c of ["B2", "B3"]) res.getCell(c).font = INPUT_FONT;
  res.getCell("C2").value = "Multiplicador estándar del contrato de CME (editable).";
  res.getCell("C3").value = "Multiplicador estándar del contrato de CME (editable).";
  res.getCell("A4").value =
    "Precio cada 5 min (MarketSnack); si stop y objetivo caen en el mismo intervalo se cuenta el stop. Sin comisiones ni deslizamiento. Puntos del subyacente, no P&L de opciones.";
  res.getCell("A4").font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };

  const headers = ["Fecha", "Entradas", "Ganadas", "Perdidas", "% acierto", "Puntos SPX", "$ por 1 /ES", "$ por 1 /MES", "Mejor (pts)", "Peor (pts)",
    "Spreads", "Spreads ganados", "Spreads perdidos", "Resultado spreads ($)"];
  res.getRow(6).values = headers;
  res.getRow(6).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center" }; });

  days.forEach((d, i) => {
    const r = 7 + i;
    const n = d.trades.length;
    const sheetRef = `'${d.date}'`;
    const pts = n > 0 ? `${sheetRef}!P2:P${n + 1}` : null;
    const row = res.getRow(r);
    row.getCell(1).value = d.date;
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
      const usdRange = `'${d.date} spreads'!N2:N${sp.length + 1}`;
      const usd = sp.map((x) => Math.round((x.pnl ?? 0) * 100));
      row.getCell(11).value = { formula: `COUNT(${usdRange})`, result: sp.length };
      row.getCell(12).value = { formula: `COUNTIF(${usdRange},">0")`, result: usd.filter((v) => v > 0).length };
      row.getCell(13).value = { formula: `COUNTIF(${usdRange},"<0")`, result: usd.filter((v) => v < 0).length };
      row.getCell(14).value = { formula: `SUM(${usdRange})`, result: usd.reduce((a, b) => a + b, 0) };
    } else {
      for (const c of [11, 12, 13, 14]) row.getCell(c).value = 0;
    }
    row.getCell(7).value = { formula: `F${r}*$B$2`, result: d.points * 50 };
    row.getCell(8).value = { formula: `F${r}*$B$3`, result: d.points * 5 };
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
    tot.getCell(6).value = { formula: `SUM(F${first}:F${lastR})`, result: sum("F") };
    tot.getCell(7).value = { formula: `SUM(G${first}:G${lastR})`, result: sum("F") * 50 };
    tot.getCell(8).value = { formula: `SUM(H${first}:H${lastR})`, result: sum("F") * 5 };
    const spUsd = days.flatMap((d) => (d.spreads ?? []).map((x) => Math.round((x.pnl ?? 0) * 100)));
    tot.getCell(11).value = { formula: `SUM(K${first}:K${lastR})`, result: spUsd.length };
    tot.getCell(12).value = { formula: `SUM(L${first}:L${lastR})`, result: spUsd.filter((v) => v > 0).length };
    tot.getCell(13).value = { formula: `SUM(M${first}:M${lastR})`, result: spUsd.filter((v) => v < 0).length };
    tot.getCell(14).value = { formula: `SUM(N${first}:N${lastR})`, result: spUsd.reduce((a, b) => a + b, 0) };
    tot.font = { ...FONT, bold: true };
    tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
  }
  res.columns.forEach((c, i) => {
    c.width = [14, 10, 10, 10, 11, 12, 13, 13, 12, 12, 10, 14, 15, 19][i] ?? 12;
  });
  res.getColumn(5).numFmt = "0.0%";
  for (const c of [6, 9, 10]) res.getColumn(c).numFmt = PTS_FMT;
  for (const c of [7, 8, 14]) res.getColumn(c).numFmt = USD_FMT;
  res.eachRow((row, rn) => { if (rn > 1 && rn !== 6) row.eachCell((c) => { c.font = { ...FONT, ...(c.font ?? {}), name: "Arial" }; }); });
  res.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  for (const c of ["B2", "B3"]) res.getCell(c).font = INPUT_FONT;

  // ── Una hoja por día ──
  for (const d of days) {
    const ws = wb.addWorksheet(d.date, { views: [{ state: "frozen", ySplit: 1 }] });
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
      { header: "$ por 1 /ES", width: 12 },
      { header: "$ por 1 /MES", width: 12 },
      { header: "Detalle de condiciones", width: 90 },
      { header: "Nota GEX", width: 44 },
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
      row.getCell(17).value = { formula: `P${r}*Resumen!$B$2`, result: t.points * 50 };
      row.getCell(18).value = { formula: `P${r}*Resumen!$B$3`, result: t.points * 5 };
      row.getCell(19).value = t.conditions;
      row.getCell(20).value = t.regimeNote ?? "";
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
      tot.getCell(17).value = { formula: `SUM(Q2:Q${n + 1})`, result: d.points * 50 };
      tot.getCell(18).value = { formula: `SUM(R2:R${n + 1})`, result: d.points * 5 };
      tot.font = { ...FONT, bold: true };
      tot.eachCell((c) => { c.border = { top: { style: "thin" } }; });
    }
    for (const c of [5, 9, 10, 11, 12, 13]) ws.getColumn(c).numFmt = "#,##0.00";
    ws.getColumn(16).numFmt = PTS_FMT;
    for (const c of [17, 18]) ws.getColumn(c).numFmt = USD_FMT;
  }

  // ── Spreads por día ──
  for (const d of days) {
    const sp = d.spreads ?? [];
    if (sp.length === 0) continue;
    const ws = wb.addWorksheet(`${d.date} spreads`, { views: [{ state: "frozen", ySplit: 1 }] });
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
