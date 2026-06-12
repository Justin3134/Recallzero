"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Database,
  ExternalLink,
  ShieldAlert,
  Building2,
} from "lucide-react";
import type { ProductInput } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecallRiskData {
  clickhouse_ready: boolean;
  total_count?: number;
  class1_count?: number;
  class2_count?: number;
  class3_count?: number;
  yoy_delta_pct?: number;
  most_recent_date?: string | null;
  top_reason?: string | null;
  searched_terms?: string[];
  risk_score?: number;
  risk_label?: "none" | "low" | "medium" | "high" | "critical";
  industry_percentile?: number;
}

interface SupplierMatch {
  recalling_firm: string;
  recall_count: number;
  class1_count: number;
  last_recall_date: string;
  main_product_type: string;
  top_reason: string;
}

interface SupplierRiskData {
  clickhouse_ready: boolean;
  matches?: SupplierMatch[];
  searched_firms?: string[];
}

// ── Extract helpers ────────────────────────────────────────────────────────────

function extractSearchTerms(products: ProductInput[]): string[] {
  const terms = new Set<string>();

  for (const p of products) {
    for (const word of p.name.split(/\s+/)) {
      const w = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
      if (w.length >= 4) terms.add(w);
    }
    if (p.label_text) {
      const ingMatch = p.label_text.match(
        /Ingredients?\s*[:\n]\s*([^\n]+(?:\n(?!\n)[^\n]+)*)/i
      );
      if (ingMatch) {
        const ingText = ingMatch[1];
        ingText
          .replace(/\([^)]*\)/g, "")
          .split(/[,;]/)
          .map((i) => i.trim().toLowerCase())
          .filter((i) => i.length > 3 && i.length < 50)
          .slice(0, 8)
          .forEach((ing) => terms.add(ing));
      }
    }
  }

  if (products[0]?.name) {
    terms.add(products[0].name.toLowerCase().split(/\s+/)[0]);
  }

  return Array.from(terms).slice(0, 8);
}

/**
 * Extracts brand/manufacturer candidates from product names.
 * Takes the first 1-2 words of each product name as potential firm identifiers.
 */
function extractFirmCandidates(products: ProductInput[]): string[] {
  const firms = new Set<string>();

  for (const p of products) {
    const words = p.name.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 1) firms.add(words[0].toLowerCase());
    if (words.length >= 2) firms.add(`${words[0]} ${words[1]}`.toLowerCase());
  }

  return Array.from(firms).slice(0, 6);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskScoreRing({
  score,
  label,
}: {
  score: number;
  label: "none" | "low" | "medium" | "high" | "critical";
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  const COLOR = {
    none: "#ffffff30",
    low: "#22c55e",
    medium: "#f59e0b",
    high: "#f97316",
    critical: "#ef4444",
  }[label];

  const LABEL_COLOR = {
    none: "text-white/30",
    low: "text-green-400",
    medium: "text-amber-400",
    high: "text-orange-400",
    critical: "text-red-400",
  }[label];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="5"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={COLOR}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-[15px] font-bold leading-none", LABEL_COLOR)}>
            {score}
          </span>
          <span className="text-[7px] font-mono text-white/25 mt-0.5">/ 100</span>
        </div>
      </div>
      <span className={cn("text-[9px] font-mono uppercase tracking-wider font-semibold", LABEL_COLOR)}>
        {label}
      </span>
    </div>
  );
}

