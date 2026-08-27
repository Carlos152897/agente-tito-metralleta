// Diagnóstico temporal (se borra después) — ver si hay ALGUNA fuente con
// retención de varios días para el precio intradía de SPX (a diferencia de
// gex_stats_chart, que solo da el día más reciente).
import { readFileSync } from "fs";
import { join } from "path";
const WEB_DIR = process.cwd();
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
async function main() {
  const { fetchAssetPriceChart, fetchGexStats, fetchContractTradeSummary } = await import("../../lib/marketsnack");

  console.log("=== fetchAssetPriceChart('SPX') ===");
  const chart = await fetchAssetPriceChart("SPX");
  const chartDays = new Set(chart.map((p: any) => p.t.slice(0, 10)));
  console.log("puntos:", chart.length, "dias:", [...chartDays].sort());

  console.log("\n=== fetchGexStats('SPX', period=1d) ===");
  const gex = await fetchGexStats("SPX", { period: "1d" });
  const gexDays = new Set(gex.map((p: any) => p.t.slice(0, 10)));
  console.log("puntos:", gex.length, "dias:", [...gexDays].sort());

  console.log("\n=== trade_summaries para simbolos SPXW sinteticos de la semana pasada (period=1w) ===");
  const symbols = [
    "SPXW260821C07600000",
    "SPXW260820C07600000",
    "SPXW260819C07600000",
  ];
  for (const sym of symbols) {
    try {
      const buckets = await fetchContractTradeSummary(sym, { period: "1w" });
      const days = new Set(buckets.map((b: any) => b.t.slice(0, 10)));
      console.log(sym, "-> buckets:", buckets.length, "dias:", [...days].sort());
    } catch (err: any) {
      console.log(sym, "-> ERROR:", err?.message ?? err);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
