// Entradas EN VIVO en el Excel del backtest (Carlos, 3-nov-2026: "guárdame siempre las entradas en
// vivo en la hoja de Excel y me haces al final el backtesting de las entradas, de cuántas ganaron y
// perdieron de cada motor").
//
// Lee el bloque `live` (alertas, señal del dinero, lottos) y `hybrid.live` de cada día guardado; ya
// vienen calificados con velas reales de 1 min (lib/visionFuturaLive.ts, lib/visionFuturaHybridStore.ts).
//   - "En vivo · entradas": una fila por entrada en vivo, de todos los días e instrumentos.
//   - "En vivo · resultado": ganadas / perdidas / % / puntos / $ por motor (total, por instrumento y por día),
//     con fórmulas COUNTIFS/SUMIFS sobre la hoja de entradas.

import type ExcelJS from "exceljs";
import type { BacktestDay } from "./visionFuturaBacktest";

export const LIVE_MOTORS = ["Alertas", "Señal del dinero", "Híbrido", "Lottos"] as const;
export type LiveMotor = (typeof LIVE_MOTORS)[number];

export interface LiveEntry {
  date: string;
  instrument: string;
  motor: LiveMotor;
  at: number;
  side: string;
  title: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  exit: number | null;
  exitAt: number | null;
  /** objetivo / stop / cierre / abierta (lottos: vencimiento). */
  outcome: string;
  /** Puntos del subyacente (null en lottos). */
  points: number | null;
  /** Lottos: $ por contrato con la regla de salida. */
  usd: number | null;
  detail: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Todas las entradas en vivo guardadas, en orden de día, instrumento y hora. Puro. */
export function liveEntries(days: BacktestDay[]): LiveEntry[] {
  const out: LiveEntry[] = [];
  for (const d of days) {
    const inst = d.instrument ?? "SPX";
    const live = d.live;
    for (const t of live?.trades ?? []) {
      out.push({ date: d.date, instrument: inst, motor: "Alertas", at: t.entryAt, side: t.side, title: t.title, entry: t.entry, stop: t.stop, target: t.target,
        exit: t.exit, exitAt: t.exitAt, outcome: t.outcome, points: t.points, usd: null, detail: `nivel ${t.level} · ${t.sources}` });
    }
    for (const m of live?.money ?? []) {
      out.push({ date: d.date, instrument: inst, motor: "Señal del dinero", at: m.openedAt, side: m.side, title: `${m.direction} → ${m.targetLabel}`, entry: m.entry, stop: m.stop,
        target: m.target, exit: m.exit, exitAt: m.exitAt, outcome: m.outcome ?? "abierta", points: m.points, usd: null, detail: `stop: ${m.stopLabel} · R:B ${m.rb}` });
    }
    const hy = d.hybrid?.live;
    for (const h of [...(hy?.alerts ?? []), ...(hy?.money ?? [])]) {
      out.push({ date: d.date, instrument: inst, motor: "Híbrido", at: h.at, side: h.side, title: h.title, entry: h.entry, stop: h.stop, target: h.target,
        exit: h.exit, exitAt: h.exitAt, outcome: h.outcome ?? "abierta", points: h.points, usd: null, detail: `${h.source === "alerta" ? "de alerta" : "de señal"}${h.note ? ` · ${h.note}` : ""}` });
    }
    for (const l of live?.lottos ?? []) {
      out.push({ date: d.date, instrument: inst, motor: "Lottos", at: l.openedAt, side: l.side, title: `${l.side.toUpperCase()} ${l.strike} a $${l.price}`, entry: l.price, stop: null,
        target: l.target?.spx ?? null, exit: l.settle, exitAt: null, outcome: l.pnlUsd == null ? "abierta" : "vencimiento", points: null,
        usd: l.pnlUsd == null ? null : r2(l.pnlUsd), detail: `${l.lectura} · objetivo ${l.target?.label ?? ""}` });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.instrument.localeCompare(b.instrument) || a.at - b.at);
}

/** Resultado de una entrada: >0 ganó, <0 perdió, 0 empate, null abierta. */
export const entryResult = (e: LiveEntry) => (e.motor === "Lottos" ? e.usd : e.points);

export interface MotorStats { entries: number; wins: number; losses: number; open: number; points: number; usd: number }

/** Totales por motor (y opcionalmente por instrumento/día). `usdPerPoint` = $ por punto del contrato grande. Puro. */
export function motorStats(entries: LiveEntry[], usdPerPoint: (inst: string) => number): MotorStats {
  const s: MotorStats = { entries: entries.length, wins: 0, losses: 0, open: 0, points: 0, usd: 0 };
  for (const e of entries) {
    const r = entryResult(e);
    if (r == null) { s.open++; continue; }
    if (r > 0) s.wins++;
    else if (r < 0) s.losses++;
    if (e.motor === "Lottos") s.usd += r;
    else { s.points += r; s.usd += r * usdPerPoint(e.instrument); }
  }
  s.points = r2(s.points);
  s.usd = r2(s.usd);
  return s;
}

const FONT = { name: "Arial", size: 10 };
const HEAD = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F5132" } };
const PTS_FMT = '0.00;[Red]-0.00;"-"';
const USD_FMT = '$#,##0;[Red]-$#,##0;"-"';
const NOTE = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };

const hmNy = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-MX", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Agrega "En vivo · resultado" y "En vivo · entradas" al libro. `multRow(inst)` = fila del Resumen con
 * el $ por punto del contrato grande (columna B), `big(inst)` = ese valor (para el resultado calculado).
 */
export function addLiveSheets(wb: ExcelJS.Workbook, days: BacktestDay[], multRow: (inst: string) => number, big: (inst: string) => number) {
  const all = liveEntries(days);
  if (all.length === 0) return;
  const E = "'En vivo · entradas'";

  // ── Resultado (va primero para que se vea al abrir) ──
  const rs = wb.addWorksheet("En vivo · resultado", { views: [{ state: "frozen", ySplit: 3 }] });
  // ── Entradas ──
  const es = wb.addWorksheet("En vivo · entradas", { views: [{ state: "frozen", ySplit: 1 }] });
  es.columns = [
    { header: "Fecha", width: 11 }, { header: "Instrumento", width: 11 }, { header: "Motor", width: 16 }, { header: "Hora (NY)", width: 9 },
    { header: "Lado", width: 8 }, { header: "Entrada", width: 26 }, { header: "Precio entrada", width: 12 }, { header: "Stop", width: 11 },
    { header: "Objetivo", width: 11 }, { header: "Salida", width: 11 }, { header: "Hora salida", width: 10 }, { header: "Resultado", width: 11 },
    { header: "Puntos", width: 9 }, { header: "$ contrato grande", width: 15 }, { header: "Ganó/Perdió", width: 11 }, { header: "Detalle", width: 70 },
  ];
  es.getRow(1).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
  all.forEach((e, i) => {
    const r = i + 2;
    const row = es.getRow(r);
    row.values = [e.date, e.instrument, e.motor, hmNy(e.at), e.side.toUpperCase(), e.title, e.entry ?? "", e.stop ?? "", e.target ?? "",
      e.exit ?? "", e.exitAt ? hmNy(e.exitAt) : "", e.outcome];
    const res = entryResult(e);
    if (e.motor === "Lottos") {
      row.getCell(13).value = "";
      row.getCell(14).value = res == null ? "" : res;
    } else if (res != null) {
      row.getCell(13).value = res;
      row.getCell(14).value = { formula: `M${r}*Resumen!$B$${multRow(e.instrument)}`, result: r2(res * big(e.instrument)) };
    }
    const wl = res == null ? "abierta" : res > 0 ? "GANÓ" : res < 0 ? "PERDIÓ" : "empate";
    row.getCell(15).value = { formula: `IF(N${r}="","abierta",IF(N${r}>0,"GANÓ",IF(N${r}<0,"PERDIÓ","empate")))`, result: wl };
    row.getCell(16).value = e.detail;
    row.font = FONT;
    if (res != null) row.getCell(15).font = { ...FONT, bold: true, color: { argb: res > 0 ? "FF0E9F5F" : res < 0 ? "FFD92D20" : "FF666666" } };
  });
  const last = all.length + 1;
  es.autoFilter = { from: "A1", to: `P${last}` };
  for (const c of [7, 8, 9, 10]) es.getColumn(c).numFmt = "#,##0.00";
  es.getColumn(13).numFmt = PTS_FMT;
  es.getColumn(14).numFmt = USD_FMT;

  // Rangos de la hoja de entradas para las fórmulas.
  const col = (c: string) => `${E}!$${c}$2:$${c}$${last}`;
  const [A, B, C, N, O] = [col("A"), col("B"), col("C"), col("N"), col("O")];

  rs.getCell("A1").value = "VisionFutura — Backtest de las entradas EN VIVO por motor";
  rs.getCell("A1").font = { name: "Arial", size: 14, bold: true };
  rs.getCell("A2").value =
    "Lo que de verdad salió en pantalla con la vigilancia encendida, calificado con velas reales de 1 min (si en la misma vela caben stop y objetivo, cuenta el stop; si no toca ninguno, sale al cierre). $ = contrato grande (/ES, /NQ o 100 acciones; editable en el Resumen, filas 2–6). Lottos = $ por contrato con la regla 1.5×/3×. El Híbrido repite entradas de Alertas y Señal filtradas: no lo sumes con ellas.";
  rs.getCell("A2").font = NOTE;
  rs.getCell("A2").alignment = { wrapText: true, vertical: "top" };
  rs.mergeCells("A2:J2");
  rs.getRow(2).height = 42;

  const heads = ["Motor", "Instrumento", "Entradas", "Ganadas", "Perdidas", "Abiertas", "% acierto", "Puntos", "$ contrato grande", "$ por entrada"];
  const head = (r: number) => {
    rs.getRow(r).values = heads;
    rs.getRow(r).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
  };
  const bigOf = (inst: string) => big(inst);
  /** Fila de estadísticas; `crit` = criterios COUNTIFS extra (rango, valor). */
  const statRow = (r: number, motor: string, inst: string, crit: [string, string][], subset: LiveEntry[], bold = false) => {
    const st = motorStats(subset, bigOf);
    const cr = [[C, `"${motor}"`], ...crit].map(([rg, v]) => `${rg},${v}`).join(",");
    const row = rs.getRow(r);
    row.getCell(1).value = motor;
    row.getCell(2).value = inst;
    row.getCell(3).value = { formula: `COUNTIFS(${cr})`, result: st.entries };
    row.getCell(4).value = { formula: `COUNTIFS(${cr},${O},"GANÓ")`, result: st.wins };
    row.getCell(5).value = { formula: `COUNTIFS(${cr},${O},"PERDIÓ")`, result: st.losses };
    row.getCell(6).value = { formula: `COUNTIFS(${cr},${O},"abierta")`, result: st.open };
    const dec = st.wins + st.losses;
    row.getCell(7).value = { formula: `IF(D${r}+E${r}=0,"",D${r}/(D${r}+E${r}))`, result: dec ? st.wins / dec : "" };
    if (motor === "Lottos" || inst === "Todos") row.getCell(8).value = "—"; // puntos de instrumentos distintos no se suman
    else row.getCell(8).value = { formula: `SUMIFS(${col("M")},${cr})`, result: st.points };
    row.getCell(9).value = { formula: `SUMIFS(${N},${cr})`, result: st.usd };
    const closed = st.entries - st.open;
    row.getCell(10).value = { formula: `IF(C${r}-F${r}=0,"",I${r}/(C${r}-F${r}))`, result: closed ? r2(st.usd / closed) : "" };
    row.font = { ...FONT, bold };
    if (dec) row.getCell(9).font = { ...FONT, bold: true, color: { argb: st.usd >= 0 ? "FF0E9F5F" : "FFD92D20" } };
  };

  let r = 4;
  rs.getCell(`A${r}`).value = "1) Total por motor (todos los días e instrumentos)";
  rs.getCell(`A${r}`).font = { name: "Arial", size: 12, bold: true };
  r++;
  head(r); r++;
  for (const m of LIVE_MOTORS) {
    const sub = all.filter((e) => e.motor === m);
    if (sub.length === 0) continue;
    statRow(r, m, "Todos", [], sub, true);
    r++;
  }

  r += 1;
  rs.getCell(`A${r}`).value = "2) Por motor e instrumento";
  rs.getCell(`A${r}`).font = { name: "Arial", size: 12, bold: true };
  r++;
  head(r); r++;
  const insts = [...new Set(all.map((e) => e.instrument))];
  for (const m of LIVE_MOTORS) {
    for (const inst of insts) {
      const sub = all.filter((e) => e.motor === m && e.instrument === inst);
      if (sub.length === 0) continue;
      statRow(r, m, inst, [[B, `"${inst}"`]], sub);
      r++;
    }
  }

  r += 1;
  const sec3 = r;
  rs.getCell(`A${r}`).value = "3) Por día (cada motor)";
  rs.getCell(`A${r}`).font = { name: "Arial", size: 12, bold: true };
  r++;
  rs.getRow(r).values = ["Fecha", "Instrumento", "Min vigilados", ...LIVE_MOTORS.flatMap((m) => [`${m} G`, `${m} P`, `${m} $`])];
  rs.getRow(r).eachCell((c) => { c.font = HEAD; c.fill = HEAD_FILL; c.alignment = { horizontal: "center", wrapText: true }; });
  rs.getRow(r).height = 30;
  r++;
  for (const d of days) {
    const inst = d.instrument ?? "SPX";
    const dayEntries = all.filter((e) => e.date === d.date && e.instrument === inst);
    if (!d.live && !d.hybrid?.live) continue;
    const row = rs.getRow(r);
    row.getCell(1).value = d.date;
    row.getCell(2).value = inst;
    row.getCell(3).value = d.live?.coverage.minutesWatched ?? "";
    LIVE_MOTORS.forEach((m, k) => {
      const st = motorStats(dayEntries.filter((e) => e.motor === m), bigOf);
      const cr = `${A},"${d.date}",${B},"${inst}",${C},"${m}"`;
      row.getCell(4 + k * 3).value = { formula: `COUNTIFS(${cr},${O},"GANÓ")`, result: st.wins };
      row.getCell(5 + k * 3).value = { formula: `COUNTIFS(${cr},${O},"PERDIÓ")`, result: st.losses };
      row.getCell(6 + k * 3).value = { formula: `SUMIFS(${N},${cr})`, result: st.usd };
      row.getCell(6 + k * 3).numFmt = USD_FMT;
    });
    row.eachCell((c) => { c.font = FONT; });
    r++;
  }
  const perDayStart = r; // las filas por día ya tienen su formato
  rs.getRow(r + 1).getCell(1).value = "Min vigilados: minutos de la sesión (de 390) con la vigilancia en vivo corriendo. Con pocos minutos el día cuenta poco.";
  rs.getRow(r + 1).getCell(1).font = NOTE;

  rs.columns.forEach((c, i) => { c.width = [17, 11, 10, 10, 10, 10, 10, 10, 15, 13][i] ?? 11; });
  for (let rr = 4; rr < perDayStart && rr < sec3; rr++) {
    const v = rs.getRow(rr).getCell(7);
    if (typeof v.value === "object" && v.value && "formula" in v.value) v.numFmt = "0.0%";
    const p = rs.getRow(rr).getCell(8);
    if (typeof p.value === "object" && p.value && "formula" in p.value) p.numFmt = PTS_FMT;
    for (const c of [9, 10]) {
      const x = rs.getRow(rr).getCell(c);
      if (typeof x.value === "object" && x.value && "formula" in x.value) x.numFmt = USD_FMT;
    }
  }
}
