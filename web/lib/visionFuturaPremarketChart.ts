// Gráfica del pre-mercado de VisionFutura (Carlos, 27-oct-2026: "durante el pre market debería
// empezar a crear una nueva gráfica e ir marcando los puntos importantes del activo").
//
// PURO (sin red ni disco). Entra: velas de 1 min de la noche (futuro /ES o /NQ ya pasado a precio
// del índice; TSLA = la acción en pre-market). Sale lo que la gráfica marca:
//   - máximo y mínimo de la noche (con la hora en que se hicieron),
//   - perfil de volumen por precio: POC (precio con más contratos), área de valor (70%) y
//     nodos de volumen alto,
//   - velas con agresor fuerte (compras al ask / ventas al bid muy desbalanceadas) y las
//     zonas de precio donde se acumuló ese agresor.

export interface PmCandle {
  /** Segundos. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  bidVolume?: number;
  askVolume?: number;
}

export interface PmExtreme { price: number; time: number }

export interface PmProfileRow { price: number; volume: number }

export interface PmAggressor {
  time: number;
  /** Precio de la vela (cierre). */
  price: number;
  high: number;
  low: number;
  side: "compra" | "venta";
  /** Compras al ask − ventas al bid (contratos o acciones). */
  delta: number;
  volume: number;
}

export interface PmAggZone {
  /** Centro del escalón de precio. */
  price: number;
  side: "compra" | "venta";
  delta: number;
}

export interface PmAnalysis {
  bucket: number;
  nightHigh: PmExtreme | null;
  nightLow: PmExtreme | null;
  /** Primer y último precio de la noche. */
  first: number | null;
  last: number | null;
  profile: PmProfileRow[];
  poc: number | null;
  valueArea: { low: number; high: number } | null;
  /** Nodos de volumen alto (picos locales del perfil, sin el POC). */
  hvn: number[];
  aggressors: PmAggressor[];
  aggZones: PmAggZone[];
  /** Hay datos de bid/ask para el agresor. */
  hasFlow: boolean;
  totalVolume: number;
}

export const PM_CHART_TUNING = {
  /** Escalones del perfil: ~45 en todo el rango de la noche. */
  profileRows: 45,
  /** Área de valor = 70% del volumen alrededor del POC. */
  valueAreaShare: 0.7,
  /** Nodos de volumen alto: picos ≥ 60% del POC, máx 3. */
  hvnShare: 0.6,
  maxHvn: 3,
  /** Agresor fuerte: |delta| ≥ media + 2.5 desv. del |delta| de la noche, desbalance ≥ 30%, y mínimo absoluto. */
  aggSigma: 2.5,
  aggImbalance: 0.3,
  aggMin: 20,
  maxAggressors: 10,
  /** Zonas de agresor: los 2 escalones con más delta neto de cada lado. */
  zonesPerSide: 2,
};

/** Escalón "bonito" (1, 2, 2.5, 5 × 10^n) cercano a `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

/** Junta velas de 1 min en velas de `minutes` (alineadas al reloj). */
export function aggregateCandles(c: PmCandle[], minutes: number): PmCandle[] {
  if (minutes <= 1) return c;
  const sec = minutes * 60;
  const out: PmCandle[] = [];
  for (const b of c) {
    const t = Math.floor(b.time / sec) * sec;
    const cur = out[out.length - 1];
    if (cur && cur.time === t) {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = add(cur.volume, b.volume);
      cur.bidVolume = add(cur.bidVolume, b.bidVolume);
      cur.askVolume = add(cur.askVolume, b.askVolume);
    } else {
      out.push({ ...b, time: t });
    }
  }
  return out;
}
const add = (a?: number, b?: number) => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0));

