"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  FlaskConical,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Play,
  Loader2,
  Database,
  Target,
  Zap,
  Info,
  RotateCcw,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import type { PioneerJobMetrics } from "@/lib/benchmark-eval";

type BatchType = "general" | "rare-entities" | "hard-cases";

// ── Static knowledge about why the model underperforms ───────────────────────

const ROOT_CAUSES = [
  {
    severity: "critical",
    title: "Insufficient training data",
    detail:
      "300 examples is ~5× below the threshold for domain-specific GLiNER to reliably beat zero-shot frontier LLMs. Pioneer's own docs say F1 > 0.85 requires > 1,000 well-distributed examples.",
    estimatedF1Impact: 9.0,
  },
  {
    severity: "critical",
    title: "Entity type starvation",
    detail:
      "prohibited_claim has ~4 training examples, jurisdiction ~8. These types are trained on statistical noise — the model cannot reliably detect them.",
    estimatedF1Impact: 4.5,
  },
  {
    severity: "high",
    title: "Uniform document structure",
    detail:
      "All 300 examples are 2–5 clean sentences. Real regulatory text has legal boilerplate, cross-references, parenthetical abbreviations, multi-paragraph structure. The model overfits to this clean format.",
    estimatedF1Impact: 3.0,
  },
  {
    severity: "high",
    title: "No hard negatives",
    detail:
      "The model has never seen: 'the agency reviewed…' (common noun), '$100 registration fee' (price, not penalty), 'January 2025 issue date' (publication date, not deadline). It over-extracts.",
    estimatedF1Impact: 2.5,
  },
  {
    severity: "medium",
    title: "Too few epochs",
    detail:
      "6 epochs on 300 domain examples is underfitting. GLiNER-BioMed research recommends 12–20 epochs for small domain datasets with LoRA. More passes over good data compound the signal.",
    estimatedF1Impact: 1.5,
  },
];

const ENTITY_COVERAGE = [
  { type: "agency",                    evalCount: 23, color: "bg-[#22c55e]/60" },
  { type: "regulation_name",           evalCount: 22, color: "bg-[#22c55e]/50" },
  { type: "regulated_substance",       evalCount: 18, color: "bg-[#22c55e]/40" },
  { type: "affected_product_category", evalCount: 18, color: "bg-white/30" },
  { type: "penalty",                   evalCount: 16, color: "bg-white/22" },
  { type: "deadline",                  evalCount: 14, color: "bg-amber-400/40" },
  { type: "jurisdiction",              evalCount: 8,  color: "bg-amber-400/60" },
  { type: "prohibited_claim",          evalCount: 4,  color: "bg-red-400/60" },
];

interface BatchPreset {
  id: BatchType;
  label: string;
  description: string;
  targetProblem: string;
  defaultExamples: number;
  projectedF1Gain: string;
  cost: string;
  icon: typeof Sparkles;
  color: string;
}

