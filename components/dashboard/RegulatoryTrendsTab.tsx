"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  Database,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Activity,
  Flame,
  Minus,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrendPoint {
  month: string;
  total_recalls: number;
  critical_recalls: number;
}

interface MonitorStats {
  clickhouse_ready: boolean;
  total_runs?: number;
  alerts_generated?: number;
  p50_latency_ms?: number;
  p99_latency_ms?: number;
  avg_token_savings_pct?: number;
  avg_entities_per_doc?: number;
  total_intelligence_docs?: number;
  days?: number;
}

interface VelocityPoint {
  product_type: string;
  current_daily_rate: number;
  baseline_daily_rate: number;
  velocity_pct: number;
  trend: "spike" | "rising" | "stable" | "falling";
  current_period_total: number;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-black px-4 py-3 space-y-0.5">
      <p className="text-[9px] font-mono uppercase tracking-widest text-white/25">{label}</p>
      <p
        className={cn(
          "text-[17px] font-semibold leading-none",
          accent ? "text-[#22c55e]/80" : "text-white/70"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[9px] font-mono text-white/20 truncate">{sub}</p>}
    </div>
  );
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/[0.12] bg-black px-3 py-2 text-[11px] space-y-1">
      <p className="text-white/50 font-mono">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

function VelocityCard({ v }: { v: VelocityPoint }) {
  const isSpike = v.trend === "spike";
  const isRising = v.trend === "rising";
  const isFalling = v.trend === "falling";
  const isPositive = isSpike || isRising;

  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-2",
        isSpike
          ? "border-red-500/25 bg-red-500/[0.04]"
          : isRising
          ? "border-orange-500/20 bg-orange-500/[0.03]"
          : isFalling
          ? "border-green-500/15 bg-green-500/[0.02]"
          : "border-white/[0.06] bg-white/[0.015]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isSpike ? (
            <Flame size={10} className="text-red-400 shrink-0" />
          ) : isRising ? (
            <TrendingUp size={10} className="text-orange-400 shrink-0" />
          ) : isFalling ? (
            <TrendingDown size={10} className="text-green-400 shrink-0" />
          ) : (
            <Minus size={10} className="text-white/25 shrink-0" />
          )}
          <p className="text-[10px] font-medium text-white/60 leading-none">
            {v.product_type}
          </p>
        </div>
        <span
          className={cn(
            "text-[10px] font-mono font-semibold shrink-0",
            isSpike
              ? "text-red-400"
              : isRising
              ? "text-orange-400"
              : isFalling
              ? "text-green-400"
              : "text-white/30"
          )}
        >
          {isPositive ? "+" : ""}
          {v.velocity_pct}%
        </span>
      </div>

      <div className="flex items-center gap-3 text-[9px] font-mono text-white/25">
        <span>
          Now:{" "}
          <span className={isPositive ? "text-white/50" : "text-white/40"}>
            {v.current_period_total} / 30d
          </span>
        </span>
        <span>
          Baseline:{" "}
          <span className="text-white/35">
            {v.baseline_daily_rate.toFixed(1)}/day
          </span>
        </span>
      </div>

