import { NextResponse } from "next/server";
import { queryRegulatoryVelocity } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/regulatory-velocity
 *
 * Compares 30-day recall rate vs prior 90-day baseline per product type.
 * Detects enforcement spikes before they become compliance emergencies.
 */
export async function GET() {
  const velocity = await queryRegulatoryVelocity();

  if (!velocity.length) {
    return NextResponse.json({ clickhouse_ready: false, data: [] });
  }

  return NextResponse.json({ clickhouse_ready: true, data: velocity });
}
