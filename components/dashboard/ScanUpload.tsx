"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File as FileIcon,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { severityConfig, timeAgo } from "@/lib/severity";
import type { DocumentScan, Finding } from "@/types";

const SCAN_STAGES = [
  "Extracting text...",
  "Searching live regulations...",
  "Auditing against current standards...",
];

const RISK_CONFIG = {
  pass: {
    label: "PASS",
    color: "#22c55e",
    icon: CheckCircle2,
    blurb: "No material compliance issues detected",
  },
  review: {
    label: "REVIEW",
    color: "#eab308",
    icon: AlertTriangle,
    blurb: "Issues found that need human review",
  },
  fail: {
    label: "FAIL",
    color: "#ef4444",
    icon: XCircle,
    blurb: "Likely compliance violations detected",
  },
} as const;

interface AuditResult {
  overall_risk: keyof typeof RISK_CONFIG;
  risk_score: number;
  findings: Finding[];
  regulations_checked: string[];
  summary: string;
  file_name: string;
}

function fileIcon(type: string) {
  if (type === "pdf") return FileText;
  if (type === "image") return ImageIcon;
  if (type === "csv") return FileSpreadsheet;
  return FileIcon;
}

export function ScanUpload({ recentScans }: { recentScans: DocumentScan[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState<string | null>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    };
  }, []);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setScanning(file.name);
    setStageIdx(0);
    stageTimer.current = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, SCAN_STAGES.length - 1));
    }, 4000);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/scan", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Scan failed. Try a different file.");
      } else {
        setResult({
          overall_risk: (data.audit?.overall_risk ?? "review") as keyof typeof RISK_CONFIG,
          risk_score: data.audit?.risk_score ?? 50,
          findings: data.audit?.findings ?? [],
          regulations_checked: data.audit?.regulations_checked ?? [],
          summary: data.audit?.summary ?? "",
          file_name: file.name,
        });
        router.refresh();
      }
    } catch {
      setError("Scan failed. Check your connection and try again.");
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setScanning(null);
    }
  }

  function viewPastScan(scan: DocumentScan) {
    setError(null);
    setResult({
      overall_risk: (scan.overall_risk ?? "review") as keyof typeof RISK_CONFIG,
      risk_score: scan.risk_score ?? 50,
      findings: scan.findings ?? [],
      regulations_checked: scan.regulations_checked ?? [],
      summary: scan.summary ?? "",
      file_name: scan.file_name,
    });
  }

  const risk = result ? RISK_CONFIG[result.overall_risk] ?? RISK_CONFIG.review : null;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Left: upload + recent */}
      <div className="space-y-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !scanning) handleFile(file);
          }}
          onClick={() => !scanning && inputRef.current?.click()}
          className={cn(
            "relative rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-all min-h-64 flex flex-col items-center justify-center overflow-hidden",
            dragging
              ? "border-zinc-600 bg-white/5"
              : "border-border bg-transparent hover:border-zinc-600",
            scanning && "pointer-events-none"
          )}
        >
          {scanning ? (
            <>
              <div className="scanner-line" />
              <FileText size={34} className="text-foreground mb-4 animate-pulse" />
              <p className="font-semibold text-sm mb-1 max-w-full truncate px-4">
                {scanning}
              </p>
              <p className="text-xs text-muted-foreground font-mono h-4">
                {SCAN_STAGES[stageIdx]}
              </p>
              <div className="mt-5 flex gap-1.5">
                {SCAN_STAGES.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 w-10 rounded-full transition-colors duration-500",
                      i <= stageIdx ? "bg-foreground" : "bg-border"
                    )}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <UploadCloud size={34} className="text-muted-foreground mb-4" />
              <p className="font-semibold text-sm mb-1">
                Drop your product label, agreement, spec sheet, or ingredient list
              </p>
              <p className="text-xs text-muted-foreground mb-5">
                Audited against live regulatory standards in real time
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                {["PDF", "PNG", "JPG", "DOCX", "CSV", "TXT"].map((t) => (
                  <span key={t} className="border border-border rounded px-1.5 py-0.5">
                    {t}
                  </span>
                ))}
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.csv,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
            {error}
          </p>
        )}

        {recentScans.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3">Recent scans</h3>
            <div className="space-y-1">
              {recentScans.slice(0, 6).map((scan) => {
                const Icon = fileIcon(scan.file_type);
                const rc = RISK_CONFIG[scan.overall_risk as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.review;
                return (
                  <button
                    key={scan.id}
                    onClick={() => viewPastScan(scan)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-secondary/40 transition-colors text-left"
                  >
                    <Icon size={15} className="text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1 truncate">{scan.file_name}</span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ color: rc.color, backgroundColor: `${rc.color}1a` }}
                    >
                      {rc.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {timeAgo(scan.created_at)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right: result panel */}
      <div>
        {result && risk ? (
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-extrabold text-lg tracking-tight"
                style={{ color: risk.color, backgroundColor: `${risk.color}15` }}
              >
                <risk.icon size={22} />
                {risk.label}
              </div>
              <div className="text-right">
                <p className="text-3xl font-extrabold" style={{ color: risk.color }}>
                  {result.risk_score}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground uppercase">
                  Risk score
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground font-mono truncate mb-2">
                {result.file_name}
              </p>
              <p className="text-sm text-foreground">{result.summary || risk.blurb}</p>
            </div>

            {result.findings.length > 0 ? (
              <div className="space-y-3">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Findings ({result.findings.length})
                </p>
                {result.findings.map((f, i) => {
                  const sev = severityConfig(f.severity);
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-background p-3.5 space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: sev.color }}
                        />
                        <p className="text-sm font-semibold flex-1">{f.issue}</p>
                        <span
                          className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0", sev.bg)}
                          style={{ color: sev.color }}
                        >
                          {sev.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{f.regulation}</p>
                      {f.location && (
                        <p className="text-xs text-muted-foreground">
                          <span className="text-foreground/70">Where:</span> {f.location}
                        </p>
                      )}
                      <p className="text-xs text-foreground/90 bg-foreground/5 border border-foreground/10 rounded px-2 py-1.5 mt-1">
                        {f.recommendation}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No findings — this document looks clean against the standards checked.
              </p>
            )}

            {result.regulations_checked.length > 0 && (
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                  Regulations checked
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.regulations_checked.map((r) => (
                    <span
                      key={r}
                      className="text-[11px] bg-secondary text-muted-foreground px-2 py-0.5 rounded"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border h-full min-h-64 flex flex-col items-center justify-center text-center p-10">
            <FileText size={26} className="text-muted-foreground mb-3" />
            <p className="text-sm font-medium">Audit results appear here</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-60">
              Upload a document and Recall0 will audit it against live regulatory standards.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
