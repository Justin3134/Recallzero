"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Sparkles,
  CheckCircle2,
  Clock,
  Zap,
  BarChart2,
  RefreshCcw,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface TrainingMetrics {
  f1: number;
  precision: number;
  recall: number;
}

interface SpotCheckEntity {
  label: string;
  text: string;
  score: number;
}

interface SpotCheckResult {
  testText: string;
  fineTuned: { modelId: string; entities: SpotCheckEntity[] };
  base: { modelId: string; entities: SpotCheckEntity[] };
}

// The model ID is set via PIONEER_GLINER_MODEL env var on the server.
// We expose it via a tiny prop so the component can display it.
export function PioneerModelPanel({
  activeModelId,
  isFineTuned,
}: {
  activeModelId: string;
  isFineTuned: boolean;
}) {
  const [spotCheck, setSpotCheck] = useState<SpotCheckResult | null>(null);
  const [loadingSpotCheck, setLoadingSpotCheck] = useState(false);
  const [showEntities, setShowEntities] = useState(false);

  const loadSpotCheck = useCallback(async () => {
    if (!isFineTuned) return;
    setLoadingSpotCheck(true);
    try {
      const res = await fetch(
        `/api/pioneer-train/status?modelId=${encodeURIComponent(activeModelId)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.type === "spotCheck") setSpotCheck(data);
      }
    } finally {
      setLoadingSpotCheck(false);
    }
  }, [activeModelId, isFineTuned]);

  useEffect(() => {
    if (isFineTuned) loadSpotCheck();
  }, [isFineTuned, loadSpotCheck]);

  const baseEntityCount = spotCheck?.base.entities.length ?? 0;
  const fineTunedEntityCount = spotCheck?.fineTuned.entities.length ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "p-2 rounded-lg",
              isFineTuned
                ? "bg-violet-500/10 text-violet-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Brain size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Regulatory NER Model
              {isFineTuned && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded-full">
                  <Sparkles size={9} />
                  Fine-tuned
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isFineTuned
                ? "Custom GLiNER2 trained on regulatory compliance text"
                : "Base GLiNER2 model (fastino/gliner2-base-v1)"}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
            isFineTuned
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-amber-500/10 text-amber-400"
          )}
        >
          {isFineTuned ? (
            <>
              <CheckCircle2 size={11} />
              Active
            </>
          ) : (
            <>
              <Clock size={11} />
              Base model
            </>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          icon={<Zap size={13} className="text-amber-400" />}
          label="Latency"
          value="~200ms"
          sub="vs 1–2s LLM"
        />
        <Stat
          icon={<BarChart2 size={13} className="text-blue-400" />}
          label="Cost"
          value="$0.15"
          sub="per 1M tokens"
        />
        <Stat
          icon={<Sparkles size={13} className="text-violet-400" />}
          label="Entity types"
          value="8"
          sub="regulatory NER"
        />
      </div>

      {/* Model ID */}
      <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
        {activeModelId}
      </div>

      {/* Fine-tuned capabilities */}
      {isFineTuned && (
        <div className="space-y-3">
          <div className="text-xs font-medium text-foreground/80">
            Fine-tuned for regulatory NER:
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              "regulation_name",
              "regulated_substance",
              "agency",
              "deadline",
              "penalty",
              "jurisdiction",
              "affected_product_category",
              "prohibited_claim",
            ].map((label) => (
              <div
                key={label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400/60 shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comparison: base vs fine-tuned */}
      {isFineTuned && (
        <div className="space-y-2">
          <button
            onClick={() => {
              setShowEntities((v) => !v);
              if (!spotCheck && !loadingSpotCheck) loadSpotCheck();
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showEntities ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Live comparison: base vs fine-tuned
            {loadingSpotCheck && (
              <RefreshCcw size={10} className="animate-spin ml-1" />
            )}
          </button>

          {showEntities && spotCheck && (
            <div className="space-y-3 text-xs rounded-lg bg-muted/30 p-3">
              <p className="text-muted-foreground italic leading-relaxed">
                &ldquo;{spotCheck.testText.slice(0, 120)}…&rdquo;
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* Base model */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    <span className="font-medium text-muted-foreground">
                      Base ({baseEntityCount} entities)
                    </span>
                  </div>
                  <div className="space-y-1">
                    {spotCheck.base.entities.slice(0, 6).map((e, i) => (
                      <EntityChip key={i} entity={e} color="amber" />
                    ))}
                    {baseEntityCount === 0 && (
                      <span className="text-muted-foreground/60">None found</span>
                    )}
                  </div>
                </div>

                {/* Fine-tuned model */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-2 h-2 rounded-full bg-violet-400/60" />
                    <span className="font-medium text-muted-foreground">
                      Fine-tuned ({fineTunedEntityCount} entities)
                    </span>
                  </div>
                  <div className="space-y-1">
                    {spotCheck.fineTuned.entities.slice(0, 6).map((e, i) => (
                      <EntityChip key={i} entity={e} color="violet" />
                    ))}
                    {fineTunedEntityCount === 0 && (
                      <span className="text-muted-foreground/60">None found</span>
                    )}
                  </div>
                </div>
              </div>

              {fineTunedEntityCount > baseEntityCount && (
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <CheckCircle2 size={11} />+
                  {fineTunedEntityCount - baseEntityCount} more entities detected
                  by fine-tuned model
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Adaptive inference callout */}
      <div className="flex items-start gap-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
        <RefreshCcw size={13} className="text-blue-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-blue-400">
            Adaptive Inference active
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every thumbs-up / thumbs-down on an alert feeds back to Pioneer and
            continuously retrains this model — your extractor improves with every
            correction, at zero cost.
          </p>
        </div>
      </div>

      {/* CTA: not yet fine-tuned */}
      {!isFineTuned && (
        <div className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
          <p className="text-xs font-medium text-violet-400 flex items-center gap-1.5">
            <Sparkles size={12} />
            Fine-tune available
          </p>
          <p className="text-xs text-muted-foreground">
            Train a custom GLiNER2 model on 300 synthetic regulatory examples to
            dramatically improve entity extraction accuracy. Run:
          </p>
          <code className="block text-xs font-mono bg-muted/50 rounded px-2 py-1.5 text-muted-foreground">
            npx tsx scripts/pioneer-finetune.ts
          </code>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ArrowRight size={10} />
            Then set{" "}
            <code className="font-mono text-violet-400">
              PIONEER_GLINER_MODEL
            </code>{" "}
            in .env.local
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-2.5 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function EntityChip({
  entity,
  color,
}: {
  entity: SpotCheckEntity;
  color: "amber" | "violet";
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span
        className={cn(
          "shrink-0 text-[9px] font-medium px-1 py-0.5 rounded mt-0.5",
          color === "amber"
            ? "bg-amber-500/10 text-amber-400"
            : "bg-violet-500/10 text-violet-400"
        )}
      >
        {entity.label.replace(/_/g, " ")}
      </span>
      <span className="text-foreground/80 leading-tight truncate">
        {entity.text}
      </span>
    </div>
  );
}

// ── Training progress component (shown during active training) ─────────────────

export function PioneerTrainingProgress({
  trainingJobId,
  onComplete,
}: {
  trainingJobId: string;
  onComplete?: (metrics: TrainingMetrics) => void;
}) {
  const [status, setStatus] = useState<string>("running");
  const [metrics, setMetrics] = useState<TrainingMetrics | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/pioneer-train/status?trainingJobId=${encodeURIComponent(trainingJobId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setStatus(data.status ?? "unknown");
        if (data.complete && data.metrics) {
          setMetrics(data.metrics);
          onComplete?.(data.metrics);
          clearInterval(interval);
        }
      } catch {}
    }, 15_000);
    return () => clearInterval(interval);
  }, [trainingJobId, onComplete]);

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
          <Brain size={16} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-violet-400">
            Fine-tuning in progress…
          </h3>
          <p className="text-xs text-muted-foreground">
            Status: <span className="font-mono">{status}</span>
          </p>
        </div>
        <RefreshCcw size={14} className="animate-spin text-violet-400 ml-auto" />
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>Training on 300 synthetic regulatory NER examples</p>
        <p className="font-mono text-[10px]">{trainingJobId}</p>
      </div>

      {metrics && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          {(
            [
              ["F1", metrics.f1],
              ["Precision", metrics.precision],
              ["Recall", metrics.recall],
            ] as [string, number][]
          ).map(([label, val]) => (
            <div key={label} className="rounded-lg bg-muted/40 p-2 text-center">
              <div className="text-sm font-semibold text-emerald-400">
                {(val * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
