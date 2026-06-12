"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { MARKET_BY_NUMERIC } from "@/lib/markets";
import type { CountryVerdict, MarketStatus } from "@/types";

const GEO_URL = "/countries-110m.json";

const STATUS_FILL: Record<MarketStatus, string> = {
  allowed: "#22c55e",
  review: "#eab308",
  prohibited: "#ef4444",
};

const NEUTRAL = "#1f1f23";
const NEUTRAL_HOVER = "#2a2a30";

interface GeoShape {
  rsmKey: string;
  id: string;
  properties: { name?: string };
}

export function WorldMap({
  verdicts,
  selectedIso3,
  onSelect,
}: {
  verdicts: CountryVerdict[];
  selectedIso3: string | null;
  onSelect: (iso3: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  // numeric id -> verdict
  const byNumeric = new Map<string, CountryVerdict>();
  for (const v of verdicts) {
    const market = Object.values(MARKET_BY_NUMERIC).find(
      (m) => m.iso3.toUpperCase() === v.iso3.toUpperCase()
    );
    if (market) byNumeric.set(market.numeric, v);
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 152, center: [0, 0] }}
        width={900}
        height={460}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto block"
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: GeoShape[] }) =>
            geographies.map((geo) => {
              const verdict = byNumeric.get(geo.id);
              const market = MARKET_BY_NUMERIC[geo.id];
              const fill = verdict ? STATUS_FILL[verdict.status] : NEUTRAL;
              const selected = verdict && selectedIso3 === verdict.iso3;
              const interactive = !!verdict;

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => verdict && onSelect(verdict.iso3)}
                  onMouseEnter={(e) => {
                    if (!market) return;
                    const label = verdict
                      ? `${market.name} — ${verdict.status}`
                      : market.name;
                    setTooltip({ x: e.clientX, y: e.clientY, label });
                  }}
                  onMouseMove={(e) =>
                    setTooltip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))
                  }
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    default: {
                      fill,
                      stroke: "#0a0a0a",
                      strokeWidth: 0.5,
                      outline: "none",
                      opacity: selected ? 1 : verdict ? 0.92 : 1,
                      filter: selected ? "brightness(1.25)" : undefined,
                      cursor: interactive ? "pointer" : "default",
                      transition: "all 0.15s ease",
                    },
                    hover: {
                      fill: verdict ? fill : NEUTRAL_HOVER,
                      stroke: "#0a0a0a",
                      strokeWidth: 0.5,
                      outline: "none",
                      opacity: 1,
                      filter: verdict ? "brightness(1.2)" : undefined,
                      cursor: interactive ? "pointer" : "default",
                    },
                    pressed: { fill, outline: "none" },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none text-[11px] font-mono bg-black border border-white/15 text-white px-2 py-1 rounded shadow-lg capitalize"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
