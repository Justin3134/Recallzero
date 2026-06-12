import Link from "next/link";
import { getScans, getSessionCompany } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { FileSearch, ArrowRight, Plus } from "lucide-react";
import { severityConfig, timeAgo } from "@/lib/severity";
import type { DocumentScan } from "@/types";

export const metadata = { title: "Dashboard — Recall0" };

const RISK_COLOR: Record<string, string> = {
  pass: "#22c55e",
  review: "#eab308",
  fail: "#ef4444",
};

function ScanRow({ scan }: { scan: DocumentScan }) {
  const color = RISK_COLOR[scan.overall_risk] ?? RISK_COLOR.review;
  const critical = scan.findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl border border-border bg-card hover:bg-card/80 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{scan.file_name}</p>
        {scan.summary && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{scan.summary}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {critical > 0 && (
          <span className="text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">
            {critical} issue{critical !== 1 ? "s" : ""}
          </span>
        )}
        <span
          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
          style={{ color, backgroundColor: `${color}1a` }}
        >
          {scan.overall_risk.toUpperCase()}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono w-14 text-right">
          {timeAgo(scan.created_at)}
        </span>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const { company } = await getSessionCompany();
  if (!company) return null;

  const scans = await getScans(company.id);
  const recentScans = scans.slice(0, 8);

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{company.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {company.industry} · {company.jurisdictions?.join(", ")}
          </p>
        </div>
        <Link href="/scan">
          <Button className="bg-foreground hover:bg-foreground/90 text-background font-semibold h-9 text-sm">
            <Plus size={14} /> New check
          </Button>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/scan"
          className="group rounded-xl border border-border bg-card p-5 hover:border-zinc-600 transition-colors flex items-start gap-4"
        >
          <div className="w-10 h-10 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
            <FileSearch size={18} className="text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Scan a document</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload a label, agreement, or spec sheet to audit it against live regulations.
            </p>
          </div>
          <ArrowRight
            size={14}
            className="text-muted-foreground shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
          />
        </Link>

        <Link
          href="/onboarding"
          className="group rounded-xl border border-border bg-card p-5 hover:border-zinc-600 transition-colors flex items-start gap-4"
        >
          <div className="w-10 h-10 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
            <Plus size={18} className="text-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Check a URL</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter any website and get an instant compliance check for its products.
            </p>
          </div>
          <ArrowRight
            size={14}
            className="text-muted-foreground shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </div>

      {/* Recent scans */}
      {recentScans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Recent document scans</h2>
            {scans.length > 8 && (
              <Link
                href="/scan"
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight size={11} />
              </Link>
            )}
          </div>
          <div className="space-y-2">
            {recentScans.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </div>
        </div>
      )}

      {recentScans.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <FileSearch size={24} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No scans yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-5">
            Upload a document or check a URL to get started.
          </p>
          <Link href="/scan">
            <Button size="sm" className="bg-foreground hover:bg-foreground/90 text-background font-semibold">
              <FileSearch size={13} /> Scan a document
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
