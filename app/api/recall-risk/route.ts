import { NextRequest, NextResponse } from "next/server";
import { queryRecallRisk } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recall-risk?terms=sodium+benzoate,titanium+dioxide,food+dye
 *
 * Queries ClickHouse fda_recalls for products matching any of the given terms.
 * Returns Class I/II/III breakdown, YoY trend, most recent incident, and top reason.
 */
export async function GET(req: NextRequest) {
  const rawTerms = req.nextUrl.searchParams.get("terms") ?? "";
  const terms = rawTerms
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
    .slice(0, 10);

  if (!terms.length) {
    return NextResponse.json({ error: "terms param required" }, { status: 400 });
  }

  const result = await queryRecallRisk(terms);

  if (!result) {
    return NextResponse.json(
      { clickhouse_ready: false, message: "ClickHouse not configured or no data found" },
      { status: 200 }
    );
  }

  return NextResponse.json({ clickhouse_ready: true, ...result });
}
