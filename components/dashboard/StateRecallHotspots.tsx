"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Database, MapPin, Flame } from "lucide-react";
import type { ProductInput } from "@/types";

interface StateData {
  state: string;
  recall_count: number;
  class1_count: number;
  risk_score: number;
}

function riskColor(score: number): string {
  if (score === 0) return "bg-white/[0.08]";
  if (score <= 15) return "bg-green-500/40";
  if (score <= 40) return "bg-amber-500/50";
  if (score <= 70) return "bg-orange-500/60";
  return "bg-red-500/70";
}

function riskTextColor(score: number): string {
  if (score === 0) return "text-white/30";
  if (score <= 15) return "text-green-400";
  if (score <= 40) return "text-amber-400";
  if (score <= 70) return "text-orange-400";
  return "text-red-400";
}

// State FIPS abbreviation → full name
const STATE_NAMES: Record<string, string> = {
  CA: "California", TX: "Texas", FL: "Florida", NY: "New York", IL: "Illinois",
  PA: "Pennsylvania", OH: "Ohio", GA: "Georgia", NC: "North Carolina", MI: "Michigan",
  NJ: "New Jersey", VA: "Virginia", WA: "Washington", AZ: "Arizona", MA: "Massachusetts",
  TN: "Tennessee", IN: "Indiana", MO: "Missouri", MD: "Maryland", WI: "Wisconsin",
  CO: "Colorado", MN: "Minnesota", SC: "South Carolina", AL: "Alabama", LA: "Louisiana",
  KY: "Kentucky", OR: "Oregon", OK: "Oklahoma", CT: "Connecticut", UT: "Utah",
  IA: "Iowa", NV: "Nevada", AR: "Arkansas", MS: "Mississippi", KS: "Kansas",
  NM: "New Mexico", NE: "Nebraska", ID: "Idaho", WV: "West Virginia", HI: "Hawaii",
  NH: "New Hampshire", ME: "Maine", RI: "Rhode Island", MT: "Montana", DE: "Delaware",
  SD: "South Dakota", ND: "North Dakota", AK: "Alaska", DC: "Washington D.C.",
  VT: "Vermont", WY: "Wyoming",
};

export function StateRecallHotspots({
  products,
  productType = "Food",
}: {
  products: ProductInput[];
  productType?: string;
}) {
  const [data, setData] = useState<StateData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Extract search terms from products for more specific state-level matching
    const termSet = new Set<string>();
    for (const p of products) {
      for (const word of p.name.split(/\s+/)) {
        const w = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
        if (w.length >= 4) termSet.add(w);
      }
    }
    const terms = Array.from(termSet).slice(0, 6);

    const params = new URLSearchParams({
      productType,
      ...(terms.length > 0 ? { terms: terms.join(",") } : {}),
    });

    fetch(`/api/recall-states?${params}`)
      .then((r) => r.json())
      .then((res: { clickhouse_ready: boolean; data: StateData[] }) => {
        setData(res.data ?? []);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [products, productType]);

  if (loading) return null;
  if (!data.length) return null;

  const maxCount = Math.max(...data.map((d) => d.recall_count), 1);
  const top10 = data.slice(0, 10);

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin size={10} className="text-white/30" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/35">
            FDA Recall Hotspots — by State
          </p>
          <span className="text-[9px] font-mono text-white/20 border border-white/[0.08] px-1.5 py-0.5 rounded">
            ClickHouse · 5yr
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Flame size={9} className="text-white/20" />
          <span className="text-[9px] font-mono text-white/20">{productType}</span>
        </div>
      </div>

      {/* State bars */}
      <div className="space-y-1.5">
        {top10.map((d) => {
          const barPct = Math.max(4, Math.round((d.recall_count / maxCount) * 100));
          return (
            <div key={d.state} className="flex items-center gap-2">
              {/* State abbrev */}
              <span className="text-[9px] font-mono text-white/40 w-6 shrink-0 text-right">
                {d.state}
              </span>
              {/* Bar */}
              <div className="flex-1 h-4 bg-white/[0.04] rounded-sm overflow-hidden relative">
                <div
                  className={cn("h-full rounded-sm transition-all", riskColor(d.risk_score))}
                  style={{ width: `${barPct}%` }}
                />
                {/* Label inside bar */}
                <span className="absolute inset-0 flex items-center pl-2">
                  <span className="text-[8px] font-mono text-white/40 truncate">
                    {STATE_NAMES[d.state] ?? d.state}
                  </span>
                </span>
              </div>
              {/* Count + class I */}
              <div className="text-right shrink-0 w-20">
                <span className={cn("text-[10px] font-semibold", riskTextColor(d.risk_score))}>
                  {d.recall_count.toLocaleString()}
                </span>
                <span className="text-[8px] text-white/20 ml-0.5">recalls</span>
                {d.class1_count > 0 && (
                  <span className="text-[8px] text-red-400/60 font-mono ml-1">
                    · {d.class1_count}×I
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1 border-t border-white/[0.05]">
        <div className="flex items-center gap-1.5">
          <Database size={9} className="text-white/20" />
          <span className="text-[8px] font-mono text-white/20">
            {data.length} states with {productType} enforcement records · openFDA via ClickHouse
          </span>
        </div>
      </div>
    </div>
  );
}
