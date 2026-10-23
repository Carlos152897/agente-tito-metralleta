import { describe, expect, it } from "vitest";
import { btcMomentumSignal } from "./btcMomentum";
import type { ElliottWaveSignal } from "./btcElliottWave";
import type { Level, LevelsReport } from "./levels";
import type { TfBar } from "./types";

function risingBars(n: number, startPrice = 100, step = 1, volume = 100): TfBar[] {
  return Array.from({ length: n }, (_, i) => {
    const price = startPrice + step * i;
    return { time: i * 3600, open: price - step * 0.5, high: price + 0.5, low: price - step - 0.5, close: price, volume };
  });
}

function fallingBars(n: number, startPrice = 200, step = 1, volume = 100): TfBar[] {
  return risingBars(n, startPrice, -step, volume);
}

function elliott(bias: ElliottWaveSignal["bias"]): ElliottWaveSignal {
  return { waveLabel: "x", waveSequence: [], projection: [], bias, stopLoss: null, target: null, reason: "x", confidence: bias === "neutral" ? 0 : 0.6 };
}

function level(price: number, kind: Level["kind"]): Level {
  return {
    price,
    kind,
    strength: 50,
    distancePct: 1,
    sources: { touches: 1, lastTouch: null, openInterest: 0, notional: 0, flowPremium: 0, netGex: 0 },
    flipped: false,
    why: "test",
  };
}

const NEUTRAL_ELLIOTT = elliott("neutral");

describe("btcMomentumSignal", () => {
  it("cae a neutral con pocas velas", () => {
    const s = btcMomentumSignal(risingBars(10), null, NEUTRAL_ELLIOTT);
    expect(s.bias).toBe("neutral");
    expect(s.reason).toMatch(/no hay suficientes velas/i);
  });

  it("una tendencia alcista sostenida da bias long", () => {
    const s = btcMomentumSignal(risingBars(60), null, NEUTRAL_ELLIOTT);
    expect(s.bias).toBe("long");
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.stopLoss).toBeLessThan(s.target as number);
  });

  it("una tendencia bajista sostenida da bias short", () => {
    const s = btcMomentumSignal(fallingBars(60), null, NEUTRAL_ELLIOTT);
    expect(s.bias).toBe("short");
    expect(s.stopLoss).toBeGreaterThan(s.target as number);
  });

  it("sube la confianza cuando Elliott coincide con el bias de momentum", () => {
    const bars = risingBars(60);
    const withNeutral = btcMomentumSignal(bars, null, NEUTRAL_ELLIOTT);
    const withAgree = btcMomentumSignal(bars, null, elliott("long"));
    expect(withAgree.elliottAgreement).toBe("agrees");
    expect(withAgree.confidence).toBeGreaterThanOrEqual(withNeutral.confidence);
  });

  it("baja la confianza cuando Elliott contradice el bias de momentum", () => {
    const bars = risingBars(60);
    const withNeutral = btcMomentumSignal(bars, null, NEUTRAL_ELLIOTT);
    const withConflict = btcMomentumSignal(bars, null, elliott("short"));
    if (withConflict.bias !== "neutral") {
      expect(withConflict.elliottAgreement).toBe("conflicts");
      expect(withConflict.confidence).toBeLessThan(withNeutral.confidence);
    } else {
      expect(withConflict.reason).toMatch(/conflicto|débil/i);
    }
  });

  it("usa la zona de liquidez más cercana como target cuando está razonablemente cerca", () => {
    const bars = risingBars(60);
    const entry = bars[bars.length - 1].close;
    const levels: LevelsReport = {
      spot: entry,
      supports: [],
      resistances: [level(entry + 5, "resistencia")],
      keySupport: null,
      keyResistance: null,
      tolerancePct: 1,
    };
    const s = btcMomentumSignal(bars, levels, NEUTRAL_ELLIOTT);
    expect(s.bias).toBe("long");
    expect(s.target).toBe(entry + 5);
  });
});
