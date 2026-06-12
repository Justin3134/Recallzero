import "server-only";
import { NextRequest, NextResponse } from "next/server";

const PIONEER_BASE = "https://api.pioneer.ai";

function pioneerHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.PIONEER_API_KEY ?? "",
  };
}

/**
 * GET /api/pioneer-train/status
 *
 * Query params:
 *   dataGenJobId   - poll a data generation job
 *   trainingJobId  - poll a training job (returns metrics when complete)
 *   datasetName    - poll dataset readiness
 *   modelId        - spot-check inference on a trained model
 */
export async function GET(req: NextRequest) {
  if (!process.env.PIONEER_API_KEY) {
    return NextResponse.json({ error: "Pioneer not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const dataGenJobId = searchParams.get("dataGenJobId");
  const trainingJobId = searchParams.get("trainingJobId");
  const datasetName = searchParams.get("datasetName");
  const modelId = searchParams.get("modelId");

  try {
    // Poll data generation job
    if (dataGenJobId) {
      const res = await fetch(
        `${PIONEER_BASE}/generate/jobs/${dataGenJobId}`,
        { headers: pioneerHeaders() }
      );
      if (!res.ok) {
        return NextResponse.json({ error: `Pioneer returned ${res.status}` }, { status: 502 });
      }
      const data = await res.json();
      return NextResponse.json({ type: "dataGen", ...data });
    }

    // Poll training job
    if (trainingJobId) {
      const res = await fetch(
        `${PIONEER_BASE}/felix/training-jobs/${trainingJobId}`,
        { headers: pioneerHeaders() }
      );
      if (!res.ok) {
        return NextResponse.json({ error: `Pioneer returned ${res.status}` }, { status: 502 });
      }
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        metrics?: { f1?: number; precision?: number; recall?: number };
      };
      return NextResponse.json({
        type: "training",
        trainingJobId,
        status: data.status,
        metrics: data.metrics ?? null,
        complete: data.status === "complete" || data.status === "deployed",
      });
    }

    // Poll dataset readiness
    if (datasetName) {
      const res = await fetch(
        `${PIONEER_BASE}/felix/datasets/${datasetName}`,
        { headers: pioneerHeaders() }
      );
      if (!res.ok) {
        return NextResponse.json({ error: `Pioneer returned ${res.status}` }, { status: 502 });
      }
      const data = await res.json();
      return NextResponse.json({ type: "dataset", datasetName, ...data });
    }

    // Run a spot-check inference to verify the fine-tuned model works
    if (modelId) {
      const testText =
        "The FTC issued an enforcement action against NutriSupps LLC for making unsubstantiated claims " +
        "that their keto supplement 'burns fat instantly'. The company must pay $2.5M in civil penalties " +
        "and add clear disclosure labels to all products sold in the United States by June 1, 2025.";

      const [fineRes, baseRes] = await Promise.all([
        fetch(`${PIONEER_BASE}/inference`, {
          method: "POST",
          headers: pioneerHeaders(),
          body: JSON.stringify({
            model_id: modelId,
            text: testText,
            schema: {
              entities: [
                "regulation_name", "regulated_substance", "agency", "deadline",
                "penalty", "affected_product_category", "jurisdiction", "prohibited_claim",
              ],
            },
            threshold: 0.4,
          }),
        }),
        fetch(`${PIONEER_BASE}/inference`, {
          method: "POST",
          headers: pioneerHeaders(),
          body: JSON.stringify({
            model_id: "fastino/gliner2-base-v1",
            text: testText,
            schema: {
              entities: [
                "regulation_name", "regulated_substance", "agency", "deadline",
                "penalty", "affected_product_category", "jurisdiction", "prohibited_claim",
              ],
            },
            threshold: 0.4,
          }),
        }),
      ]);

      const [fineData, baseData] = await Promise.all([
        fineRes.ok ? fineRes.json() : null,
        baseRes.ok ? baseRes.json() : null,
      ]);

      function parseEntities(raw: unknown): Array<{ label: string; text: string; score: number }> {
        const data = raw as {
          result?: { data?: { entities?: Record<string, Array<{ text: string; confidence?: number }>> } };
          entities?: Array<{ label: string; text: string; score?: number }>;
        } | null;
        if (!data) return [];
        // New nested format: result.data.entities is a dict keyed by entity type
        const nested = data.result?.data?.entities;
        if (nested) {
          return Object.entries(nested).flatMap(([label, spans]) =>
            spans.map((s) => ({ label, text: s.text, score: s.confidence ?? 0 }))
          );
        }
        // Legacy flat array
        return (data.entities ?? []).map((e) => ({ label: e.label, text: e.text, score: e.score ?? 0 }));
      }

      return NextResponse.json({
        type: "spotCheck",
        testText,
        fineTuned: {
          modelId,
          entities: parseEntities(fineData),
        },
        base: {
          modelId: "fastino/gliner2-base-v1",
          entities: parseEntities(baseData),
        },
      });
    }

    return NextResponse.json(
      { error: "Provide one of: dataGenJobId, trainingJobId, datasetName, modelId" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Pioneer status route failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
