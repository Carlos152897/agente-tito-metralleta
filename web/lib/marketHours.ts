// Horario de mercado (NYSE/Nasdaq), lun-vie 9:30-16:00 ET. Sin calendario de
// feriados (limitación documentada, igual que el resto del repo — nada más
// acá maneja feriados tampoco).

const ET = "America/New_York";

function partsET(now: Date): { weekday: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { weekday, hour, minute };
}

/** ¿Está el mercado abierto ahora mismo? Lun-vie, 9:30-16:00 ET. */
export function isMarketOpen(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = partsET(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
}

/** Texto corto para mostrar en la UI. */
export function marketStatusLabel(now: Date = new Date()): string {
  return isMarketOpen(now) ? "Mercado abierto" : "Mercado cerrado";
}

/**
 * ¿Faltan `minutesBefore` minutos o menos para el cierre (16:00 ET)? Para el
 * Registro de Operaciones (lib/registroOperaciones.ts, "eod"): day-trading no
 * carga entradas de un día para otro, así que se fuerza el cierre antes de
 * que cierre el mercado en vez de dejar el contrato abierto de la noche a la
 * mañana.
 */
export function isMarketCloseNear(now: Date = new Date(), minutesBefore = 15): boolean {
  const { weekday, hour, minute } = partsET(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutesSinceMidnight = hour * 60 + minute;
  const closeMinutes = 16 * 60;
  return minutesSinceMidnight >= closeMinutes - minutesBefore && minutesSinceMidnight < closeMinutes;
}

/**
 * ¿Todavía dentro de los primeros `minutesAfter` minutos desde la apertura
 * (9:30 ET)? Pedido explícito de Carlos para "SPX vecinos" (2026-08-03): no
 * operar recién abierto — los primeros minutos suelen tener spot/flujo más
 * erráticos, antes de que el net premium real tenga tiempo de asentarse.
 * `false` con el mercado cerrado (antes de que abra no aplica "recién abrió").
 */
export function isWithinOpeningMinutes(now: Date = new Date(), minutesAfter = 15): boolean {
  const { weekday, hour, minute } = partsET(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutesSinceMidnight = hour * 60 + minute;
  const openMinutes = 9 * 60 + 30;
  return minutesSinceMidnight >= openMinutes && minutesSinceMidnight < openMinutes + minutesAfter;
}

/**
 * Minutos que faltan hasta el cierre (16:00 ET). Para greeks de un contrato
 * 0DTE (SPX amiga: charm/vanna, escenarios hasta el cierre) el tiempo a
 * vencimiento NUNCA puede ser "0 días" literal — dividiría por ~0 en las
 * fórmulas de Black-Scholes. 0 fuera de la sesión (fin de semana o fuera de
 * 9:30-16:00 ET) — el llamador debe gatear en `isMarketOpen` antes de usar
 * esto como T, no asumir que un 0 acá significa "casi cierra".
 */
export function minutesUntilClose(now: Date = new Date()): number {
  const { weekday, hour, minute } = partsET(now);
  if (weekday === "Sat" || weekday === "Sun") return 0;
  const minutesSinceMidnight = hour * 60 + minute;
  const closeMinutes = 16 * 60;
  return Math.max(0, closeMinutes - minutesSinceMidnight);
}
