import "server-only";
import { NextRequest, NextResponse } from "next/server";
import {
  runBenchmark,
  fetchPioneerJobMetrics,
  type BenchmarkResults,
} from "@/lib/benchmark-eval";

const BASE_GLINER_MODEL = "fastino/gliner2-base-v1";

// Module-level cache — survives within a single serverless cold-start.
// Good enough for an admin-triggered benchmark that runs infrequently.
let cached: { results: BenchmarkResults; ts: number } | null = null;

/**
 * GET /api/benchmark
 *
 * Returns cached comparison results (if any) PLUS fresh Pioneer training-job
 * metrics (fetched on every GET since they're cheap and authoritative).
 * Returns { data: null } for comparison results if no POST has been run yet.
 */
export async function GET() {
  if (!process.env.PIONEER_API_KEY) {
    return NextResponse.json({ error: "Pioneer not configured" }, { status: 503 });
  }

  const fineTunedModelId = process.env.PIONEER_GLINER_MODEL ?? BASE_GLINER_MODEL;
  const hasFineTunedModel = fineTunedModelId !== BASE_GLINER_MODEL;

  // Always fetch live Pioneer training-job metrics — they're cheap (single GET)
  // and are the most authoritative signal we have for the fine-tuned model.
  const pioneerJobMetrics = hasFineTunedModel
    ? await fetchPioneerJobMetrics(fineTunedModelId)
    : null;

  if (!cached) {
    return NextResponse.json({ data: null, pioneerJobMetrics });
  }

  // Merge freshly fetched job metrics into the cached comparison results
  const data: BenchmarkResults = { ...cached.results, pioneerJobMetrics };
  return NextResponse.json({ data, cachedAt: new Date(cached.ts).toISOString() });
}

/**
 * POST /api/benchmark
 *
 * Runs a full live evaluation across all models on the 25-example labeled set.
 * Requires `x-admin-secret` header matching ADMIN_SECRET env var.
 *
 * Runs all models in parallel; expect ~15–60s total.
 */
export async function POST(req: NextRequest) {
  if (!process.env.PIONEER_API_KEY) {
    return NextResponse.json({ error: "Pioneer not configured" }, { status: 503 });
  }

  const secret = req.headers.get("x-admin-secret");
  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runBenchmark();
    cached = { results, ts: Date.now() };
    return NextResponse.json({ data: results, cachedAt: new Date(cached.ts).toISOString() });
  } catch (err) {
    console.error("Benchmark run failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Benchmark failed" },
      { status: 500 }
    );
  }
}
