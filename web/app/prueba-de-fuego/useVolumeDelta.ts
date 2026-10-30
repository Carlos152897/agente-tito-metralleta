"use client";

// Volumen DELTA minuto a minuto para el panel derecho de la gráfica de VisionFutura (Carlos,
// 29-oct-2026). Pide /api/vision-futura/volumen cada 20 s: la primera vez el día completo, después
// solo los últimos minutos (y el día completo otra vez cada 5 min, por si entraron strikes nuevos).

import { useEffect, useRef, useState } from "react";
import type { StrikeMinute } from "@/lib/visionFuturaVolumeDelta";

export interface VolumeDeltaState {
  key: string;
  sessionOpen: number;
  asOfT: number;
  minutes: Map<number, StrikeMinute[]>;
}

export const VOL_WINDOWS: { sec: number | null; label: string }[] = [
  { sec: 60, label: "1 min" },
  { sec: 300, label: "5 min" },
  { sec: 900, label: "15 min" },
  { sec: null, label: "Día" },
];

const REFRESH_MS = 20_000;
const FULL_EVERY_MS = 5 * 60_000;

export function useVolumeDelta(p: { inst: string; expiration: string | null; spot: number | null; radius: number | null; enabled: boolean }): VolumeDeltaState | null {
  const key = `${p.inst}|${p.expiration}|${p.radius}`;
  const [state, setState] = useState<VolumeDeltaState | null>(null);
  const spotRef = useRef(p.spot);
  spotRef.current = p.spot;
  const stateRef = useRef<VolumeDeltaState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    if (!p.enabled || !p.expiration || !p.radius) return;
    let alive = true;
    let lastFull = 0;
    const load = async () => {
      const spot = spotRef.current;
      if (!spot) return;
      const prev = stateRef.current?.key === key ? stateRef.current : null;
      const full = !prev || Date.now() - lastFull > FULL_EVERY_MS;
      const since = full ? null : prev!.asOfT - 180;
      try {
        const qs = new URLSearchParams({ inst: p.inst, exp: p.expiration!, spot: String(spot), radius: String(p.radius) });
        if (since != null) qs.set("since", String(since));
        const res = await fetch(`/api/vision-futura/volumen?${qs}`, { cache: "no-store" });
        const j = await res.json();
        if (!alive || !res.ok || j.error) return;
        const minutes = new Map<number, StrikeMinute[]>(full ? [] : [...(prev?.minutes ?? [])].map(([k, v]) => [k, [...v]]));
        for (const [k, rows] of Object.entries(j.strikes as Record<string, number[][]>)) {
          const strike = Number(k);
          const byT = new Map((minutes.get(strike) ?? []).map((m) => [m.t, m]));
          for (const [t, cA, cB, cV, pA, pB, pV] of rows) byT.set(t, { t, cA, cB, cV, pA, pB, pV });
          minutes.set(strike, [...byT.values()].sort((a, b) => a.t - b.t));
        }
        if (full) lastFull = Date.now();
        setState({ key, sessionOpen: j.sessionOpen, asOfT: j.asOfT, minutes });
      } catch { /* sin red: se reintenta en el próximo ciclo */ }
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.enabled]);

  return state?.key === key ? state : null;
}
