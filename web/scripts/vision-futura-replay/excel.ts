// Arma el Excel completo ahora (sin repetir el día). Uso (cwd = web): npx tsx scripts/vision-futura-replay/excel.ts
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { buildBacktestWorkbook } from "../../lib/visionFuturaBacktestStore";
(async () => {
  const desk = [join(homedir(), "OneDrive", "Desktop"), join(homedir(), "Desktop")].find((d) => existsSync(d)) ?? process.cwd();
  const dir = join(desk, "VisionFutura Backtest");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "VisionFutura Backtest - EN VIVO y todo.xlsx");
  writeFileSync(out, await buildBacktestWorkbook());
  console.log("OK", out);
})();
