"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Radio,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ShieldAlert,
  Info,
  Loader2,
  CheckCircle2,
  Clock,
  BarChart3,
  Zap,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { DataStudioPanel } from "./DataStudioPanel";
import { RegulatoryTrendsTab } from "./RegulatoryTrendsTab";

// ── Types ─────────────────────────────────────────────────────────────────────

type SseEvent =
  | { type: "start"; sources: number; model: string; industry: string }
  | { type: "fetched"; count: number }
  | { type: "source"; agency: string; title: string; url: string }
  | {
      type: "gliner";
      agency: string;
      title: string;
      latency_ms: number;
      model_id: string;
      is_fine_tuned: boolean;
      entities: Record<string, string[]>;
      classifications: Record<string, string>;
      structured_summary: string;
      raw_chars: number;
      summary_chars: number;
      token_savings_pct: number;
    }
  | {
      type: "relevant";
      agency: string;
      title: string;
      severity: string;
      summary: string;
      required_action?: string;
      affected_products: string[];
      deadline: string | null;
      url: string;
      confidence: number;
    }
  | { type: "skip"; agency: string; title: string; reason: string }
  | { type: "error"; title: string; reason: string }
  | { type: "complete"; processed: number; found: number; saved: number }
  | { type: "fatal"; message: string };

interface Alert {
  id: string;
  agency: string;
  title: string;
  severity: string;
  summary: string;
  required_action?: string;
  affected_products: string[];
  deadline: string | null;
  url: string;
  confidence: number;
  ts: number;
  entities?: Record<string, string[]>;
  classifications?: Record<string, string>;
}

interface ProcessingItem {
  id: string;
  agency: string;
  title: string;
  status: "fetching" | "analyzing" | "done" | "skip";
  entityCount?: number;
  latency_ms?: number;
  token_savings_pct?: number;
  entities?: Record<string, string[]>;
  classifications?: Record<string, string>;
  ts: number;
}

const SEVERITY_META: Record<string, { label: string; dot: string; text: string; border: string; bg: string }> = {
  critical: { label: "Critical", dot: "bg-red-500", text: "text-red-400", border: "border-red-500/20", bg: "bg-red-500/[0.04]" },
  high: { label: "High", dot: "bg-orange-400", text: "text-orange-400", border: "border-orange-500/20", bg: "bg-orange-500/[0.04]" },
  medium: { label: "Medium", dot: "bg-yellow-400", text: "text-yellow-400", border: "border-yellow-500/20", bg: "bg-yellow-500/[0.04]" },
  low: { label: "Low", dot: "bg-white/30", text: "text-white/50", border: "border-white/[0.07]", bg: "bg-white/[0.02]" },
};

// Entity type → color
const ENTITY_COLORS: Record<string, string> = {
  agency: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  regulation_name: "bg-purple-500/15 text-purple-300 border-purple-500/20",
  deadline: "bg-orange-500/15 text-orange-300 border-orange-500/20",
  penalty: "bg-red-500/15 text-red-300 border-red-500/20",
  jurisdiction: "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  regulated_substance: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
  affected_product_category: "bg-green-500/15 text-green-300 border-green-500/20",
  prohibited_claim: "bg-pink-500/15 text-pink-300 border-pink-500/20",
};

const SCAN_INTERVAL_MS = 4 * 60 * 1000;
const BASE_MODEL = "fastino/gliner2-base-v1";

// ── Main component ─────────────────────────────────────────────────────────────

