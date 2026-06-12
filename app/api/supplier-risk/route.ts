import { NextRequest, NextResponse } from "next/server";
import { querySupplierFirmRisk } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/supplier-risk?firms=kraft,general+mills,kellogg
 *
 * Cross-references brand/firm names against FDA recalling_firm field.
 * Surfaces supply-chain risk: "Your manufacturer had 3 Class I recalls last year."
 */
export async function GET(req: NextRequest) {
  const rawFirms = req.nextUrl.searchParams.get("firms") ?? "";
  const firms = rawFirms
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 2)
    .slice(0, 10);

  if (!firms.length) {
    return NextResponse.json({ error: "firms param required" }, { status: 400 });
  }

  const matches = await querySupplierFirmRisk(firms);

  return NextResponse.json({
    clickhouse_ready: true,
    matches,
    searched_firms: firms,
  });
}
