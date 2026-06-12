/**
 * Pioneer GLiNER2 Fine-Tuning Pipeline for Recall0 — v2
 *
 * Runs three targeted generation batches, then trains a combined model.
 * This addresses the root causes of underperformance vs frontier LLMs:
 *
 *   Batch A — general:       500 ex in realistic regulatory doc formats
 *   Batch B — rare-entities: 300 ex focused on prohibited_claim + jurisdiction
 *   Batch C — hard-cases:    200 ex with complex boundaries + hard negatives
 *   → Total: 1,000 new + 300 existing = 1,300 examples, 12 epochs
 *
 * Run:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/pioneer-finetune.ts
 *
 * Options (env vars):
 *   PIONEER_BATCH         - "general" | "rare-entities" | "hard-cases" | "all" (default: all)
 *   PIONEER_DATASET_NAME  - name for generated dataset (default: batch-specific)
 *   PIONEER_MODEL_NAME    - trained model name (default: "recall0-gliner2-regulatory-v2")
 *   PIONEER_BASE_MODEL    - base GLiNER model (default: "fastino/gliner2-base-v1")
 *   PIONEER_EPOCHS        - training epochs (default: 12 — was 6)
 *   PIONEER_LR            - learning rate (default: 3e-5 — was 5e-5)
 *   PIONEER_COMBINE_V1    - include original v1 dataset in training (default: true)
 */

const PIONEER_BASE = "https://api.pioneer.ai";
const API_KEY = process.env.PIONEER_API_KEY;

const TARGET_BATCH = process.env.PIONEER_BATCH ?? "all";
const MODEL_NAME =
  process.env.PIONEER_MODEL_NAME ?? "recall0-gliner2-regulatory-v2";
const BASE_MODEL =
  process.env.PIONEER_BASE_MODEL ?? "fastino/gliner2-base-v1";
const EPOCHS = parseInt(process.env.PIONEER_EPOCHS ?? "12", 10);
const LEARNING_RATE = parseFloat(process.env.PIONEER_LR ?? "3e-5");
const COMBINE_V1 = process.env.PIONEER_COMBINE_V1 !== "false";

// ── Batch configurations matching the API route ───────────────────────────────

interface BatchConfig {
  id: string;
  datasetName: string;
  numExamples: number;
  domainDescription: string;
  prompt: string;
}