      {isSpike && (
        <p className="text-[9px] text-red-400/70 leading-relaxed">
          Enforcement rate is surging — elevated compliance risk.
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RegulatoryTrendsTab({ industry }: { industry: string }) {
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [velocity, setVelocity] = useState<VelocityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [productType, setProductType] = useState(() => {
    const lower = industry.toLowerCase();
    if (lower.includes("food") || lower.includes("beverage") || lower.includes("supplement"))
      return "Food";
    if (lower.includes("pharma") || lower.includes("drug") || lower.includes("biotech"))
      return "Drug";
    if (lower.includes("device") || lower.includes("medical")) return "Device";
    return "Food";
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/regulatory-trends?productType=${encodeURIComponent(productType)}&months=24`)
        .then((r) => r.json())
        .catch(() => ({ clickhouse_ready: false, data: [] })),
      fetch("/api/monitor-stats?days=30")
        .then((r) => r.json())
        .catch(() => ({ clickhouse_ready: false })),
      fetch("/api/regulatory-velocity")
        .then((r) => r.json())
        .catch(() => ({ clickhouse_ready: false, data: [] })),
    ]).then(([trendsRes, statsRes, velocityRes]) => {
      setTrends(
        (trendsRes as { clickhouse_ready: boolean; data: TrendPoint[] }).data ?? []
      );
      setStats(statsRes as MonitorStats);
      setVelocity(
        (velocityRes as { clickhouse_ready: boolean; data: VelocityPoint[] }).data ?? []
      );
      setLoading(false);
    });
  }, [productType]);

  const chReady = stats?.clickhouse_ready || trends.length > 0;
  const maxTotal = Math.max(...trends.map((t) => t.total_recalls), 1);

  // Highlight spikes and rising trends
  const notableVelocity = velocity.filter(
    (v) => v.trend === "spike" || v.trend === "rising" || v.trend === "falling"
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Database size={10} className="text-white/30" />
            <h2 className="text-[11px] font-mono uppercase tracking-widest text-white/35">
              Regulatory Intelligence
            </h2>
            <span className="text-[8px] font-mono text-white/20 border border-white/[0.08] px-1.5 py-0.5 rounded">
              ClickHouse
            </span>
          </div>
          <p className="text-[12px] text-white/40 leading-relaxed max-w-lg">
            Historical FDA enforcement trends, enforcement velocity spikes, and production
            monitoring analytics — queried live from 69k+ records.
          </p>
        </div>
      </div>

      {/* ── Not configured ── */}
      {!loading && !chReady && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-8 flex flex-col items-center gap-3 text-center">
          <Database size={22} className="text-white/15" />
          <div>
            <p className="text-[12px] text-white/40 font-medium">ClickHouse not connected</p>
            <p className="text-[11px] text-white/25 leading-relaxed mt-1 max-w-sm">
              Set{" "}
              <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">
                CLICKHOUSE_HOST
              </code>{" "}
              in{" "}
              <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">
                .env.local
              </code>{" "}
              and run{" "}
              <code className="text-[10px] bg-white/[0.06] px-1 py-0.5 rounded">
                npm run ch:setup && npm run ch:ingest
              </code>
            </p>
          </div>
        </div>
      )}

      {/* ── Enforcement Velocity Spikes ── */}
      {chReady && !loading && notableVelocity.length > 0 && (
        <div className="space-y-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 flex items-center gap-1.5">
            <Zap size={9} />
            Enforcement velocity — 30d vs 90d baseline
          </p>
          <div className="grid grid-cols-2 gap-2">
            {notableVelocity.slice(0, 4).map((v) => (
              <VelocityCard key={v.product_type} v={v} />
            ))}
          </div>
          <p className="text-[8px] text-white/15 font-mono">
            Spike = current 30-day recall rate ≥ 50% above 90-day baseline · Source: openFDA
          </p>
        </div>
      )}

      {/* ── Production monitor stats ── */}
      {chReady && stats?.clickhouse_ready && (
        <div className="space-y-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 flex items-center gap-1.5">
            <Activity size={9} />
            Production monitoring — last {stats.days ?? 30}d
          </p>
          <div className="grid grid-cols-4 gap-px bg-white/[0.06] rounded-xl overflow-hidden border border-white/[0.07]">
            <StatCell label="Monitor runs" value={(stats.total_runs ?? 0).toLocaleString()} />
            <StatCell
              label="Alerts found"
              value={(stats.alerts_generated ?? 0).toLocaleString()}
              accent={(stats.alerts_generated ?? 0) > 0}
            />
            <StatCell
              label="GLiNER p50"
              value={`${stats.p50_latency_ms ?? 0}ms`}
              sub="median latency"
              accent={(stats.p50_latency_ms ?? 0) < 300}
            />
            <StatCell
              label="Token savings"
              value={`${stats.avg_token_savings_pct ?? 0}%`}
              sub="GLiNER2 compression"
              accent={(stats.avg_token_savings_pct ?? 0) > 30}
            />
          </div>
          {(stats.total_intelligence_docs ?? 0) > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={10} className="text-white/25" />
                <p className="text-[11px] text-white/40">Regulatory intelligence corpus</p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-semibold text-white/70">
                  {(stats.total_intelligence_docs ?? 0).toLocaleString()}
                </p>
                <p className="text-[9px] text-white/25 font-mono">searchable documents</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FDA Recall Trend Chart ── */}
      {chReady && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 flex items-center gap-1.5">
              <TrendingUp size={9} />
              FDA enforcement actions — 24 months
            </p>
            <div className="flex gap-1">
              {(["Food", "Drug", "Device"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setProductType(t)}
                  className={cn(
                    "px-2 py-1 text-[9px] font-mono rounded transition-colors",
                    productType === t
                      ? "bg-white/[0.08] text-white/70 border border-white/[0.12]"
                      : "text-white/25 hover:text-white/45"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-48 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <Database size={16} className="text-white/20 animate-pulse" />
            </div>
          ) : trends.length > 0 ? (
            <div className="rounded-xl border border-white/[0.07] bg-black p-4">
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trends} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="critGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 8, fontFamily: "monospace" }}
                    tickLine={false}
                    axisLine={false}
                    interval={3}
                  />
                  <YAxis
                    tick={{ fill: "rgba(255,255,255,0.20)", fontSize: 8, fontFamily: "monospace" }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, maxTotal]}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="total_recalls"
                    name="Total recalls"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    fill="url(#totalGrad)"
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="critical_recalls"
                    name="Class I"
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    fill="url(#critGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 justify-end">
                <span className="flex items-center gap-1.5 text-[9px] font-mono text-white/25">
                  <span className="w-3 h-0.5 bg-blue-400/70 rounded" />
                  Total recalls
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-mono text-white/25">
                  <span className="w-3 h-0.5 bg-red-400/70 rounded" />
                  Class I (most serious)
                </span>
              </div>
              <p className="text-[8px] text-white/15 font-mono mt-1 text-right">
                Source: openFDA Enforcement Reports · {productType} category
              </p>
            </div>
          ) : (
            <div className="h-48 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
              <div className="text-center">
                <AlertTriangle size={16} className="text-white/15 mx-auto mb-2" />
                <p className="text-[11px] text-white/25">No trend data available</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GLiNER2 production latency ── */}
      {chReady && stats?.clickhouse_ready && (stats.p99_latency_ms ?? 0) > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 space-y-3">
          <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 flex items-center gap-1.5">
            <Zap size={9} />
            GLiNER2 production latency
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] text-white/25 font-mono mb-1">p50 (median)</p>
              <div className="flex items-end gap-2">
                <span className="text-[20px] font-semibold text-[#22c55e]">
                  {stats.p50_latency_ms}
                </span>
                <span className="text-[11px] text-white/30 mb-0.5">ms</span>
              </div>
              <div className="mt-1.5 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#22c55e]/50 rounded-full"
                  style={{
                    width: `${Math.min(100, ((stats.p50_latency_ms ?? 0) / 1000) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div>
              <p className="text-[9px] text-white/25 font-mono mb-1">p99 (tail)</p>
              <div className="flex items-end gap-2">
                <span className="text-[20px] font-semibold text-orange-400/80">
                  {stats.p99_latency_ms}
                </span>
                <span className="text-[11px] text-white/30 mb-0.5">ms</span>
              </div>
              <div className="mt-1.5 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400/40 rounded-full"
                  style={{
                    width: `${Math.min(100, ((stats.p99_latency_ms ?? 0) / 2000) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <p className="text-[9px] text-white/20 leading-relaxed">
            Real production measurements from{" "}
            {(stats.total_runs ?? 0).toLocaleString()} monitor runs, stored in ClickHouse{" "}
            <code className="text-[8px] bg-white/[0.06] px-1 rounded">monitor_runs</code> table.
          </p>
        </div>
      )}
    </div>
  );
}
