import { NextRequest, NextResponse } from "next/server";
import { queryRegulatoryTrends } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/regulatory-trends?productType=Food&months=24
 *
 * Returns monthly recall counts from fda_recalls, filtered by product type.
 * Used by RegulatoryTrendsTab to render time-series charts.
 */
export async function GET(req: NextRequest) {
  const productType = req.nextUrl.searchParams.get("productType") ?? "";
  const months = Math.min(
    60,
    Math.max(6, parseInt(req.nextUrl.searchParams.get("months") ?? "24"))
  );

  const data = await queryRegulatoryTrends(productType, months);

  if (!data.length) {
    return NextResponse.json(
      { clickhouse_ready: false, data: [] },
      { status: 200 }
    );
  }

  return NextResponse.json({ clickhouse_ready: true, data });
}