const BATCH_CONFIGS: BatchConfig[] = [
  {
    id: "general",
    datasetName: process.env.PIONEER_DATASET_NAME ?? "recall0-regulatory-ner-general-v2",
    numExamples: 500,
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
  {
    id: "rare-entities",
    datasetName: "recall0-regulatory-ner-rare-entities-v2",
    numExamples: 300,
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
  {
    id: "hard-cases",
    datasetName: "recall0-regulatory-ner-hard-cases-v2",
    numExamples: 200,
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
      "(7) Hard negatives: '$100 registration fee' (not a penalty), " +
      "'January 2025 publication date' (not a compliance deadline), " +
      "'agency staff conducted a review' (agency as common noun, not a named regulator). " +
      "Some examples should have only 1-2 entity types (hard for the model to know what to omit).",
  },
];

// Our regulatory entity types with rich descriptions for better synthetic data
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
    "The category of products, goods, or product types subject to the regulation (e.g. 'dietary supplements', 'cosmetics', 'food contact materials', 'children\\'s toys')",
  jurisdiction:
    "The geographic area, country, region, or market where the regulation applies (e.g. 'California', 'European Union', 'United States', 'Canada')",
  prohibited_claim:
    "A specific marketing claim, health claim, or statement that is banned, restricted, or requires substantiation (e.g. 'cures diabetes', 'clinically proven', 'all-natural')",
};

const REGULATORY_CLASSIFICATIONS = [
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
];

function headers() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY ?? "",
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Step 1: Generate synthetic training data (per batch) ─────────────────────

async function generateBatch(config: BatchConfig): Promise<string> {
  log(`Generating ${config.numExamples} examples for batch '${config.id}'...`);
  log(`Dataset: ${config.datasetName}`);

  const res = await fetch(`${PIONEER_BASE}/generate`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      task_type: "ner",
      dataset_name: config.datasetName,
      labels: REGULATORY_ENTITIES, // pass as object with descriptions for better quality
      num_examples: config.numExamples,
      domain_description: config.domainDescription,
      prompt: config.prompt,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Generate failed for batch '${config.id}' (${res.status}): ${body.slice(0, 300)}`
    );
  }

  const data = (await res.json()) as { job_id?: string; id?: string };
  const jobId = data.job_id ?? data.id ?? "";
  if (!jobId)
    throw new Error(`No job_id in response: ${JSON.stringify(data)}`);

  log(`Generation job started for '${config.id}': ${jobId}`);
  return jobId;
}

async function pollGenerationJob(jobId: string): Promise<void> {
  log("Polling generation job...");
  for (let attempt = 0; attempt < 120; attempt++) {
    await sleep(10_000);
    const res = await fetch(`${PIONEER_BASE}/generate/jobs/${jobId}`, {
      headers: headers(),
    });
    if (!res.ok) {
      log(`Poll returned ${res.status}, retrying...`);
      continue;
    }
    const data = (await res.json()) as { status?: string };
    log(`Generation status: ${data.status}`);
    if (data.status === "complete" || data.status === "ready") return;
    if (data.status === "failed") throw new Error("Generation job failed");
  }
  throw new Error("Generation job timed out after 20 minutes");
}

async function waitForDataset(datasetName: string): Promise<void> {
  log(`Waiting for dataset '${datasetName}' to be ready...`);
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5_000);
    const res = await fetch(
      `${PIONEER_BASE}/felix/datasets/${datasetName}`,
      { headers: headers() }
    );
    if (!res.ok) {
      log(`Dataset poll returned ${res.status}, retrying...`);
      continue;
    }
    const data = (await res.json()) as { status?: string };
    log(`Dataset status: ${data.status}`);
    if (data.status === "ready") return;
  }
  throw new Error(`Dataset '${datasetName}' never became ready`);
}

// ── Step 2: Start training job ────────────────────────────────────────────────

async function startTrainingJob(datasetNames: string[]): Promise<string> {
  log(`Starting LoRA fine-tuning on ${BASE_MODEL}...`);
  log(`Model name: ${MODEL_NAME}, epochs: ${EPOCHS}, lr: ${LEARNING_RATE}`);
  log(`Datasets: ${datasetNames.join(", ")}`);

  const res = await fetch(`${PIONEER_BASE}/felix/training-jobs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model_name: MODEL_NAME,
      base_model: BASE_MODEL,
      datasets: datasetNames.map((name) => ({ name })),
      training_type: "lora",
      nr_epochs: EPOCHS,
      learning_rate: LEARNING_RATE,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Training job failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id?: string; status?: string };
  const jobId = data.id ?? "";
  if (!jobId)
    throw new Error(`No job id in training response: ${JSON.stringify(data)}`);

  log(`Training job started: ${jobId} (status: ${data.status})`);
  return jobId;
}

async function pollTrainingJob(
  jobId: string
): Promise<{ f1: number; precision: number; recall: number }> {
  log("Polling training job (this may take 10-60 minutes)...");
  let lastStatus = "";
  for (let attempt = 0; attempt < 360; attempt++) {
    await sleep(30_000);
    const res = await fetch(
      `${PIONEER_BASE}/felix/training-jobs/${jobId}`,
      { headers: headers() }
    );
    if (!res.ok) {
      log(`Poll returned ${res.status}, retrying...`);
      continue;
    }
    const data = (await res.json()) as {
      status?: string;
      metrics?: { f1?: number; precision?: number; recall?: number };
    };

    if (data.status !== lastStatus) {
      log(`Training status: ${data.status}`);
      lastStatus = data.status ?? "";
    }

    if (data.status === "complete" || data.status === "deployed") {
      const m = data.metrics ?? {};
      return {
        f1: m.f1 ?? 0,
        precision: m.precision ?? 0,
        recall: m.recall ?? 0,
      };
    }
    if (data.status === "failed" || data.status === "stopped") {
      throw new Error(`Training job ${data.status}: ${jobId}`);
    }
  }
  throw new Error("Training job timed out after 3 hours");
}

// ── Step 3: Spot-check inference with our trained model ───────────────────────

async function spotCheckInference(jobId: string): Promise<void> {
  const testTexts = [
    "The FDA issued a warning letter to HealthCo Inc. requiring them to remove the claim 'cures type 2 diabetes' from all products containing berberine by March 31, 2025 or face penalties up to $50,000 per violation.",
    "California's Office of Environmental Health Hazard Assessment (OEHHA) added titanium dioxide to the Prop 65 list, requiring dietary supplement manufacturers to add cancer warning labels to all products sold in California starting January 1, 2026.",
    "The European Food Safety Authority (EFSA) banned the use of high-dose vitamin B6 (above 35mg per serving) in food supplements across all EU member states, effective immediately, following safety concerns.",
  ];

  log("\n── Spot-check inference with fine-tuned model ──");
  for (const text of testTexts) {
    const res = await fetch(`${PIONEER_BASE}/inference`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model_id: jobId,
        text,
        schema: {
          entities: REGULATORY_ENTITIES,
          classifications: REGULATORY_CLASSIFICATIONS,
        },
        threshold: 0.4,
      }),
    });

    if (!res.ok) {
      log(`Inference failed (${res.status}) — skipping spot check`);
      continue;
    }

    const data = (await res.json()) as {
      entities?: Array<{ label: string; text: string; score?: number }>;
      classifications?: Array<{ task: string; label: string; score?: number }>;
    };

    const entitySummary = (data.entities ?? [])
      .map((e) => `${e.label}="${e.text}"(${(e.score ?? 0).toFixed(2)})`)
      .join(", ");
    const classificationSummary = (data.classifications ?? [])
      .map((c) => `${c.task}=${c.label}`)
      .join(", ");

    log(`\nText: "${text.slice(0, 80)}..."`);
    log(`  Entities: ${entitySummary || "(none)"}`);
    log(`  Classifications: ${classificationSummary || "(none)"}`);
  }
}

