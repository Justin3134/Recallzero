import { NextRequest, NextResponse } from "next/server";
import { queryMonitorStats } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/monitor-stats?days=30
 *
 * Returns production GLiNER2 telemetry from the monitor_runs ClickHouse table:
 * total runs, alert rate, p50/p99 latency, token savings, and intelligence corpus size.
 */
export async function GET(req: NextRequest) {
  const days = Math.min(
    365,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "30"))
  );

  const stats = await queryMonitorStats(days);

  if (!stats) {
    return NextResponse.json(
      { clickhouse_ready: false },
      { status: 200 }
    );
  }

  return NextResponse.json({ clickhouse_ready: true, ...stats, days });
}
