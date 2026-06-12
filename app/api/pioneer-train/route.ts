import "server-only";
import { NextRequest, NextResponse } from "next/server";

const PIONEER_BASE = "https://api.pioneer.ai";
const BASE_MODEL = process.env.PIONEER_BASE_MODEL ?? "fastino/gliner2-base-v1";

const REGULATORY_ENTITIES: Record<string, string> = {
  regulation_name:
    "The official name or citation of a law, rule, directive, or regulation (e.g. 'DSHEA', 'EU Regulation 1169/2011', 'California Prop 65', '21 CFR 101.93')",
  regulated_substance:
    "A specific chemical compound, ingredient, additive, drug, or material that is regulated, restricted, or banned (e.g. 'ephedrine', 'BPA', 'PFAS', 'titanium dioxide')",
  agency:
    "A government regulatory body, agency, or authority issuing or enforcing the regulation (e.g. 'FDA', 'FTC', 'EPA', 'EFSA', 'CPSC', 'OSHA')",
  deadline:
    "A specific date, time period, or compliance deadline by which action must be taken (e.g. 'January 1, 2025', 'within 90 days', 'Q3 2024')",
  penalty:
    "A fine, civil penalty, criminal sanction, or enforcement consequence for non-compliance (e.g. '$10,000 per violation', 'up to $1M', 'criminal penalties')",
  affected_product_category:
    "The category of products, goods, or product types subject to the regulation (e.g. 'dietary supplements', 'cosmetics', 'food contact materials', \"children's toys\")",
  jurisdiction:
    "The geographic area, country, region, or market where the regulation applies (e.g. 'California', 'European Union', 'United States', 'Canada')",
  prohibited_claim:
    "A specific marketing claim, health claim, or statement that is banned, restricted, or requires substantiation (e.g. 'cures diabetes', 'clinically proven', 'all-natural')",
};

type BatchType = "general" | "rare-entities" | "hard-cases";

interface BatchConfig {
  batchType: BatchType;
  domainDescription: string;
  prompt: string;
  defaultExamples: number;
}

const BATCH_CONFIGS: Record<BatchType, BatchConfig> = {
  general: {
    batchType: "general",
    defaultExamples: 500,
    domainDescription:
      "Regulatory compliance texts from US federal agencies (FDA, FTC, EPA, CPSC, USDA), " +
      "EU authorities (EFSA, EMA), UK regulators, and state-level agencies (California OEHHA, NYDOH). " +
      "Documents include enforcement actions, warning letters, guidance documents, final rules, " +
      "consent orders, and import alerts across CPG, dietary supplements, cosmetics, food, " +
      "fintech, children's products, and industrial chemicals.",
    prompt:
      "Generate diverse regulatory compliance texts of 3-8 sentences that read like real regulatory documents. " +
      "Vary the format: sometimes a paragraph from a warning letter ('Dear CEO: ...'), " +
      "sometimes a rule preamble ('Effective January 1, 2026, all manufacturers must...'), " +
      "sometimes a press release ('The FDA today announced...'), " +
      "sometimes a compliance guidance excerpt. " +
      "Include formal regulatory language: citations like '21 CFR 101.93', parenthetical abbreviations " +
      "like 'Food and Drug Administration (FDA)', cross-references like 'as defined in Section 403(q)'. " +
      "Ensure every example contains at least 3 entity types. " +
      "Mix agencies, product categories, deadlines, penalties, and substances across examples.",
  },

  "rare-entities": {
    batchType: "rare-entities",
    defaultExamples: 300,
    domainDescription:
      "FTC enforcement actions against deceptive health claims, FDA warning letters about prohibited " +
      "disease claims on dietary supplements, EU advertising restriction directives, state consumer " +
      "protection actions against misleading marketing. Also includes multi-jurisdictional compliance " +
      "scenarios where different regions impose different requirements on the same product.",
    prompt:
      "Generate regulatory texts specifically focused on marketing claim violations and jurisdiction-specific rules. " +
      "Every example MUST contain at least one prohibited_claim entity (the exact banned wording, e.g. " +
      "'cures arthritis', 'clinically proven to', 'FDA approved', 'all-natural', 'no side effects') " +
      "OR at least one jurisdiction entity (specific geographic scope, e.g. 'California', " +
      "'the European Economic Area', 'all EU member states', 'New York State'). " +
      "Include cases where the SAME product faces different requirements in different jurisdictions. " +
      "Include cases where a claim is prohibited in one context but allowed with qualifications in another. " +
      "Mix in penalty, deadline, and agency entities as context.",
  },

  "hard-cases": {
    batchType: "hard-cases",
    defaultExamples: 200,
    domainDescription:
      "Challenging regulatory NER scenarios with complex entity boundaries, abbreviated agency names, " +
      "nested regulatory references, conditional clauses, negation, and ambiguous spans. " +
      "These examples test model discrimination between entity and non-entity mentions.",
    prompt:
      "Generate challenging NER examples where entity boundaries require careful judgment. Include: " +
      "(1) Abbreviated + full form: 'The Food and Drug Administration (FDA)' where both are valid spans; " +
      "(2) Conditional deadlines: 'within 30 days of receiving notice' not just a date; " +
      "(3) Penalty ranges: 'between $10,000 and $50,000 per violation per day'; " +
      "(4) Substances in context: 'products containing more than 3mg of melatonin per serving'; " +
      "(5) Negated entities: 'devices NOT classified as medical devices under 21 CFR 880'; " +
      "(6) Cross-referenced regulations: 'as defined in Section 201(g) of the Federal Food, Drug, " +
      "and Cosmetic Act'; " +
      "(7) Multi-sentence entities: where an agency is established in sentence 1 and referenced only " +
      "as 'the agency' in sentence 3 — annotate only the first named mention. " +
      "Some examples should have only 1-2 entity types (testing what NOT to extract). " +
      "Include hard negatives: '$100 registration fee' (not a penalty), " +
      "'January 2025 publication date' (not a compliance deadline), " +
      "'agency staff conducted a review' (agency as common noun, not a named regulator).",
  },
};

function pioneerHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.PIONEER_API_KEY ?? "",
  };
}

function datasetNameForBatch(batchType: BatchType, version: number): string {
  return `recall0-regulatory-ner-${batchType}-v${version}`;
}

/**
 * POST /api/pioneer-train
 *
 * Starts a data generation run. Accepts optional body params:
 *   batchType: "general" | "rare-entities" | "hard-cases"  (default: "general")
 *   numExamples: number                                       (default from config)
 *   datasetVersion: number                                    (default: 2)
 *
 * Returns job ID immediately. Poll /api/pioneer-train/status?dataGenJobId=... for progress.
 * Protected by x-admin-secret.
 */
export async function POST(req: NextRequest) {
  if (!process.env.PIONEER_API_KEY) {
    return NextResponse.json({ error: "Pioneer not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("x-admin-secret");
  if (authHeader !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    batchType?: BatchType;
    numExamples?: number;
    datasetVersion?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — all fields have defaults
  }

  const batchType: BatchType = body.batchType ?? "general";
  const config = BATCH_CONFIGS[batchType];
  if (!config) {
    return NextResponse.json({ error: `Unknown batchType: ${batchType}` }, { status: 400 });
  }

  const numExamples = body.numExamples ?? config.defaultExamples;
  const datasetVersion = body.datasetVersion ?? 2;
  const datasetName = datasetNameForBatch(batchType, datasetVersion);

  try {
    const genRes = await fetch(`${PIONEER_BASE}/generate`, {
      method: "POST",
      headers: pioneerHeaders(),
      body: JSON.stringify({
        task_type: "ner",
        dataset_name: datasetName,
        labels: REGULATORY_ENTITIES,
        num_examples: numExamples,
        domain_description: config.domainDescription,
        prompt: config.prompt,
      }),
    });

    if (!genRes.ok) {
      const errBody = await genRes.text();
      return NextResponse.json(
        { error: `Pioneer data generation failed: ${errBody.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const genData = (await genRes.json()) as { job_id?: string; id?: string };
    const dataGenJobId = genData.job_id ?? genData.id ?? "";

    return NextResponse.json({
      ok: true,
      dataGenJobId,
      datasetName,
      batchType,
      numExamples,
      datasetVersion,
      baseModel: BASE_MODEL,
      message: `Generating ${numExamples} ${batchType} examples → dataset '${datasetName}'.`,
    });
  } catch (err) {
    console.error("Pioneer train route failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/**
 * PUT /api/pioneer-train
 *
 * Starts a training job after data generation completes. Body params:
 *   datasets: string[]   — dataset names to train on (can combine multiple batches)
 *   modelName: string    — name for this trained model version
 *   epochs: number       — training epochs (default: 12)
 *   learningRate: number — (default: 3e-5)
 *
 * Protected by x-admin-secret.
 */
export async function PUT(req: NextRequest) {
  if (!process.env.PIONEER_API_KEY) {
    return NextResponse.json({ error: "Pioneer not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("x-admin-secret");
  if (authHeader !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    datasets?: string[];
    modelName?: string;
    epochs?: number;
    learningRate?: number;
  } = {};
  try {
    body = await req.json();
  } catch {
    // use defaults
  }

  const datasets = body.datasets ?? ["recall0-regulatory-ner-general-v2"];
  const modelName = body.modelName ?? "recall0-gliner2-regulatory-v2";
  const epochs = body.epochs ?? 12;
  const learningRate = body.learningRate ?? 3e-5;

  try {
    const trainRes = await fetch(`${PIONEER_BASE}/felix/training-jobs`, {
      method: "POST",
      headers: pioneerHeaders(),
      body: JSON.stringify({
        model_name: modelName,
        base_model: BASE_MODEL,
        datasets: datasets.map((name) => ({ name })),
        training_type: "lora",
        nr_epochs: epochs,
        learning_rate: learningRate,
      }),
    });

    if (!trainRes.ok) {
      const errBody = await trainRes.text();
      return NextResponse.json(
        { error: `Pioneer training job failed: ${errBody.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const trainData = (await trainRes.json()) as { id?: string; status?: string };
    return NextResponse.json({
      ok: true,
      trainingJobId: trainData.id,
      status: trainData.status,
      modelName,
      datasets,
      epochs,
      learningRate,
      message: `Training job started on ${datasets.length} dataset(s) with ${epochs} epochs.`,
    });
  } catch (err) {
    console.error("Pioneer start-training route failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