// ── Step 4: Compare base vs fine-tuned on the same examples ──────────────────

async function compareBaseVsFineTuned(jobId: string): Promise<void> {
  const testText =
    "The FTC issued an enforcement action against NutriSupps LLC for making unsubstantiated claims that their keto supplement 'burns fat instantly'. " +
    "The company must pay $2.5M in civil penalties and add clear disclosure labels to all products sold in the United States by June 1, 2025.";

  log("\n── Comparing base GLiNER2 vs fine-tuned model ──");
  log(`Test: "${testText.slice(0, 80)}..."`);

  for (const [label, modelId] of [
    ["Base (fastino/gliner2-base-v1)", "fastino/gliner2-base-v1"],
    [`Fine-tuned (${jobId.slice(0, 8)}...)`, jobId],
  ]) {
    const res = await fetch(`${PIONEER_BASE}/inference`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model_id: modelId,
        text: testText,
        schema: { entities: REGULATORY_ENTITIES },
        threshold: 0.4,
      }),
    });

    if (!res.ok) {
      log(`  [${label}] inference failed (${res.status})`);
      continue;
    }

    const data = (await res.json()) as {
      entities?: Array<{ label: string; text: string; score?: number }>;
    };
    const entities = data.entities ?? [];
    log(`\n  [${label}] → ${entities.length} entities found:`);
    for (const e of entities) {
      log(`    ${e.label.padEnd(30)} "${e.text}" (${(e.score ?? 0).toFixed(3)})`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error("PIONEER_API_KEY is not set. Source .env.local first.");
    process.exit(1);
  }

  const batchesToRun =
    TARGET_BATCH === "all"
      ? BATCH_CONFIGS
      : BATCH_CONFIGS.filter((b) => b.id === TARGET_BATCH);

  if (batchesToRun.length === 0) {
    console.error(
      `Unknown batch '${TARGET_BATCH}'. Must be: all, general, rare-entities, hard-cases`
    );
    process.exit(1);
  }

  const totalExamples = batchesToRun.reduce((s, b) => s + b.numExamples, 0);

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║   Recall0 × Pioneer — GLiNER2 Fine-Tuning v2                 ║
╚══════════════════════════════════════════════════════════════╝

Base model   : ${BASE_MODEL}
Model name   : ${MODEL_NAME}
Epochs       : ${EPOCHS}  (was 6)
Learning rate: ${LEARNING_RATE}  (was 5e-5)
Batches      : ${batchesToRun.map((b) => b.id).join(", ")}
Total new ex : ${totalExamples}
Include v1   : ${COMBINE_V1}

Entity types : ${Object.keys(REGULATORY_ENTITIES).join(", ")}
`);

  try {
    const completedDatasets: string[] = [];

    // Step 1: Generate all batches (sequentially — Pioneer limits concurrent jobs)
    for (const batch of batchesToRun) {
      log(`\n── Batch: ${batch.id} ─────────────────────────────────────────`);
      const genJobId = await generateBatch(batch);
      await pollGenerationJob(genJobId);
      log(`✓ Generation complete for '${batch.id}'`);

      await waitForDataset(batch.datasetName);
      log(`✓ Dataset ready: ${batch.datasetName}`);

      completedDatasets.push(batch.datasetName);
    }

    // Optionally include original v1 dataset
    const allDatasets = COMBINE_V1
      ? ["recall0-regulatory-ner-v1", ...completedDatasets]
      : completedDatasets;

    log(`\n── Starting training on ${allDatasets.length} dataset(s) ────────`);
    for (const ds of allDatasets) log(`   · ${ds}`);

    // Step 2: Train on all datasets combined
    const trainingJobId = await startTrainingJob(allDatasets);
    const metrics = await pollTrainingJob(trainingJobId);

    const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║   Training Complete!                                          ║
╠══════════════════════════════════════════════════════════════╣
║   Job ID      : ${trainingJobId.padEnd(44)}║
║   F1          : ${pct(metrics.f1).padEnd(44)}║
║   Precision   : ${pct(metrics.precision).padEnd(44)}║
║   Recall      : ${pct(metrics.recall).padEnd(44)}║
╚══════════════════════════════════════════════════════════════╝
`);

    // Step 3: Compare base vs fine-tuned
    await compareBaseVsFineTuned(trainingJobId);

    // Step 4: Spot-check
    await spotCheckInference(trainingJobId);

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║   Next Steps                                                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   Add to .env.local:                                          ║
║   PIONEER_GLINER_MODEL=${trainingJobId.slice(0, 36).padEnd(36)}  ║
║                                                              ║
║   Then restart the dev server. The new model will be used    ║
║   automatically for all entity extraction in Recall0.         ║
╚══════════════════════════════════════════════════════════════╝
`);
  } catch (err) {
    console.error("\n✗ Pipeline failed:", err);
    process.exit(1);
  }
}

main();
