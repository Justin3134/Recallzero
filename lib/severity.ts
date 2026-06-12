import type { Severity } from "@/types";

export const SEVERITY_CONFIG: Record<
  Severity,
  { color: string; label: string; bg: string; rank: number }
> = {
  critical: { color: "#ef4444", label: "CRITICAL", bg: "bg-red-500/10", rank: 0 },
  high: { color: "#f97316", label: "HIGH", bg: "bg-orange-500/10", rank: 1 },
  medium: { color: "#eab308", label: "MEDIUM", bg: "bg-yellow-500/10", rank: 2 },
  low: { color: "#22c55e", label: "LOW", bg: "bg-green-500/10", rank: 3 },
};

export function severityConfig(severity: string) {
  return SEVERITY_CONFIG[(severity as Severity) in SEVERITY_CONFIG ? (severity as Severity) : "medium"];
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
