import { NextRequest, NextResponse } from "next/server";
import { searchRegulatoryCorpus } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/corpus-search?q=nitrates+processed+meats&limit=8
 *
 * Full-text search across the accumulated regulatory monitoring corpus.
 * Returns the most recent matching documents with entity JSON for LLM grounding.
 */
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "8"), 20);

  if (!query.trim()) {
    return NextResponse.json({ error: "q param required" }, { status: 400 });
  }

  const results = await searchRegulatoryCorpus(query, limit);

  return NextResponse.json({
    clickhouse_ready: true,
    results,
    query,
  });
}
