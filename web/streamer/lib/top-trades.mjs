// Captura de FLUJO AGRESIVO (bursts) para el panel 0DTE Live.
//
// Los prints individuales de opciones 0DTE son minúsculos (mediana ~$122 en SPY,
// máx ~$22K). La agresión que mueve el mercado aparece como BURST: muchos prints
// del MISMO strike+lado en ~1s = una orden barriendo el libro (sweep). Así que
// agregamos por (strike, tipo, lado) con una ventana de ~1.2s y filtramos sobre
// el premium AGREGADO del burst, no del print.
//
// Filtros (configurables por env):
//   1. premium del BURST > premMin           (por subyacente; ver PREM_MIN)
//   2. |delta| ∈ [DELTA_MIN, DELTA_MAX]       (calls +, puts −; zona gamma-pesada)
//   3. volumen del strike > VOL_MIN
//   4. single-leg mayoritario                  (spreadLeg de DXFeed; verificado en vivo)
//   5. 0DTE                                     (implícito: el streamer solo trae hoy)
//
// SWEEP: se marca por INTENSIDAD del burst (≥ SWEEP_PRINTS prints en la ventana),
// que es la definición operativa de un sweep. Los códigos OPRA de DXFeed vienen
// como letras sueltas (a,I,S,g,f,j) sin significado documentado fiable, así que no
// se usan para decidir sweep (se puede refinar si se confirma el mapa de códigos).

export const TT_CFG = {
  premMin: Number(process.env.TT_PREMIUM_MIN ?? 50000), // fallback por BURST (SPY/QQQ)
  deltaMin: Number(process.env.TT_DELTA_MIN ?? 0.30), // incluye ignición ATM/OTM
  deltaMax: Number(process.env.TT_DELTA_MAX ?? 0.65), // techo gamma-pesada; deep-ITM fuera
  volMin: Number(process.env.TT_VOL_MIN ?? 500),
  keep: Number(process.env.TT_KEEP ?? 25),
  burstGapMs: Number(process.env.TT_BURST_GAP_MS ?? 1200), // corta el burst si pasa >gap sin prints
  burstMaxMs: Number(process.env.TT_BURST_MAX_MS ?? 3000), // duración MÁX del burst (un sweep es corto;
  // sin esto, un strike continuamente activo nunca cierra y acumula todo el día)
  sweepPrints: Number(process.env.TT_SWEEP_PRINTS ?? 6), // prints en la ventana ⇒ sweep
  slMode: (process.env.TT_SINGLE_LEG ?? "spreadleg"), // "spreadleg" | "off"
};

