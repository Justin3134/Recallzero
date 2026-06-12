"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { MarketStatus, StateVerdict } from "@/types";

// CDN-hosted US states TopoJSON (same pattern as countries-110m.json)
const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const STATUS_FILL: Record<MarketStatus, string> = {
  allowed: "#22c55e",
  review: "#eab308",
  prohibited: "#ef4444",
};

const NEUTRAL = "#1f1f23";
const NEUTRAL_HOVER = "#2a2a30";

// FIPS numeric code → 2-letter state abbreviation
// These match the `code` field in StateVerdict
const FIPS_TO_CODE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY",
};

interface GeoShape {
  rsmKey: string;
  id: string;
  properties: { name?: string };
}

export function USStateMap({
  verdicts,
  selectedCode,
  onSelect,
}: {
  verdicts: StateVerdict[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  // code → verdict lookup
  const byCode = new Map<string, StateVerdict>();
  for (const v of verdicts) {
    byCode.set(v.code.toUpperCase(), v);
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl">
      <ComposableMap
        projection="geoAlbersUsa"
        width={900}
        height={560}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto block"
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }: { geographies: GeoShape[] }) =>
            geographies.map((geo) => {
              const fips = String(geo.id).padStart(2, "0");
              const code = FIPS_TO_CODE[fips];
              const verdict = code ? byCode.get(code) : undefined;
              const fill = verdict ? STATUS_FILL[verdict.status] : NEUTRAL;
              const isSelected = verdict && selectedCode === verdict.code;
              const interactive = !!verdict;

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => {
                    if (verdict) onSelect(verdict.code);
                  }}
                  onMouseEnter={(e) => {
                    const stateName = geo.properties.name ?? code ?? fips;
                    const label = verdict
                      ? `${stateName} — ${verdict.status}`
                      : stateName;
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
                      strokeWidth: 0.6,
                      outline: "none",
                      opacity: isSelected ? 1 : verdict ? 0.92 : 1,
                      filter: isSelected ? "brightness(1.3)" : undefined,
                      cursor: interactive ? "pointer" : "default",
                      transition: "all 0.15s ease",
                    },
                    hover: {
                      fill: verdict ? fill : NEUTRAL_HOVER,
                      stroke: "#0a0a0a",
                      strokeWidth: 0.6,
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