export function analyzePremarket(candlesIn: PmCandle[], tuning = PM_CHART_TUNING): PmAnalysis {
  const candles = [...candlesIn].filter((b) => [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0)).sort((a, b) => a.time - b.time);
  const empty: PmAnalysis = {
    bucket: 1, nightHigh: null, nightLow: null, first: null, last: null, profile: [], poc: null,
    valueArea: null, hvn: [], aggressors: [], aggZones: [], hasFlow: false, totalVolume: 0,
  };
  if (candles.length === 0) return empty;

  // ── Máximo / mínimo de la noche ──
  let hi = candles[0], lo = candles[0];
  for (const b of candles) {
    if (b.high > hi.high) hi = b;
    if (b.low < lo.low) lo = b;
  }
  const range = hi.high - lo.low;
  const bucket = niceStep(range > 0 ? range / tuning.profileRows : candles[0].close * 0.0005);

  // ── Perfil de volumen: el volumen de cada vela se reparte parejo en los escalones que tocó ──
  const vol = new Map<number, number>();
  const key = (p: number) => Math.round(Math.floor(p / bucket) * bucket * 1e6) / 1e6;
  let totalVolume = 0;
  for (const b of candles) {
    const v = b.volume ?? 0;
    if (!(v > 0)) continue;
    totalVolume += v;
    const k0 = key(b.low), k1 = key(b.high);
    const n = Math.round((k1 - k0) / bucket) + 1;
    for (let i = 0; i < n; i++) {
      const k = Math.round((k0 + i * bucket) * 1e6) / 1e6;
      vol.set(k, (vol.get(k) ?? 0) + v / n);
    }
  }
  const profile = [...vol.entries()].map(([k, v]) => ({ price: k + bucket / 2, volume: v })).sort((a, b) => a.price - b.price);

  let poc: number | null = null;
  let valueArea: PmAnalysis["valueArea"] = null;
  const hvn: number[] = [];
  if (profile.length > 0 && totalVolume > 0) {
    let iPoc = 0;
    profile.forEach((r, i) => { if (r.volume > profile[iPoc].volume) iPoc = i; });
    poc = profile[iPoc].price;
    // Área de valor: se expande desde el POC hacia el lado con más volumen hasta juntar el 70%.
    let a = iPoc, z = iPoc, acc = profile[iPoc].volume;
    const goal = totalVolume * tuning.valueAreaShare;
    while (acc < goal && (a > 0 || z < profile.length - 1)) {
      const up = z < profile.length - 1 ? profile[z + 1].volume : -1;
      const dn = a > 0 ? profile[a - 1].volume : -1;
      if (up >= dn) { z++; acc += up; } else { a--; acc += dn; }
    }
    valueArea = { low: profile[a].price - bucket / 2, high: profile[z].price + bucket / 2 };
    // Nodos altos: picos locales (más que sus 2 vecinos de cada lado), lejos del POC.
    const peaks = profile
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => i !== iPoc && r.volume >= profile[iPoc].volume * tuning.hvnShare
        && [-2, -1, 1, 2].every((d) => !profile[i + d] || profile[i + d].volume <= r.volume)
        && Math.abs(i - iPoc) > 2)
      .sort((x, y) => y.r.volume - x.r.volume);
    for (const { r, i } of peaks) {
      if (hvn.length >= tuning.maxHvn) break;
      if (hvn.every((p) => Math.abs(p - r.price) > bucket * 2.5)) hvn.push(r.price);
      void i;
    }
  }

  // ── Agresor ──
  const withFlow = candles.filter((b) => b.askVolume != null && b.bidVolume != null && (b.askVolume + b.bidVolume) > 0);
  const hasFlow = withFlow.length >= Math.min(10, candles.length);
  let aggressors: PmAggressor[] = [];
  const aggZones: PmAggZone[] = [];
  if (hasFlow) {
    const deltas = withFlow.map((b) => Math.abs((b.askVolume ?? 0) - (b.bidVolume ?? 0)));
    const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length);
    const thr = Math.max(tuning.aggMin, mean + tuning.aggSigma * sd);
    aggressors = withFlow
      .map((b) => {
        const delta = (b.askVolume ?? 0) - (b.bidVolume ?? 0);
        const v = (b.askVolume ?? 0) + (b.bidVolume ?? 0);
        return { b, delta, v };
      })
      .filter(({ delta, v }) => Math.abs(delta) >= thr && Math.abs(delta) / v >= tuning.aggImbalance)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, tuning.maxAggressors)
      .map(({ b, delta, v }) => ({
        time: b.time, price: b.close, high: b.high, low: b.low,
        side: delta > 0 ? "compra" as const : "venta" as const, delta, volume: b.volume ?? v,
      }))
      .sort((x, y) => x.time - y.time);

    // Zonas: delta neto acumulado por escalón de precio (precio típico de la vela).
    const net = new Map<number, number>();
    for (const b of withFlow) {
      const k = key((b.high + b.low + b.close) / 3);
      net.set(k, (net.get(k) ?? 0) + (b.askVolume ?? 0) - (b.bidVolume ?? 0));
    }
    const rows = [...net.entries()].map(([k, d]) => ({ price: k + bucket / 2, delta: d }));
    const pick = (side: "compra" | "venta") => rows
      .filter((r) => (side === "compra" ? r.delta > 0 : r.delta < 0) && Math.abs(r.delta) >= thr)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, tuning.zonesPerSide)
      .map((r) => ({ price: r.price, side, delta: r.delta }));
    aggZones.push(...pick("compra"), ...pick("venta"));
  }

  return {
    bucket,
    nightHigh: { price: hi.high, time: hi.time },
    nightLow: { price: lo.low, time: lo.time },
    first: candles[0].open,
    last: candles[candles.length - 1].close,
    profile, poc, valueArea, hvn, aggressors, aggZones, hasFlow, totalVolume,
  };
}