export function LiveMonitorPanel({
  companyName,
  industry,
  products,
  glinerModel: glinerModelProp,
  isFineTuned: isFineTunedProp,
}: {
  companyName: string;
  industry: string;
  products: string[];
  glinerModel?: string;
  isFineTuned?: boolean;
}) {
  const [view, setView] = useState<"monitor" | "benchmark" | "trends" | "data-studio">("monitor");

  const [glinerModel, setGlinerModel] = useState(glinerModelProp ?? BASE_MODEL);
  const [isFineTuned, setIsFineTuned] = useState(isFineTunedProp ?? false);

  useEffect(() => {
    if (glinerModelProp !== undefined) return;
    fetch("/api/pioneer-model-info")
      .then((r) => r.json())
      .then((d: { modelId: string; isFineTuned: boolean }) => {
        setGlinerModel(d.modelId);
        setIsFineTuned(d.isFineTuned);
      })
      .catch(() => {});
  }, [glinerModelProp]);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [processing, setProcessing] = useState<ProcessingItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [totalFound, setTotalFound] = useState(0);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [avgTokenSavings, setAvgTokenSavings] = useState<number | null>(null);
  const [nextScanIn, setNextScanIn] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertsEndRef = useRef<HTMLDivElement>(null);
  const savingsSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    alertsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [alerts]);

  const runScan = useCallback(async () => {
    if (scanning) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setNextScanIn(null);
    setScanning(true);
    setProcessing([]);

    const abort = new AbortController();
    abortRef.current = abort;

    const params = new URLSearchParams({ companyName, industry });
    if (products.length) params.set("products", products.join(","));

    // Cache entities/classifications keyed by "agency::title" so we can
    // look them up in the `relevant` handler without nesting state setters
    // (nested setters in updater functions are called twice in Strict Mode).
    const entityCache = new Map<
      string,
      { entities: Record<string, string[]>; classifications: Record<string, string> }
    >();

    try {
      const res = await fetch(`/api/live-monitor?${params}`, { signal: abort.signal });
      if (!res.ok || !res.body) {
        setScanning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as SseEvent;
            handleEvent(event);
          } catch {
            // malformed chunk
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    } finally {
      setScanning(false);
      setScanCount((n) => n + 1);
      scheduleNextScan();
    }

    function handleEvent(event: SseEvent) {
      const id = Math.random().toString(36).slice(2);
      const ts = Date.now();

      if (event.type === "source") {
        setProcessing((prev) => [
          ...prev.slice(-15),
          { id, agency: event.agency, title: event.title, status: "analyzing", ts },
        ]);
      } else if (event.type === "gliner") {
        const entityCount = Object.values(event.entities).flat().length;
        const cacheKey = `${event.agency}::${event.title}`;
        entityCache.set(cacheKey, {
          entities: event.entities,
          classifications: event.classifications,
        });

        if (event.token_savings_pct > 0) {
          savingsSamplesRef.current.push(event.token_savings_pct);
          const avg = Math.round(
            savingsSamplesRef.current.reduce((a, b) => a + b, 0) /
              savingsSamplesRef.current.length
          );
          setAvgTokenSavings(avg);
        }

        setProcessing((prev) =>
          prev.map((p) =>
            p.agency === event.agency && p.title === event.title
              ? {
                  ...p,
                  status: "done",
                  entityCount,
                  latency_ms: event.latency_ms,
                  token_savings_pct: event.token_savings_pct,
                  entities: event.entities,
                  classifications: event.classifications,
                }
              : p
          )
        );
        setTotalProcessed((n) => n + 1);
      } else if (event.type === "skip") {
        setProcessing((prev) =>
          prev.map((p) =>
            p.agency === event.agency && p.title === event.title
              ? { ...p, status: "skip" }
              : p
          )
        );
      } else if (event.type === "relevant") {
        setTotalFound((n) => n + 1);
        const cached = entityCache.get(`${event.agency}::${event.title}`);
        setAlerts((a) => [
          {
            id,
            agency: event.agency,
            title: event.title,
            severity: event.severity,
            summary: event.summary,
            required_action: event.required_action,
            affected_products: event.affected_products,
            deadline: event.deadline,
            url: event.url,
            confidence: event.confidence,
            ts,
            entities: cached?.entities,
            classifications: cached?.classifications,
          },
          ...a,
        ]);
      }
    }
  }, [scanning, companyName, industry, products]);

  const scheduleNextScan = useCallback(() => {
    let remaining = SCAN_INTERVAL_MS;
    setNextScanIn(remaining);

    countdownRef.current = setInterval(() => {
      remaining -= 5000;
      setNextScanIn(remaining > 0 ? remaining : 0);
    }, 5000);

    timerRef.current = setTimeout(() => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setNextScanIn(null);
      runScan();
    }, SCAN_INTERVAL_MS);
  }, [runScan]);

  useEffect(() => {
    runScan();
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* ── View toggle ── */}
      <div className="flex gap-1 border-b border-white/[0.06] -mb-2">
        <button
          onClick={() => setView("monitor")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-colors",
            view === "monitor"
              ? "text-white/80 bg-white/[0.05] border border-b-0 border-white/[0.08]"
              : "text-white/30 hover:text-white/55"
          )}
        >
          <Radio size={10} />
          Monitor
          {scanning && (
            <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
          )}
        </button>
        <button
          onClick={() => setView("trends")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-colors",
            view === "trends"
              ? "text-white/80 bg-white/[0.05] border border-b-0 border-white/[0.08]"
              : "text-white/30 hover:text-white/55"
          )}
        >
          <TrendingUp size={10} />
          Trends
        </button>
        <button
          onClick={() => setView("benchmark")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-colors",
            view === "benchmark"
              ? "text-white/80 bg-white/[0.05] border border-b-0 border-white/[0.08]"
              : "text-white/30 hover:text-white/55"
          )}
        >
          <BarChart3 size={10} />
          Benchmarks
        </button>
        <button
          onClick={() => setView("data-studio")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium rounded-t-lg transition-colors",
            view === "data-studio"
              ? "text-white/80 bg-white/[0.05] border border-b-0 border-white/[0.08]"
              : "text-white/30 hover:text-white/55"
          )}
        >
          <Sparkles size={10} />
          Data Studio
        </button>
      </div>

      {view === "benchmark" && <BenchmarkPanel />}
      {view === "data-studio" && <DataStudioPanel />}
      {view === "trends" && <RegulatoryTrendsTab industry={industry} />}

      {view === "monitor" && (
        <>
          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    scanning ? "bg-[#22c55e] animate-pulse" : "bg-white/20"
                  )}
                />
                <h2 className="text-[11px] font-mono uppercase tracking-widest text-white/35">
                  Live Regulatory Monitor
                </h2>
              </div>
              <p className="text-[12px] text-white/40 leading-relaxed max-w-lg">
                Pioneer GLiNER2 extracts regulatory entities from every article — agencies, deadlines, penalties, substances — then a Pioneer LLM synthesizes actionable alerts. Continuous feedback retrains the model.
              </p>
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1">
              {scanning ? (
                <span className="flex items-center gap-1.5 text-[11px] text-[#22c55e]/80">
                  <Loader2 size={11} className="animate-spin" />
                  Scanning…
                </span>
              ) : nextScanIn !== null ? (
                <span className="text-[11px] text-white/25 flex items-center gap-1">
                  <Clock size={10} />
                  Next in {Math.ceil(nextScanIn / 60000)}m
                </span>
              ) : (
                <span className="text-[11px] text-white/20 flex items-center gap-1">
                  <Clock size={10} />
                  Starting…
                </span>
              )}
              <span className="text-[9px] font-mono text-white/20">auto-scanning</span>
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="grid grid-cols-5 gap-px bg-white/[0.06] rounded-xl overflow-hidden border border-white/[0.07]">
            <StatCell label="Scans run" value={String(scanCount)} />
            <StatCell label="Articles" value={String(totalProcessed)} />
            <StatCell label="Alerts" value={String(totalFound)} />
            <StatCell
              label="Token savings"
              value={avgTokenSavings !== null ? `${avgTokenSavings}%` : "—"}
              sub="GLiNER2 vs raw text"
              accent={avgTokenSavings !== null && avgTokenSavings > 30}
            />
            <StatCell
              label="GLiNER model"
              value={isFineTuned ? "Fine-tuned" : "Base"}
              sub={glinerModel.slice(0, 12) + "…"}
              accent={isFineTuned}
            />
          </div>

          {/* ── Two-column body ── */}
          <div className="grid lg:grid-cols-5 gap-4 items-start">
            {/* Left: Alert feed */}
            <div className="lg:col-span-3 space-y-2">
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-3 flex items-center gap-2">
                <ShieldAlert size={10} />
                Regulatory alerts
              </p>

              {alerts.length === 0 && !scanning && (
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-8 flex flex-col items-center gap-2 text-center">
                  <Radio size={18} className="text-white/15" />
                  <p className="text-[12px] text-white/30">Scanning regulatory sources…</p>
                  <p className="text-[11px] text-white/20">Alerts matching your products will appear here</p>
                </div>
              )}

              {alerts.length === 0 && scanning && (
                <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-8 flex flex-col items-center gap-2 text-center">
                  <Loader2 size={18} className="text-white/20 animate-spin" />
                  <p className="text-[12px] text-white/30">Analyzing articles with Pioneer GLiNER2…</p>
                </div>
              )}

              <div className="space-y-2">
                {alerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} />
                ))}
              </div>
              <div ref={alertsEndRef} />
            </div>

            {/* Right: Live activity + model */}
            <div className="lg:col-span-2 space-y-4">
              {/* Activity feed */}
              <div className="rounded-xl border border-white/[0.07] bg-black overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      scanning ? "bg-[#22c55e] animate-pulse" : "bg-white/15"
                    )}
                  />
                  <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">
                    GLiNER2 activity
                  </span>
                  <span className="ml-auto text-[9px] font-mono text-white/15">
                    pioneer.ai
                  </span>
                </div>
                <div className="px-3 py-2 space-y-1.5 min-h-[160px] max-h-[300px] overflow-y-auto">
                  {processing.length === 0 && (
                    <div className="flex items-center justify-center h-24">
                      <span className="text-[11px] text-white/20">
                        {scanning ? "Starting…" : "Idle"}
                      </span>
                    </div>
                  )}
                  {[...processing].reverse().map((item) => (
                    <ProcessingRow key={item.id} item={item} />
                  ))}
                </div>
              </div>

              {/* Model info card */}
              <div className="rounded-xl border border-white/[0.07] bg-black overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-white/30">
                    Pioneer GLiNER2
                  </span>
                  {isFineTuned && (
                    <span className="ml-auto text-[8px] font-mono uppercase tracking-wider text-white/60 border border-white/[0.12] px-1.5 py-0.5 rounded-full">
                      fine-tuned
                    </span>
                  )}
                </div>
                <div className="px-3 py-3 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/30">Active model</span>
                      <span className={cn("text-[10px] font-medium", isFineTuned ? "text-white/80" : "text-white/40")}>
                        {isFineTuned ? "Fine-tuned" : "Base"}
                      </span>
                    </div>
                    <p className="text-[9px] font-mono text-white/20 truncate">{glinerModel}</p>
                  </div>

                  {/* Entity type legend */}
                  <div className="pt-1 border-t border-white/[0.06] space-y-1.5">
                    <p className="text-[9px] font-mono uppercase tracking-widest text-white/20">Entity types extracted</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(ENTITY_COLORS).map(([type, cls]) => (
                        <span
                          key={type}
                          className={cn("text-[8px] font-mono px-1.5 py-0.5 rounded border", cls)}
                        >
                          {type.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
                    <Timeline isFineTuned={isFineTuned} />
                  </div>
                  <p className="text-[9px] text-white/20 leading-relaxed pt-1 border-t border-white/[0.06]">
                    Thumbs on alerts feed back to Pioneer. At 100 corrections, the model auto-retrains on your domain.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: Alert }) {
  const [open, setOpen] = useState(false);
  const meta = SEVERITY_META[alert.severity] ?? SEVERITY_META.low;
  const entityEntries = Object.entries(alert.entities ?? {}).filter(([, vals]) => vals.length > 0);

  return (
    <div className={cn("rounded-xl border overflow-hidden", meta.border, meta.bg)}>
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-1.5", meta.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[9px] font-mono uppercase tracking-wider shrink-0", meta.text)}>
              {meta.label}
            </span>
            <span className="text-[9px] text-white/25 font-mono shrink-0">{alert.agency}</span>
            {alert.classifications?.action_type && (
              <span className="text-[8px] font-mono text-white/20 border border-white/[0.08] px-1 py-0.5 rounded">
                {alert.classifications.action_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
          <p className="text-[13px] font-medium text-white/85 leading-snug mt-0.5 pr-2">
            {alert.title}
          </p>
          {alert.affected_products.length > 0 && (
            <p className="text-[11px] text-white/35 mt-1">
              Affects: {alert.affected_products.slice(0, 3).join(" · ")}
            </p>
          )}
          {/* Top entities preview */}
          {!open && entityEntries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {entityEntries.slice(0, 4).map(([type, vals]) => (
                <span
                  key={type}
                  className={cn(
                    "text-[8px] font-mono px-1.5 py-0.5 rounded border",
                    ENTITY_COLORS[type] ?? "bg-white/10 text-white/40 border-white/[0.08]"
                  )}
                >
                  {vals[0]}
                </span>
              ))}
              {entityEntries.length > 4 && (
                <span className="text-[8px] font-mono text-white/20 px-1 py-0.5">
                  +{entityEntries.length - 4} more
                </span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
          {open ? (
            <ChevronDown size={12} className="text-white/25" />
          ) : (
            <ChevronRight size={12} className="text-white/25" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.05]">
          <p className="text-[12px] text-white/55 leading-relaxed pt-3">{alert.summary}</p>

          {alert.required_action && (
            <div className="flex items-start gap-2">
              <AlertTriangle size={10} className="text-white/30 mt-0.5 shrink-0" />
              <p className="text-[11px] text-white/45 leading-relaxed">{alert.required_action}</p>
            </div>
          )}

          {/* GLiNER2 entity chips */}
          {entityEntries.length > 0 && (
            <div className="pt-2 border-t border-white/[0.05] space-y-2">
              <p className="text-[8px] font-mono uppercase tracking-widest text-white/20 flex items-center gap-1">
                <Zap size={8} />
                Pioneer GLiNER2 extracted
              </p>
              <div className="space-y-1.5">
                {entityEntries.map(([type, vals]) => (
                  <div key={type} className="flex items-start gap-2">
                    <span className="text-[8px] font-mono text-white/20 w-28 shrink-0 pt-0.5">
                      {type.replace(/_/g, " ")}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {vals.map((v, i) => (
                        <span
                          key={i}
                          className={cn(
                            "text-[8px] font-mono px-1.5 py-0.5 rounded border",
                            ENTITY_COLORS[type] ?? "bg-white/10 text-white/40 border-white/[0.08]"
                          )}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1">
            {alert.deadline && (
              <div className="flex items-center gap-1.5">
                <Clock size={10} className="text-white/25" />
                <span className="text-[10px] text-white/35">Deadline: {alert.deadline}</span>
              </div>
            )}
            <a
              href={alert.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors ml-auto"
              onClick={(e) => e.stopPropagation()}
            >
              Source <ExternalLink size={9} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Processing row ──────────────────────────────────────────────────────────────

function ProcessingRow({ item }: { item: ProcessingItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasEntities = item.entities && Object.values(item.entities).flat().length > 0;

  const icon =
    item.status === "done" ? (
      <CheckCircle2 size={10} className="text-[#22c55e]/50 shrink-0" />
    ) : item.status === "skip" ? (
      <Info size={10} className="text-white/15 shrink-0" />
    ) : (
      <Loader2 size={10} className="text-white/30 animate-spin shrink-0" />
    );

  return (
    <div className="py-0.5">
      <button
        className={cn("flex items-center gap-2 w-full text-left", hasEntities && "cursor-pointer")}
        onClick={() => hasEntities && setExpanded((v) => !v)}
        disabled={!hasEntities}
      >
        {icon}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-[10px] truncate leading-none",
            item.status === "skip" ? "text-white/20" : "text-white/45"
          )}>
            {item.title}
          </p>
          {item.status !== "skip" && (
            <p className="text-[9px] text-white/20 font-mono leading-none mt-0.5">{item.agency}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {item.entityCount !== undefined && item.entityCount > 0 && (
            <span className="text-[9px] font-mono text-[#22c55e]/40">
              {item.entityCount} entities
            </span>
          )}
          {item.token_savings_pct !== undefined && item.token_savings_pct > 0 && (
            <span className="text-[8px] font-mono text-white/20">
              -{item.token_savings_pct}%
            </span>
          )}
          {item.latency_ms !== undefined && (
            <span className="text-[8px] font-mono text-white/15">
              {item.latency_ms}ms
            </span>
          )}
        </div>
      </button>

      {/* Expanded entity chips */}
      {expanded && hasEntities && (
        <div className="ml-5 mt-1.5 flex flex-wrap gap-1">
          {Object.entries(item.entities!).flatMap(([type, vals]) =>
            vals.slice(0, 2).map((v, i) => (
              <span
                key={`${type}-${i}`}
                className={cn(
                  "text-[7px] font-mono px-1 py-0.5 rounded border",
                  ENTITY_COLORS[type] ?? "bg-white/10 text-white/40 border-white/[0.08]"
                )}
              >
                {v}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ isFineTuned }: { isFineTuned: boolean }) {
  const steps = [
    { label: "Base GLiNER2 deployed", done: true },
    { label: "300 synthetic examples generated", done: true },
    { label: "Fine-tuned on regulatory NER", done: isFineTuned },
    { label: "Adaptive inference active", done: isFineTuned },
    { label: "Auto-retrain at 100 corrections", done: false },
  ];
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              s.done ? "bg-white/50" : "bg-white/10"
            )}
          />
          <span className={cn("text-[10px] leading-none", s.done ? "text-white/45" : "text-white/20")}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Stat cell ──────────────────────────────────────────────────────────────────

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
    <div className="bg-black px-4 py-3 space-y-1">
      <p className="text-[9px] font-mono uppercase tracking-widest text-white/25">{label}</p>
      <p className={cn("text-[15px] font-semibold leading-none", accent ? "text-[#22c55e]/80" : "text-white/70")}>
        {value}
      </p>
      {sub && <p className="text-[9px] font-mono text-white/20 truncate">{sub}</p>}
    </div>
  );
}