function ClassBar({
  class1,
  class2,
  class3,
  total,
}: {
  class1: number;
  class2: number;
  class3: number;
  total: number;
}) {
  if (total === 0) return null;
  const pct1 = Math.round((class1 / total) * 100);
  const pct2 = Math.round((class2 / total) * 100);
  const pct3 = Math.round((class3 / total) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/[0.06]">
        {pct1 > 0 && <div className="bg-red-500/70 h-full" style={{ width: `${pct1}%` }} />}
        {pct2 > 0 && <div className="bg-orange-400/70 h-full" style={{ width: `${pct2}%` }} />}
        {pct3 > 0 && <div className="bg-yellow-400/50 h-full" style={{ width: `${pct3}%` }} />}
      </div>
      <div className="flex gap-4 text-[9px] font-mono">
        <span className="text-red-400/70">
          Class I <span className="text-white/50">{class1}</span>
        </span>
        <span className="text-orange-400/70">
          Class II <span className="text-white/50">{class2}</span>
        </span>
        <span className="text-yellow-400/70">
          Class III <span className="text-white/50">{class3}</span>
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecallRiskPanel({ products }: { products: ProductInput[] }) {
  const [riskData, setRiskData] = useState<RecallRiskData | null>(null);
  const [supplierData, setSupplierData] = useState<SupplierRiskData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const terms = extractSearchTerms(products);
    const firms = extractFirmCandidates(products);

    if (!terms.length) {
      setLoading(false);
      return;
    }

    const riskParams = new URLSearchParams({ terms: terms.join(",") });
    const supplierParams = new URLSearchParams({ firms: firms.join(",") });

    Promise.all([
      fetch(`/api/recall-risk?${riskParams}`)
        .then((r) => r.json())
        .catch(() => null),
      firms.length > 0
        ? fetch(`/api/supplier-risk?${supplierParams}`)
            .then((r) => r.json())
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([risk, supplier]) => {
      setRiskData(risk as RecallRiskData | null);
      setSupplierData(supplier as SupplierRiskData | null);
      setLoading(false);
    });
  }, [products]);

  if (!loading && (!riskData || !riskData.clickhouse_ready)) return null;

  const total = riskData?.total_count ?? 0;
  const yoy = riskData?.yoy_delta_pct ?? 0;
  const score = riskData?.risk_score ?? 0;
  const label = riskData?.risk_label ?? "none";
  const percentile = riskData?.industry_percentile ?? 0;

  const BORDER = {
    none: "border-white/[0.07]",
    low: "border-green-500/20",
    medium: "border-amber-500/20",
    high: "border-orange-500/25",
    critical: "border-red-500/30",
  }[label];

  const BG = {
    none: "bg-white/[0.015]",
    low: "bg-green-500/[0.03]",
    medium: "bg-amber-500/[0.03]",
    high: "bg-orange-500/[0.04]",
    critical: "bg-red-500/[0.05]",
  }[label];

  const supplierMatches = supplierData?.matches?.filter((m) => m.recall_count > 0) ?? [];

  return (
    <div className={cn("rounded-2xl border p-5 space-y-4", BORDER, BG)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={10} className="text-white/30" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/35">
            FDA Recall Risk Intelligence
          </p>
          <span className="text-[9px] font-mono text-white/20 border border-white/[0.08] px-1.5 py-0.5 rounded">
            powered by ClickHouse
          </span>
        </div>
        <a
          href="https://open.fda.gov/data/downloads/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[9px] text-white/20 hover:text-white/45 transition-colors"
        >
          openFDA <ExternalLink size={8} />
        </a>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2">
          <Database size={12} className="text-white/20 animate-pulse" />
          <span className="text-[11px] text-white/30">Querying 69k+ enforcement records…</span>
        </div>
      ) : (
        <>
          {/* Score ring + stats */}
          <div className="flex items-center gap-5">
            <RiskScoreRing score={score} label={label} />

            <div className="flex-1 grid grid-cols-3 gap-px bg-white/[0.05] rounded-xl overflow-hidden border border-white/[0.06]">
              <div className="bg-black px-3 py-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-1">
                  Recalls (5yr)
                </p>
                <p
                  className={cn(
                    "text-[19px] font-semibold leading-none",
                    total === 0
                      ? "text-white/30"
                      : total > 30
                      ? "text-red-400"
                      : total > 10
                      ? "text-orange-400"
                      : "text-green-400"
                  )}
                >
                  {total === 0 ? "0" : total.toLocaleString()}
                </p>
                <p className="text-[9px] text-white/20 mt-1 font-mono">similar products</p>
              </div>

              <div className="bg-black px-3 py-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-1">
                  Class I
                </p>
                <p
                  className={cn(
                    "text-[19px] font-semibold leading-none",
                    (riskData?.class1_count ?? 0) > 0 ? "text-red-400" : "text-white/30"
                  )}
                >
                  {riskData?.class1_count ?? 0}
                </p>
                <p className="text-[9px] text-white/20 mt-1 font-mono">most serious</p>
              </div>

              <div className="bg-black px-3 py-3">
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-1">
                  YoY trend
                </p>
                <div className="flex items-center gap-1">
                  {yoy > 0 ? (
                    <TrendingUp size={12} className="text-red-400 shrink-0" />
                  ) : yoy < 0 ? (
                    <TrendingDown size={12} className="text-green-400 shrink-0" />
                  ) : (
                    <Minus size={12} className="text-white/25 shrink-0" />
                  )}
                  <p
                    className={cn(
                      "text-[19px] font-semibold leading-none",
                      yoy > 10 ? "text-red-400" : yoy < -10 ? "text-green-400" : "text-white/50"
                    )}
                  >
                    {yoy > 0 ? `+${yoy}` : yoy}
                    <span className="text-[12px]">%</span>
                  </p>
                </div>
                <p className="text-[9px] text-white/20 mt-1 font-mono">vs prior year</p>
              </div>
            </div>
          </div>

          {/* Percentile callout */}
          {score > 0 && percentile > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02]">
              <AlertTriangle size={10} className="text-white/30 shrink-0" />
              <p className="text-[11px] text-white/40 leading-relaxed">
                Risk score higher than{" "}
                <span className="text-white/70 font-semibold">{percentile}%</span> of similar
                products — based on recency-weighted Class I/II/III enforcement history.
              </p>
            </div>
          )}

          {/* Classification breakdown */}
          {total > 0 && (
            <ClassBar
              class1={riskData?.class1_count ?? 0}
              class2={riskData?.class2_count ?? 0}
              class3={riskData?.class3_count ?? 0}
              total={total}
            />
          )}

          {/* Top reason */}
          {riskData?.top_reason && (
            <div className="flex items-start gap-2">
              <AlertTriangle size={10} className="text-white/25 shrink-0 mt-0.5" />
              <p className="text-[11px] text-white/40 leading-relaxed">
                <span className="text-white/25">Top recall reason: </span>
                {riskData.top_reason.slice(0, 140)}
                {riskData.top_reason.length > 140 ? "…" : ""}
              </p>
            </div>
          )}

          {/* ── Supplier / Firm Intelligence ── */}
          {supplierMatches.length > 0 && (
            <div className="space-y-2 pt-1 border-t border-white/[0.05]">
              <div className="flex items-center gap-1.5">
                <Building2 size={9} className="text-white/25" />
                <p className="text-[9px] font-mono uppercase tracking-widest text-white/30">
                  Supplier / Brand Intelligence
                </p>
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">
                Firms matching your product brands found in FDA enforcement database:
              </p>
              <div className="space-y-1.5">
                {supplierMatches.slice(0, 4).map((m) => (
                  <div
                    key={m.recalling_firm}
                    className={cn(
                      "rounded-lg border px-3 py-2 flex items-center justify-between gap-3",
                      m.class1_count > 0
                        ? "border-red-500/15 bg-red-500/[0.03]"
                        : "border-white/[0.06] bg-white/[0.015]"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] text-white/60 font-medium truncate">
                        {m.recalling_firm}
                      </p>
                      <p className="text-[9px] text-white/25 font-mono mt-0.5 truncate">
                        {m.top_reason.slice(0, 60)}{m.top_reason.length > 60 ? "…" : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "text-[12px] font-semibold",
                          m.class1_count > 0 ? "text-red-400" : "text-white/50"
                        )}
                      >
                        {m.recall_count}
                        <span className="text-[9px] text-white/25 ml-0.5">recalls</span>
                      </p>
                      {m.class1_count > 0 && (
                        <p className="text-[9px] text-red-400/70 font-mono">
                          {m.class1_count} Class I
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Terms searched */}
          {riskData?.searched_terms && riskData.searched_terms.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-white/[0.05]">
              <span className="text-[8px] font-mono text-white/20 shrink-0 pt-0.5">
                searched:
              </span>
              {riskData.searched_terms.slice(0, 6).map((t) => (
                <span
                  key={t}
                  className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-white/[0.08] text-white/30"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {total === 0 && (
            <p className="text-[11px] text-white/25 leading-relaxed">
              No FDA enforcement actions found for similar products in the past 5 years — a strong
              compliance signal.
            </p>
          )}
        </>
      )}
    </div>
  );
}
