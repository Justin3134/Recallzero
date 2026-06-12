import { NextRequest, NextResponse } from "next/server";
import { queryRecallsByState } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recall-states?productType=Food&terms=sodium+benzoate,titanium+dioxide
 *
 * Returns per-US-state recall counts + risk scores for geographic heatmap rendering.
 * Feeds into the USStateMap component to show where enforcement is concentrated.
 */
export async function GET(req: NextRequest) {
  const productType = req.nextUrl.searchParams.get("productType") ?? "";
  const rawTerms = req.nextUrl.searchParams.get("terms") ?? "";
  const terms = rawTerms
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

  const data = await queryRecallsByState(productType, terms);

  if (!data.length) {
    return NextResponse.json({ clickhouse_ready: false, data: [] });
  }

  return NextResponse.json({ clickhouse_ready: true, data });
}