// Umbral de BURST por subyacente (premium AGREGADO en $), ajustable por env.
// Calibrado con mercado abierto (2026-08-10): el burst 0DTE más grande en ~40s fue
// ~$50-55K tanto en SPY/QQQ como en SPX (SPX mueve poco VOLUMEN de contratos, así
// que su burst NO escala por notional — es del mismo orden). ES/NQ son más finos.
export const PREM_MIN = {
  SPY: Number(process.env.TT_PREM_SPY ?? 50000),
  QQQ: Number(process.env.TT_PREM_QQQ ?? 50000),
  SPX: Number(process.env.TT_PREM_SPX ?? 50000),
};
export function premMinFor(sym) {
  const k = String(sym || "").replace(/^\//, "").toUpperCase();
  return PREM_MIN[k] ?? TT_CFG.premMin;
}

// Los FUTUROS (ES/NQ) se filtran distinto: sus opciones 0DTE son finísimas (~1
// print/min por strike, casi todos de 1 contrato), así que el premium en $ no
// sirve. Se filtra por CANTIDAD DE CONTRATOS del burst (≥ sizeMin), con ventana
// más ancha (por si un sweep viene en varios 1-lots) y volumen mínimo más bajo.
const FUTURES = new Set(["ES", "NQ"]);
export function cfgFor(sym) {
  const k = String(sym || "").replace(/^\//, "").toUpperCase();
  if (FUTURES.has(k)) return {
    premMin: 0, // sin gate de premium
    sizeMin: Number(process.env.TT_FUT_SIZE_MIN ?? 5), // contratos mínimos del burst
    gap: Number(process.env.TT_FUT_GAP_MS ?? 2500),
    maxMs: Number(process.env.TT_FUT_MAX_MS ?? 8000),
    volMin: Number(process.env.TT_FUT_VOL_MIN ?? 50),
  };
  return {
    premMin: PREM_MIN[k] ?? TT_CFG.premMin, // equities/index: gate por premium $
    sizeMin: 0,
    gap: TT_CFG.burstGapMs,
    maxMs: TT_CFG.burstMaxMs,
    volMin: TT_CFG.volMin,
  };
}

export function createTopTrades(opts = {}) {
  const premMin = Number(opts.premMin ?? TT_CFG.premMin);
  const sizeMin = Number(opts.sizeMin ?? 0);       // contratos mínimos del burst (futuros)
  const gap = Number(opts.gap ?? TT_CFG.burstGapMs);
  const maxMs = Number(opts.maxMs ?? TT_CFG.burstMaxMs);
  const volMin = Number(opts.volMin ?? TT_CFG.volMin);
  const open = new Map(); // key `strike:type:side` → burst en curso
  let qualified = [];     // bursts cerrados que califican, más nuevo primero

  function toRecord(cur) {
    const size = cur.size;
    return {
      ts: cur.lastTs,
      strike: cur.strike,
      type: cur.type,           // "call" | "put"
      side: cur.side,           // "buy" (al ask) | "sell" (al bid)
      price: size > 0 ? cur.prem / (size * 100) : 0, // precio medio del burst
      size,                     // contratos agregados
      n: cur.n,                 // nº de prints en el burst
      premium: Math.round(cur.prem),
      delta: Number(cur.delta),
      volume: Number(cur.volume) || 0,
      oi: Number(cur.oi) || 0,
      // Apertura: volumen del día > OI ⇒ posicionamiento nuevo. Proxy a nivel strike.
      open: cur.open,
      gamma: typeof cur.gamma === "number" ? cur.gamma : null,
      sweep: cur.n >= TT_CFG.sweepPrints, // intensidad del burst
      slKnown: cur.slKnownN > 0,          // ¿spreadLeg vino poblado?
    };
  }

  function qualifies(cur) {
    // Gate principal: premium $ (equities/index) o contratos (futuros).
    if (premMin > 0 && !(cur.prem > premMin)) return false;
    if (sizeMin > 0 && !(cur.size >= sizeMin)) return false;
    const ad = Math.abs(Number(cur.delta));
    if (!(ad >= TT_CFG.deltaMin && ad <= TT_CFG.deltaMax)) return false;
    if (!(Number(cur.volume) > volMin)) return false;
    // single-leg: si conocemos spreadLeg y la mayoría son legs de spread, descartar.
    if (TT_CFG.slMode !== "off" && cur.slKnownN > 0 && cur.slSingle / cur.n < 0.6) return false;
    return true;
  }

  function finalize(cur) {
    if (!cur || cur._done) return;
    cur._done = true;
    if (!qualifies(cur)) return;
    qualified.unshift(toRecord(cur));
    if (qualified.length > TT_CFG.keep) qualified.length = TT_CFG.keep;
  }

  return {
    reset() { open.clear(); qualified = []; },

    // Un print (TimeAndSale). b = bucket del strike (delta/gamma/oi/volumen actuales).
    consider(e, info, b) {
      const price = Number(e.price), size = Number(e.size) || 0;
      if (!(price > 0) || size <= 0) return;
      const ts = Number(e.time) || Date.now();
      const s = String(e.aggressorSide ?? "").trim().toLowerCase();
      const side = s.startsWith("b") ? "buy" : s.startsWith("s") ? "sell" : "mid";
      const key = `${info.strike}:${info.type}:${side}`;
      let cur = open.get(key);
      // Se cierra el burst si pasó el gap sin prints, o si superó la duración máx
      // (evita que un strike siempre activo acumule el día entero en un solo "burst").
      if (cur && (ts - cur.lastTs > gap || ts - cur.firstTs > maxMs)) { finalize(cur); open.delete(key); cur = null; }
      if (!cur) {
        cur = { strike: info.strike, type: info.type, side, prem: 0, size: 0, n: 0,
          slSingle: 0, slKnownN: 0, firstTs: ts, lastTs: ts,
          delta: null, gamma: null, oi: 0, volume: 0, open: true, _done: false };
        open.set(key, cur);
      }
      cur.prem += price * size * 100;
      cur.size += size;
      cur.n += 1;
      cur.lastTs = Math.max(cur.lastTs, ts);
      if (e.spreadLeg !== true) cur.slSingle += 1;
      if (e.spreadLeg === true || e.spreadLeg === false) cur.slKnownN += 1;
      // Snapshot de griegas/OI/volumen del strike (lo último visto).
      if (b) {
        if (typeof b.delta === "number") cur.delta = b.delta;
        if (typeof b.gamma === "number") cur.gamma = b.gamma;
        cur.oi = Number(b.oi) || cur.oi;
        cur.volume = Number(b.volume) || cur.volume;
        const oi = Number(b.oi) || 0, vol = Number(b.volume) || 0;
        cur.open = oi > 0 ? vol > oi : true;
      }
    },

    // Se lee al escribir el snapshot: cierra los bursts inactivos (> gap) y devuelve
    // los que califican, más nuevo primero. Los bursts aún vivos siguen abiertos.
    get list() {
      const now = Date.now();
      for (const [key, cur] of open) {
        if (now - cur.lastTs > gap || now - cur.firstTs > maxMs) { finalize(cur); open.delete(key); }
      }
      return qualified.slice(0, TT_CFG.keep);
    },
  };
}
