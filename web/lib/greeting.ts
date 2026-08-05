// Saludo de la portada según la hora del día. Sin nombre de persona a propósito
// (pedido explícito) — en inglés porque la marca "Visionary Trades" también lo es.

export function timeGreeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning!";
  if (h < 18) return "Good afternoon!";
  return "Good evening!";
}
