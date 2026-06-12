import "server-only";

const PIONEER_BASE = "https://api.pioneer.ai";

/**
 * The GLiNER model used for regulatory entity extraction.
 * Defaults to the base model; swap in a fine-tuned job ID via PIONEER_GLINER_MODEL
 * once training completes.
 */
const GLINER_MODEL =
  process.env.PIONEER_GLINER_MODEL ?? "fastino/gliner2-base-v1";

function pioneerHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.PIONEER_API_KEY ?? "",
  };
}

export interface RegulatoryEntities {
  inferenceId: string;
  entities: Record<string, string[]>;
  classifications: Record<string, string>;
  /** Chars in the raw text vs chars in the structured summary (for token savings display). */
  rawChars: number;
  /** Compact, structured summary built from extracted entities — passed to the LLM instead of raw text. */
  structuredSummary: string;
}

/**
 * Extract regulatory entities from raw text using GLiNER2 via Pioneer's native
 * /inference endpoint (NOT the OpenAI-compatible chat endpoint).
 *
 * GLiNER2 handles NER and classification in a single forward pass —
 * deterministic outputs with confidence scores, ~200ms, at $0.15/1M tokens.
 * The LLM only sees the compact structuredSummary, not raw text, cutting
 * token costs by ~60%.
 */
export async function extractRegulatoryEntities(
  text: string
): Promise<RegulatoryEntities | null> {
  if (!process.env.PIONEER_API_KEY) return null;
  const sliced = text.slice(0, 8000);
  try {
    const res = await fetch(`${PIONEER_BASE}/inference`, {
      method: "POST",
      headers: pioneerHeaders(),
      body: JSON.stringify({
        model_id: GLINER_MODEL,
        text: sliced,
        schema: {
          entities: [
            "regulation_name",
            "regulated_substance",
            "agency",
            "deadline",
            "penalty",
            "affected_product_category",
            "jurisdiction",
            "prohibited_claim",
          ],
          classifications: [
            {
              task: "severity",
              labels: ["critical", "high", "medium", "low"],
            },
            {
              task: "action_type",
              labels: [
                "ban",
                "labeling_requirement",
                "disclosure",
                "recall",
                "guidance",
                "enforcement_action",
              ],
            },
          ],
        },
        threshold: 0.4,
      }),
    });

    if (!res.ok) {
      console.warn(
        `Pioneer /inference failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`
      );
      return null;
    }

    const raw = await res.json() as {
      inference_id?: string;
      id?: string;
      result?: { data?: Record<string, unknown> };
      // Legacy flat formats
      entities?: Array<{ label: string; text: string; score?: number }>;
      classifications?: Array<{ task: string; label: string; score?: number }>;
    };

    const inferenceId = raw.inference_id ?? raw.id ?? "";
    const resultData = raw.result?.data as Record<string, unknown> | undefined;

    const entities: Record<string, string[]> = {};
    const classifications: Record<string, string> = {};

    if (resultData) {
      // Current Pioneer format: entities dict + classification keys at top level
      const entitiesDict = resultData.entities as
        | Record<string, Array<{ text: string; confidence?: number }>>
        | undefined;
      for (const [label, spans] of Object.entries(entitiesDict ?? {})) {
        entities[label] = spans.map((s) => s.text);
      }
      for (const task of ["severity", "action_type"]) {
        const c = resultData[task] as { label?: string } | undefined;
        if (c?.label) classifications[task] = c.label;
      }
    } else {
      // Legacy flat-array fallback
      for (const e of raw.entities ?? []) {
        if (!entities[e.label]) entities[e.label] = [];
        entities[e.label].push(e.text);
      }
      for (const c of raw.classifications ?? []) {
        classifications[c.task] = c.label;
      }
    }

    const parts: string[] = [];
    if (entities.agency?.length) parts.push(`Agencies: ${entities.agency.join(", ")}`);
    if (entities.regulation_name?.length) parts.push(`Regulations: ${entities.regulation_name.join(", ")}`);
    if (entities.jurisdiction?.length) parts.push(`Jurisdictions: ${entities.jurisdiction.join(", ")}`);
    if (entities.deadline?.length) parts.push(`Deadlines: ${entities.deadline.join(", ")}`);
    if (entities.penalty?.length) parts.push(`Penalties: ${entities.penalty.join(", ")}`);
    if (entities.affected_product_category?.length)
      parts.push(`Affected categories: ${entities.affected_product_category.join(", ")}`);
    if (entities.prohibited_claim?.length)
      parts.push(`Prohibited claims: ${entities.prohibited_claim.join(", ")}`);
    if (entities.regulated_substance?.length)
      parts.push(`Regulated substances: ${entities.regulated_substance.join(", ")}`);
    if (classifications.severity) parts.push(`Severity: ${classifications.severity}`);
    if (classifications.action_type) parts.push(`Action type: ${classifications.action_type}`);

    const structuredSummary = parts.join(" | ");

    return {
      inferenceId,
      entities,
      classifications,
      rawChars: sliced.length,
      structuredSummary,
    };
  } catch (err) {
    console.warn("Pioneer GLiNER2 extraction failed:", err);
    return null;
  }
}

/**
 * Submit accuracy feedback for a Pioneer inference.
 * Each correction triggers Pioneer's adaptive training loop —
 * Recall0's extractor improves permanently at zero cost per retrain.
 */
export async function submitPioneerFeedback(
  inferenceId: string,
  correct: boolean,
  correctedOutput?: object
): Promise<void> {
  if (!process.env.PIONEER_API_KEY || !inferenceId) return;
  try {
    const body = correct
      ? { verdict: "correct" }
      : {
          verdict: "incorrect",
          ...(correctedOutput ? { corrected_output: correctedOutput } : {}),
        };
    const res = await fetch(
      `${PIONEER_BASE}/inferences/${inferenceId}/feedback`,
      {
        method: "POST",
        headers: pioneerHeaders(),
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      console.warn(`Pioneer feedback failed (${res.status})`);
    }
  } catch (err) {
    console.warn("Pioneer feedback submission failed:", err);
  }
}
