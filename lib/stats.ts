import { severityConfig } from "@/lib/severity";
import type { Alert } from "@/types";

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 28,
  high: 14,
  medium: 6,
  low: 2,
};

export interface DashboardStats {
  thisWeekCount: number;
  lastWeekCount: number;
  criticalUnresolved: number;
  riskScore: number;
  sparkline: number[];
  topAgencies: [string, { count: number; worst: number }][];
  trend: "up" | "down" | "flat";
}

export function computeDashboardStats(alerts: Alert[]): DashboardStats {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const twoWeeksAgo = now - 14 * 24 * 3600 * 1000;

  const thisWeek = alerts.filter((a) => new Date(a.created_at).getTime() >= weekAgo);
  const lastWeek = alerts.filter((a) => {
    const t = new Date(a.created_at).getTime();
    return t >= twoWeeksAgo && t < weekAgo;
  });
  const criticalUnresolved = alerts.filter(
    (a) => a.severity === "critical" && !a.is_read
  ).length;

  const riskScore = Math.min(
    100,
    thisWeek.reduce((acc, a) => acc + (SEVERITY_WEIGHT[a.severity] ?? 4), 0)
  );

  const sparkline = Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (6 - i + 1) * 24 * 3600 * 1000;
    const dayEnd = now - (6 - i) * 24 * 3600 * 1000;
    return alerts
      .filter((a) => {
        const t = new Date(a.created_at).getTime();
        return t >= dayStart && t < dayEnd;
      })
      .reduce((acc, a) => acc + (SEVERITY_WEIGHT[a.severity] ?? 4), 0);
  });

  const agencyActivity = new Map<string, { count: number; worst: number }>();
  for (const a of thisWeek) {
    const cur = agencyActivity.get(a.agency) ?? { count: 0, worst: 3 };
    cur.count += 1;
    cur.worst = Math.min(cur.worst, severityConfig(a.severity).rank);
    agencyActivity.set(a.agency, cur);
  }
  const topAgencies = Array.from(agencyActivity.entries())
    .sort((a, b) => b[1].count - a[1].count || a[1].worst - b[1].worst)
    .slice(0, 3);

  const trend =
    thisWeek.length > lastWeek.length
      ? ("up" as const)
      : thisWeek.length < lastWeek.length
        ? ("down" as const)
        : ("flat" as const);

  return {
    thisWeekCount: thisWeek.length,
    lastWeekCount: lastWeek.length,
    criticalUnresolved,
    riskScore,
    sparkline,
    topAgencies,
    trend,
  };
}