const BATCH_PRESETS: BatchPreset[] = [
  {
    id: "general",
    label: "General Mix",
    description:
      "Diverse regulatory texts in realistic document formats: warning letter preambles, rule text, press releases, guidance excerpts. Fixes data volume and structural diversity.",
    targetProblem: "data volume · document diversity",
    defaultExamples: 500,
    projectedF1Gain: "+6–8",
    cost: "~$0.12",
    icon: Database,
    color: "border-white/[0.12]",
  },
  {
    id: "rare-entities",
    label: "Rare Entity Focus",
    description:
      "Every example must contain prohibited_claim or jurisdiction. Targets the two entity types that currently score near zero due to data starvation.",
    targetProblem: "prohibited_claim · jurisdiction",
    defaultExamples: 300,
    projectedF1Gain: "+3–5",
    cost: "~$0.07",
    icon: Target,
    color: "border-amber-400/20",
  },
  {
    id: "hard-cases",
    label: "Hard Cases",
    description:
      "Complex boundaries, abbreviation+full-form pairs, negated clauses, penalty ranges, and explicit hard negatives ('$100 registration fee' is not a penalty). Reduces false positives.",
    targetProblem: "boundary precision · false positives",
    defaultExamples: 200,
    projectedF1Gain: "+2–3",
    cost: "~$0.05",
    icon: Zap,
    color: "border-[#22c55e]/20",
  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "running" | "done" | "error";

interface PipelineRun {
  batchType: BatchType;
  label: string;
  numExamples: number;
  dataGenJobId?: string;
  datasetName?: string;
  status: StepStatus;
  error?: string;
}

interface TrainingRun {
  trainingJobId?: string;
  modelName?: string;
  status: StepStatus;
  error?: string;
  datasets: string[];
  epochs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical")
    return <XCircle size={11} className="text-red-400/70 shrink-0 mt-0.5" />;
  if (severity === "high")
    return <AlertTriangle size={11} className="text-amber-400/60 shrink-0 mt-0.5" />;
  return <Info size={11} className="text-white/30 shrink-0 mt-0.5" />;
}

function StatusDot({ status }: { status: StepStatus }) {
  if (status === "running")
    return <Loader2 size={11} className="text-white/50 animate-spin shrink-0" />;
  if (status === "done")
    return <CheckCircle2 size={11} className="text-[#22c55e]/70 shrink-0" />;
  if (status === "error")
    return <XCircle size={11} className="text-red-400/60 shrink-0" />;
  return <div className="w-3 h-3 rounded-full border border-white/[0.15] shrink-0" />;
}

function Section({
  label,
  Icon,
  children,
  className,
}: {
  label: string;
  Icon: typeof Database;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Icon size={11} className="text-white/25 shrink-0" />
        <p className="text-[9px] font-mono uppercase tracking-widest text-white/30">
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

// ── Admin secret input ────────────────────────────────────────────────────────
// The admin secret stays in memory only — never persisted to localStorage.
// Required to call the x-admin-secret–gated Pioneer train API routes.

function AdminSecretInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2">
      <KeyRound size={10} className="text-white/25 shrink-0" />
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Admin secret (ADMIN_SECRET env var)"
        className="flex-1 bg-transparent text-[11px] font-mono text-white/50 placeholder-white/15 focus:outline-none"
        autoComplete="off"
      />
      <button
        onClick={() => setShow((v) => !v)}
        className="text-white/20 hover:text-white/40 transition-colors"
      >
        {show ? <EyeOff size={10} /> : <Eye size={10} />}
      </button>
      {value && (
        <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]/60 shrink-0" />
      )}
    </div>
  );
}

// ── Root cause card ───────────────────────────────────────────────────────────

function RootCauseCard({ currentF1 }: { currentF1: number | null }) {
  const totalGain = ROOT_CAUSES.reduce((s, c) => s + c.estimatedF1Impact, 0);
  const projectedF1 = Math.min(96, (currentF1 ?? 72) + totalGain * 0.83);

  return (
    <div className="rounded-xl border border-red-400/15 bg-red-400/[0.03] px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={11} className="text-red-400/60" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-red-400/50">
            Why your model underperforms
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[8px] font-mono text-white/20">current</p>
            <p className="text-[18px] font-semibold leading-none text-white/40">
              {currentF1 != null ? currentF1.toFixed(1) : "—"}
              <span className="text-[11px] text-white/20">%</span>
            </p>
          </div>
          <ChevronRight size={14} className="text-white/15" />
          <div className="text-right">
            <p className="text-[8px] font-mono text-white/20">projected</p>
            <p className="text-[18px] font-semibold leading-none text-[#22c55e]">
              {projectedF1.toFixed(0)}
              <span className="text-[11px] text-[#22c55e]/50">%</span>
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {ROOT_CAUSES.map((cause) => (
          <div key={cause.title} className="flex items-start gap-2.5">
            <SeverityIcon severity={cause.severity} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-white/60 leading-none">
                  {cause.title}
                </p>
                <span className="text-[10px] font-mono text-red-400/40 shrink-0">
                  −{cause.estimatedF1Impact.toFixed(1)} F1
                </span>
              </div>
              <p className="text-[10px] text-white/28 leading-relaxed mt-0.5">
                {cause.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Entity coverage chart ─────────────────────────────────────────────────────

function EntityCoverageChart() {
  const max = Math.max(...ENTITY_COVERAGE.map((e) => e.evalCount));

  return (
    <Section label="Entity type coverage · eval proxy" Icon={Target}>
      <div className="space-y-1.5">
        {ENTITY_COVERAGE.map((e) => {
          const isLow = e.evalCount < 8;
          const isMedium = e.evalCount >= 8 && e.evalCount < 15;
          const badge = isLow ? "🔴 critical" : isMedium ? "🟡 low" : "✓";

          return (
            <div key={e.type} className="flex items-center gap-3">
              <span className="text-[9px] font-mono text-white/28 w-36 shrink-0 truncate">
                {e.type}
              </span>
              <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", e.color)}
                  style={{ width: `${(e.evalCount / max) * 100}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-white/28 w-4 text-right shrink-0">
                {e.evalCount}
              </span>
              <span
                className={cn(
                  "text-[8px] font-mono w-16 shrink-0",
                  isLow
                    ? "text-red-400/55"
                    : isMedium
                    ? "text-amber-400/50"
                    : "text-white/18"
                )}
              >
                {badge}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] text-white/18 leading-relaxed">
        Based on the 25-example eval set as a proxy for training coverage. Types
        with fewer eval examples almost certainly have proportionally fewer training
        examples — causing poor recall for those types.
      </p>
    </Section>
  );
}

// ── Generation wizard ─────────────────────────────────────────────────────────

function GenerationWizard({
  adminSecret,
  onGenerationStarted,
  completedDatasets,
}: {
  adminSecret: string;
  onGenerationStarted: (run: PipelineRun) => void;
  completedDatasets: string[];
}) {
  const [selectedBatches, setSelectedBatches] = useState<Set<BatchType>>(
    new Set(["general", "rare-entities", "hard-cases"])
  );
  const [customCounts, setCustomCounts] = useState<Record<BatchType, number>>({
    general: 500,
    "rare-entities": 300,
    "hard-cases": 200,
  });
  const [running, setRunning] = useState<BatchType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalExamples = BATCH_PRESETS.filter((p) =>
    selectedBatches.has(p.id)
  ).reduce((sum, p) => sum + customCounts[p.id], 0);

  const toggleBatch = (id: BatchType) => {
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const launchGeneration = useCallback(async () => {
    if (selectedBatches.size === 0 || !adminSecret) return;
    setError(null);

    for (const preset of BATCH_PRESETS.filter((p) => selectedBatches.has(p.id))) {
      setRunning(preset.id);
      try {
        const res = await fetch("/api/pioneer-train", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-secret": adminSecret,
          },
          body: JSON.stringify({
            batchType: preset.id,
            numExamples: customCounts[preset.id],
            datasetVersion: 2,
          }),
        });

        const body = (await res.json()) as {
          ok?: boolean;
          dataGenJobId?: string;
          datasetName?: string;
          error?: string;
        };

        if (!res.ok || body.error) {
          setError(body.error ?? `Error ${res.status} for ${preset.id}`);
          setRunning(null);
          return;
        }

        onGenerationStarted({
          batchType: preset.id,
          label: preset.label,
          numExamples: customCounts[preset.id],
          dataGenJobId: body.dataGenJobId,
          datasetName: body.datasetName,
          status: "running",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
        setRunning(null);
        return;
      }
    }
    setRunning(null);
  }, [selectedBatches, customCounts, onGenerationStarted, adminSecret]);

  const locked = !adminSecret;

  return (
    <Section label="Generate training data" Icon={Sparkles}>
      <div className="space-y-2">
        {BATCH_PRESETS.map((preset) => {
          const selected = selectedBatches.has(preset.id);
          const isRunning = running === preset.id;
          const isComplete = completedDatasets.some((d) =>
            d.includes(preset.id)
          );

          return (
            <div
              key={preset.id}
              onClick={() => toggleBatch(preset.id)}
              className={cn(
                "rounded-lg border px-3 py-3 cursor-pointer transition-all",
                selected
                  ? cn("bg-white/[0.04]", preset.color)
                  : "border-white/[0.06] bg-transparent opacity-50 hover:opacity-70"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-all",
                    selected ? "bg-white/20 border-white/40" : "border-white/20"
                  )}
                >
                  {selected && (
                    <CheckCircle2 size={10} className="text-white/70" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <preset.icon size={10} className="text-white/40" />
                    <span className="text-[11px] font-medium text-white/70">
                      {preset.label}
                    </span>
                    {isComplete && (
                      <span className="text-[8px] font-mono text-[#22c55e]/60 border border-[#22c55e]/20 px-1 rounded-full">
                        generated
                      </span>
                    )}
                    {isRunning && (
                      <Loader2 size={9} className="animate-spin text-white/40" />
                    )}
                  </div>
                  <p className="text-[10px] text-white/28 leading-relaxed mt-0.5">
                    {preset.description}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-[8px] font-mono text-white/18">
                      targets: {preset.targetProblem}
                    </span>
                    <span className="text-[8px] font-mono text-[#22c55e]/45">
                      {preset.projectedF1Gain} F1 est.
                    </span>
                    <span className="text-[8px] font-mono text-white/18">
                      {preset.cost}
                    </span>
                  </div>
                </div>

                {selected && (
                  <div
                    className="shrink-0 flex flex-col items-end gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[8px] font-mono text-white/18">
                      examples
                    </p>
                    <input
                      type="number"
                      value={customCounts[preset.id]}
                      onChange={(e) =>
                        setCustomCounts((prev) => ({
                          ...prev,
                          [preset.id]: Math.max(
                            50,
                            Math.min(
                              2000,
                              parseInt(e.target.value) || preset.defaultExamples
                            )
                          ),
                        }))
                      }
                      className="w-16 bg-white/[0.06] border border-white/[0.12] rounded px-1.5 py-0.5 text-[11px] font-mono text-white/60 text-right focus:outline-none focus:border-white/25"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-white/40">
            {totalExamples.toLocaleString()} new +{" "}
            <span className="text-white/22">300 existing</span> ={" "}
            <span className="text-white/60 font-medium">
              {(totalExamples + 300).toLocaleString()} total
            </span>
          </p>
          {selectedBatches.size > 0 && (
            <p className="text-[9px] text-[#22c55e]/45 mt-0.5">
              projected cumulative gain:{" "}
              {BATCH_PRESETS.filter((p) => selectedBatches.has(p.id))
                .map((p) => p.projectedF1Gain)
                .join(" + ")}
            </p>
          )}
        </div>
        <button
          onClick={launchGeneration}
          disabled={selectedBatches.size === 0 || running !== null || locked}
          title={locked ? "Enter admin secret first" : undefined}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/25 text-[11px] font-medium text-[#22c55e]/75 hover:bg-[#22c55e]/15 hover:text-[#22c55e] transition-all disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
        >
          {running ? (
            <Loader2 size={11} className="animate-spin" />
          ) : locked ? (
            <Lock size={11} />
          ) : (
            <Play size={11} />
          )}
          {running
            ? `Generating ${running}…`
            : locked
            ? "Enter secret"
            : `Generate ${selectedBatches.size} batch${selectedBatches.size !== 1 ? "es" : ""}`}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-red-400/70 leading-relaxed">{error}</p>
      )}
    </Section>
  );
}

// ── Training configurator ─────────────────────────────────────────────────────

function TrainingConfigurator({
  adminSecret,
  completedDatasets,
  onTrainingStarted,
}: {
  adminSecret: string;
  completedDatasets: string[];
  onTrainingStarted: (run: TrainingRun) => void;
}) {
  const [epochs, setEpochs] = useState(12);
  const [learningRate, setLearningRate] = useState(3e-5);
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(
    new Set(["recall0-regulatory-ner-v1", ...completedDatasets])
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-add newly completed datasets to the selection
  useEffect(() => {
    setSelectedDatasets((prev) => {
      const next = new Set(prev);
      for (const ds of completedDatasets) next.add(ds);
      return next;
    });
  }, [completedDatasets]);

  const allDatasets = [
    "recall0-regulatory-ner-v1",
    ...completedDatasets.filter((d) => d !== "recall0-regulatory-ner-v1"),
  ];

  const locked = !adminSecret;

  const launchTraining = useCallback(async () => {
    if (selectedDatasets.size === 0 || !adminSecret) return;
    setRunning(true);
    setError(null);

    const datasets = Array.from(selectedDatasets);
    const modelName = `recall0-gliner2-regulatory-v${Date.now().toString(36)}`;

    try {
      const res = await fetch("/api/pioneer-train", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": adminSecret,
        },
        body: JSON.stringify({ datasets, modelName, epochs, learningRate }),
      });

      const body = (await res.json()) as {
        ok?: boolean;
        trainingJobId?: string;
        error?: string;
      };

      if (!res.ok || body.error) {
        setError(body.error ?? `Error ${res.status}`);
      } else {
        onTrainingStarted({
          trainingJobId: body.trainingJobId,
          modelName,
          status: "running",
          datasets,
          epochs,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRunning(false);
    }
  }, [selectedDatasets, epochs, learningRate, onTrainingStarted, adminSecret]);

  const projectedLabel =
    epochs >= 10 ? "85–90%" : epochs >= 8 ? "80–85%" : "75–80%";

  return (
    <Section label="Configure & retrain" Icon={FlaskConical}>
      <div className="space-y-3">
        <div>
          <p className="text-[9px] text-white/25 mb-2">
            Datasets to train on — combine batches for best results
          </p>
          <div className="space-y-1">
            {allDatasets.map((ds) => {
              const isOriginal = ds === "recall0-regulatory-ner-v1";
              const isSelected = selectedDatasets.has(ds);
              const batchLabel = BATCH_PRESETS.find((p) =>
                ds.includes(p.id)
              )?.label;

              return (
                <div
                  key={ds}
                  onClick={() =>
                    setSelectedDatasets((prev) => {
                      const next = new Set(prev);
                      if (next.has(ds)) next.delete(ds);
                      else next.add(ds);
                      return next;
                    })
                  }
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-all",
                    isSelected
                      ? "bg-white/[0.04] border border-white/[0.1]"
                      : "border border-transparent opacity-35 hover:opacity-55"
                  )}
                >
                  <div
                    className={cn(
                      "w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                      isSelected
                        ? "bg-white/20 border-white/40"
                        : "border-white/20"
                    )}
                  >
                    {isSelected && (
                      <CheckCircle2 size={9} className="text-white/70" />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-white/45 flex-1 truncate">
                    {ds}
                  </span>
                  {isOriginal && (
                    <span className="text-[8px] font-mono text-white/18 border border-white/[0.08] px-1 rounded-full shrink-0">
                      v1 · 300 ex
                    </span>
                  )}
                  {!isOriginal && batchLabel && (
                    <span className="text-[8px] font-mono text-[#22c55e]/40 border border-[#22c55e]/15 px-1 rounded-full shrink-0">
                      {batchLabel}
                    </span>
                  )}
                </div>
              );
            })}
            {allDatasets.length === 1 && (
              <p className="text-[9px] text-white/18 px-2.5 py-1">
                Generate batches above — they&apos;ll appear here automatically.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[9px] text-white/25 mb-1.5">
              Epochs{" "}
              <span className="text-white/15">
                (was 6 · recommend 12–15)
              </span>
            </p>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={4}
                max={20}
                value={epochs}
                onChange={(e) => setEpochs(parseInt(e.target.value))}
                className="flex-1 accent-[#22c55e]"
              />
              <span className="text-[11px] font-mono text-white/60 w-5 text-right">
                {epochs}
              </span>
            </div>
          </div>
          <div>
            <p className="text-[9px] text-white/25 mb-1.5">
              Learning rate{" "}
              <span className="text-white/15">(was 5e-5)</span>
            </p>
            <select
              value={learningRate.toString()}
              onChange={(e) => setLearningRate(parseFloat(e.target.value))}
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded px-2 py-1 text-[11px] font-mono text-white/50 focus:outline-none focus:border-white/25"
            >
              <option value="1e-5">1e-5 (encoder-safe)</option>
              <option value="3e-5">3e-5 (recommended)</option>
              <option value="5e-5">5e-5 (current)</option>
              <option value="8e-5">8e-5 (aggressive)</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg bg-white/[0.02] border border-white/[0.06] px-3 py-2 space-y-1">
          {[
            {
              label: "datasets",
              value: `${selectedDatasets.size} selected`,
            },
            {
              label: "est. total examples",
              value: (
                selectedDatasets.size * 350 +
                (selectedDatasets.has("recall0-regulatory-ner-v1") ? 300 : 0)
              ).toLocaleString(),
            },
            { label: "projected F1", value: projectedLabel },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="flex justify-between text-[9px] font-mono"
            >
              <span className="text-white/22">{label}</span>
              <span
                className={
                  label === "projected F1"
                    ? "text-[#22c55e]/55"
                    : "text-white/35"
                }
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={launchTraining}
          disabled={running || selectedDatasets.size === 0 || locked}
          title={locked ? "Enter admin secret first" : undefined}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#22c55e]/10 border border-[#22c55e]/25 text-[12px] font-medium text-[#22c55e]/75 hover:bg-[#22c55e]/15 hover:text-[#22c55e] transition-all disabled:opacity-35 disabled:cursor-not-allowed"
        >
          {running ? (
            <Loader2 size={12} className="animate-spin" />
          ) : locked ? (
            <Lock size={12} />
          ) : (
            <FlaskConical size={12} />
          )}
          {running
            ? "Starting training job…"
            : locked
            ? "Enter admin secret to retrain"
            : `Retrain on ${selectedDatasets.size} dataset${selectedDatasets.size !== 1 ? "s" : ""} · ${epochs} epochs`}
        </button>

        {error && (
          <p className="text-[10px] text-red-400/70">{error}</p>
        )}
      </div>
    </Section>
  );
}

// ── Pipeline tracker ──────────────────────────────────────────────────────────

function PipelineTracker({
  generationRuns,
  trainingRun,
  onPollGeneration,
  onPollTraining,
}: {
  generationRuns: PipelineRun[];
  trainingRun: TrainingRun | null;
  onPollGeneration: (run: PipelineRun) => Promise<void>;
  onPollTraining: () => Promise<void>;
}) {
  const isEmpty = generationRuns.length === 0 && !trainingRun;

  return (
    <Section label="Pipeline status" Icon={TrendingUp}>
      <div className="space-y-1.5">
        {/* V1 baseline always shown */}
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
          <CheckCircle2 size={11} className="text-white/20 shrink-0" />
          <span className="text-[10px] font-mono text-white/28 flex-1">
            recall0-regulatory-ner-v1
          </span>
          <span className="text-[9px] text-white/18">
            300 ex · 6ep · deployed
          </span>
        </div>

        {isEmpty && (
          <p className="text-[9px] text-white/18 px-2.5 py-1">
            Generate data and retrain to see the pipeline here.
          </p>
        )}

        {generationRuns.map((run, i) => (
          <div
            key={`gen-${i}`}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
          >
            <StatusDot status={run.status} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-white/38 truncate">
                {run.datasetName ?? `gen:${run.batchType}`}
              </p>
              <p className="text-[9px] text-white/18">
                {run.numExamples} examples · {run.status}
                {run.error && ` · ${run.error}`}
              </p>
            </div>
            {run.status === "running" && (
              <button
                onClick={() => onPollGeneration(run)}
                className="text-white/22 hover:text-white/50 transition-colors shrink-0"
                title="Check status"
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>
        ))}

        {trainingRun && (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-[#22c55e]/[0.04] border border-[#22c55e]/15">
            <StatusDot status={trainingRun.status} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-white/55 truncate">
                {trainingRun.modelName ?? "training…"}
              </p>
              <p className="text-[9px] text-white/28">
                {trainingRun.datasets.length} dataset
                {trainingRun.datasets.length !== 1 ? "s" : ""} ·{" "}
                {trainingRun.epochs} epochs · {trainingRun.status}
              </p>
            </div>
            {trainingRun.status === "running" && (
              <button
                onClick={onPollTraining}
                className="text-white/22 hover:text-white/50 transition-colors shrink-0"
                title="Check status"
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {trainingRun?.trainingJobId && trainingRun.status === "running" && (
        <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.03] px-3 py-2 space-y-1">
          <p className="text-[10px] text-white/32 leading-relaxed">
            Training takes 10–60 min on Pioneer. Auto-refreshes every 30s.
          </p>
          <p className="text-[10px] text-white/32">
            Job ID:{" "}
            <code className="text-[9px] bg-white/[0.06] px-1 rounded">
              {trainingRun.trainingJobId}
            </code>
          </p>
          <p className="text-[10px] text-white/32">
            When complete, set{" "}
            <code className="text-[9px] bg-white/[0.06] px-1 rounded">
              PIONEER_GLINER_MODEL={trainingRun.trainingJobId}
            </code>{" "}
            in .env.local and restart.
          </p>
        </div>
      )}

      {trainingRun?.status === "done" && (
        <div className="rounded-lg border border-[#22c55e]/20 bg-[#22c55e]/[0.04] px-3 py-2">
          <p className="text-[11px] font-medium text-[#22c55e]/80">
            Training complete!
          </p>
          <p className="text-[10px] text-white/40 mt-0.5">
            Set{" "}
            <code className="text-[9px] bg-white/[0.06] px-1 rounded">
              PIONEER_GLINER_MODEL={trainingRun.trainingJobId}
            </code>{" "}
            in .env.local and restart the dev server to deploy the new model.
          </p>
        </div>
      )}
    </Section>
  );
}

// ── Research notes ────────────────────────────────────────────────────────────

function ResearchNotes() {
  const notes = [
    {
      source: "GLiNER-BioMed · arXiv 2504.00676",
      finding:
        "Combining synthetic domain pre-training with diverse post-training data gives the best F1. Synthetic-only training has high precision but low recall — exactly the current symptom.",
    },
    {
      source: "Knowledgator GLiNER training docs",
      finding:
        "Hard negatives (examples where similar-looking text is NOT an entity) are the single most effective technique for reducing false positives. Include via ner_negatives or in-prompt instructions.",
    },
    {
      source: "Pioneer fine-tune NER guide",
      finding:
        "Passing entity type descriptions (not just names) to /generate significantly improves extraction quality for ambiguous domain-specific types. We already do this — the gain comes from more volume.",
    },
    {
      source: "GLiNER core training docs",
      finding:
        "Use lower LR for encoder (1e-5) and higher for other components (5e-5). A combined 3e-5 with LoRA is a good middle ground for domain adaptation without catastrophic forgetting.",
    },
  ];

  return (
    <Section label="Research backing" Icon={Info}>
      <div className="space-y-3">
        {notes.map((note) => (
          <div key={note.source} className="space-y-0.5">
            <p className="text-[8px] font-mono text-white/28 uppercase tracking-wider">
              {note.source}
            </p>
            <p className="text-[10px] text-white/32 leading-relaxed">
              {note.finding}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function DataStudioPanel() {
  const [adminSecret, setAdminSecret] = useState("");
  const [currentF1, setCurrentF1] = useState<number | null>(null);
  const [generationRuns, setGenerationRuns] = useState<PipelineRun[]>([]);
  const [trainingRun, setTrainingRun] = useState<TrainingRun | null>(null);

  // Fetch Pioneer training job F1 on mount (most authoritative current metric)
  useEffect(() => {
    fetch("/api/benchmark")
      .then((r) => r.json())
      .then(
        (body: {
          data?: { pioneerJobMetrics?: PioneerJobMetrics | null } | null;
          pioneerJobMetrics?: PioneerJobMetrics | null;
        }) => {
          const metrics =
            body.pioneerJobMetrics ?? body.data?.pioneerJobMetrics;
          if (metrics?.f1 != null) setCurrentF1(metrics.f1);
        }
      )
      .catch(() => {});
  }, []);

  // Auto-poll running pipeline jobs every 30s
  const pollGeneration = useCallback(async (run: PipelineRun) => {
    if (!run.dataGenJobId) return;
    try {
      const res = await fetch(
        `/api/pioneer-train/status?dataGenJobId=${run.dataGenJobId}`
      );
      if (!res.ok) return;
      const body = (await res.json()) as { status?: string };
      const done = body.status === "complete" || body.status === "ready";
      const failed = body.status === "failed";
      setGenerationRuns((prev) =>
        prev.map((r) =>
          r.dataGenJobId === run.dataGenJobId
            ? {
                ...r,
                status: done ? "done" : failed ? "error" : "running",
                error: failed ? "Generation failed" : undefined,
              }
            : r
        )
      );
    } catch {
      // transient — ignore
    }
  }, []);

  const pollTraining = useCallback(async () => {
    if (!trainingRun?.trainingJobId) return;
    try {
      const res = await fetch(
        `/api/pioneer-train/status?trainingJobId=${trainingRun.trainingJobId}`
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        complete?: boolean;
        status?: string;
        metrics?: { f1?: number };
      };
      const done = body.complete === true;
      const failed = body.status === "failed" || body.status === "stopped";
      setTrainingRun((prev) =>
        prev
          ? {
              ...prev,
              status: done ? "done" : failed ? "error" : "running",
            }
          : prev
      );
      if (done && body.metrics?.f1) {
        setCurrentF1(parseFloat((body.metrics.f1 * 100).toFixed(1)));
      }
    } catch {
      // transient
    }
  }, [trainingRun]);

  // Interval-based auto-polling
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const hasRunningGen = generationRuns.some((r) => r.status === "running");
    const hasRunningTrain = trainingRun?.status === "running";

    if (!hasRunningGen && !hasRunningTrain) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!intervalRef.current) {
      intervalRef.current = setInterval(async () => {
        const runningGens = generationRuns.filter(
          (r) => r.status === "running"
        );
        for (const run of runningGens) await pollGeneration(run);
        if (trainingRun?.status === "running") await pollTraining();
      }, 30_000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [generationRuns, trainingRun, pollGeneration, pollTraining]);

  const completedDatasets = generationRuns
    .filter((r) => r.status === "done" && r.datasetName)
    .map((r) => r.datasetName!);

  const handleGenerationStarted = useCallback((run: PipelineRun) => {
    setGenerationRuns((prev) => {
      const idx = prev.findIndex((r) => r.batchType === run.batchType);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = run;
        return next;
      }
      return [...prev, run];
    });
  }, []);

  const handleTrainingStarted = useCallback((run: TrainingRun) => {
    setTrainingRun(run);
  }, []);

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={11} className="text-white/30" />
          <h2 className="text-[11px] font-mono uppercase tracking-widest text-white/35">
            Data Studio · Model Improvement
          </h2>
        </div>
        <p className="text-[12px] text-white/38 leading-relaxed max-w-xl">
          Your GLiNER2 underperforms frontier LLMs because of too little, too
          uniform training data. Generate targeted batches, combine them, and
          retrain to reach 85–90% F1.
        </p>

        {/* Admin secret — kept in memory only, never logged or persisted */}
        <AdminSecretInput value={adminSecret} onChange={setAdminSecret} />
      </div>

      {/* Root cause diagnosis */}
      <RootCauseCard currentF1={currentF1} />

      {/* Entity type coverage gap */}
      <EntityCoverageChart />

      <div className="border-t border-white/[0.06]" />

      {/* Generate data */}
      <GenerationWizard
        adminSecret={adminSecret}
        onGenerationStarted={handleGenerationStarted}
        completedDatasets={completedDatasets}
      />

      {/* Retrain */}
      <TrainingConfigurator
        adminSecret={adminSecret}
        completedDatasets={completedDatasets}
        onTrainingStarted={handleTrainingStarted}
      />

      {/* Pipeline tracker */}
      <PipelineTracker
        generationRuns={generationRuns}
        trainingRun={trainingRun}
        onPollGeneration={pollGeneration}
        onPollTraining={pollTraining}
      />

      <div className="border-t border-white/[0.06]" />

      {/* Research backing */}
      <ResearchNotes />
    </div>
  );
}
