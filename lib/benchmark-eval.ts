import "server-only";
import OpenAI from "openai";

const PIONEER_BASE = "https://api.pioneer.ai";
const BASE_GLINER_MODEL = "fastino/gliner2-base-v1";

function pioneerHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": process.env.PIONEER_API_KEY ?? "",
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvalExample {
  text: string;
  /**
   * Ground truth: entity_type → list of exact text spans that appear in `text`.
   * Comparison is case-insensitive after trimming.
   */
  expected: Record<string, string[]>;
}

export interface ModelResult {
  /** Strict F1: normalized text must match exactly. */
  f1: number;
  precision: number;
  recall: number;
  /**
   * Partial F1: prediction scores as TP if it is a substring of a ground-truth
   * span (or vice versa) and shares the same entity type. More robust to
   * boundary differences ("FDA" vs "the FDA", "EFSA" vs "European Food Safety
   * Authority (EFSA)"). This is a better operational metric for span extraction.
   */
  f1_partial: number;
  precision_partial: number;
  recall_partial: number;
  latency_ms: number;
  /** Per-entity-type strict F1. Only reliable for types with ≥ 15 annotations. */
  perEntityF1: Record<string, number>;
  /** Per-entity-type partial F1. */
  perEntityF1Partial: Record<string, number>;
  error?: string;
}

/**
 * Real metrics from Pioneer's own training-job validation split.
 * These are computed by Pioneer on held-out data from training — not our
 * synthetic 25-example set. They are the most credible numbers for the
 * fine-tuned model's true performance.
 */
export interface PioneerJobMetrics {
  f1: number;
  precision: number;
  recall: number;
  /** Pioneer training job ID (= PIONEER_GLINER_MODEL env var) */
  jobId: string;
  /** Status from Pioneer API ("complete", "deployed", etc.) */
  status: string;
}

/**
 * How many ground-truth annotations exist per entity type across all eval
 * examples. Used to decide whether per-entity F1 is statistically reliable.
 */
export type AnnotationCounts = Record<string, number>;

export interface BenchmarkResults {
  models: Record<string, ModelResult>;
  timestamp: string;
  examplesCount: number;
  /** true when PIONEER_GLINER_MODEL is set to a fine-tuned job UUID (not the base) */
  hasFineTunedModel: boolean;
  /** Annotation counts per entity type across all 25 eval examples. */
  annotationCounts: AnnotationCounts;
  /**
   * Real training-job F1 from Pioneer's held-out validation split (most
   * credible metric for the fine-tuned model). null if unavailable.
   */
  pioneerJobMetrics: PioneerJobMetrics | null;
}

interface EntityMention {
  type: string;
  text: string;
}

// ── 25 labeled evaluation examples ────────────────────────────────────────────
//
// Ground truth spans are exact substrings of the `text` (case-insensitive match
// after normalization). Covers all 8 entity types across diverse agencies.

export const EVAL_EXAMPLES: EvalExample[] = [
  // 1 – FDA / prohibited claim / supplement
  {
    text: "The FDA issued a warning letter requiring HealthCo Inc. to remove the claim 'cures type 2 diabetes' from all berberine products by March 31, 2025, or face civil penalties of $50,000 per violation.",
    expected: {
      agency: ["FDA"],
      prohibited_claim: ["cures type 2 diabetes"],
      regulated_substance: ["berberine"],
      deadline: ["March 31, 2025"],
      penalty: ["$50,000 per violation"],
      affected_product_category: ["berberine products"],
    },
  },
  // 2 – California Prop 65 / titanium dioxide
  {
    text: "California's OEHHA added titanium dioxide to the Prop 65 list of chemicals known to cause cancer, requiring dietary supplement manufacturers selling products in California to add cancer warning labels by January 1, 2026.",
    expected: {
      agency: ["OEHHA"],
      regulated_substance: ["titanium dioxide"],
      regulation_name: ["Prop 65"],
      jurisdiction: ["California"],
      deadline: ["January 1, 2026"],
      affected_product_category: ["dietary supplements"],
    },
  },
  // 3 – FTC enforcement / keto supplement
  {
    text: "The FTC filed an enforcement action against NutriSupps LLC for making unsubstantiated claims that their keto supplement 'burns fat instantly', requiring the company to pay $2.5M in civil penalties and add clear disclosure labels on all products sold in the United States.",
    expected: {
      agency: ["FTC"],
      prohibited_claim: ["burns fat instantly"],
      affected_product_category: ["keto supplement"],
      penalty: ["$2.5M in civil penalties"],
      jurisdiction: ["United States"],
    },
  },
  // 4 – EPA / PFAS / food packaging
  {
    text: "The EPA finalized a rule under TSCA banning the use of PFAS compounds in all food contact materials effective October 1, 2025, with civil penalties up to $37,500 per day for non-compliance. The rule applies to food packaging sold in the United States.",
    expected: {
      agency: ["EPA"],
      regulation_name: ["TSCA"],
      regulated_substance: ["PFAS"],
      affected_product_category: ["food contact materials", "food packaging"],
      deadline: ["October 1, 2025"],
      penalty: ["$37,500 per day"],
      jurisdiction: ["United States"],
    },
  },
  // 5 – EFSA / vitamin B6 ban
  {
    text: "The European Food Safety Authority (EFSA) banned the use of high-dose vitamin B6 (pyridoxine) above 35mg per serving in food supplements across all EU member states, effective immediately, citing safety concerns regarding peripheral neuropathy.",
    expected: {
      agency: ["EFSA", "European Food Safety Authority"],
      regulated_substance: ["vitamin B6", "pyridoxine"],
      jurisdiction: ["EU"],
      affected_product_category: ["food supplements"],
    },
  },
  // 6 – CPSC / children's toy recall
  {
    text: "The CPSC announced a mandatory recall of 1.2 million magnetic toy sets sold by ToyWorld Corp. due to violations of 16 CFR Part 1250 (federal toy safety standards), as loose magnets pose an ingestion hazard for children under 14. Retailers must stop sales immediately.",
    expected: {
      agency: ["CPSC"],
      regulation_name: ["16 CFR Part 1250"],
      affected_product_category: ["magnetic toy sets", "children's toys"],
    },
  },
  // 7 – FDA / Red Dye No. 3 ban
  {
    text: "FDA revoked authorization for Red Dye No. 3 (erythrosine) in food and ingested drugs under 21 CFR 74.303, requiring manufacturers to reformulate and relabel all food products containing this colorant by January 15, 2027. The ban applies to all products distributed in the United States.",
    expected: {
      agency: ["FDA"],
      regulated_substance: ["Red Dye No. 3", "erythrosine"],
      regulation_name: ["21 CFR 74.303"],
      deadline: ["January 15, 2027"],
      jurisdiction: ["United States"],
      affected_product_category: ["food products"],
    },
  },
  // 8 – FTC / weight loss claims
  {
    text: "The FTC's Operation Failed Resolution targeted 10 companies selling weight loss supplements, citing deceptive advertising claims including 'lose 30 pounds in 30 days' and 'clinically proven fat burner'. Companies must refund consumers and pay fines totaling $15M under Section 5 of the FTC Act.",
    expected: {
      agency: ["FTC"],
      prohibited_claim: ["lose 30 pounds in 30 days", "clinically proven fat burner"],
      penalty: ["$15M"],
      regulation_name: ["Section 5 of the FTC Act"],
      affected_product_category: ["weight loss supplements"],
    },
  },
  // 9 – EU / food contact materials / BPA
  {
    text: "Under EU Regulation 10/2011 on plastic food contact materials, the European Commission reduced the specific migration limit for bisphenol A (BPA) to 0.05 mg/kg food, effective September 2024. This applies to all plastic packaging, containers, and kitchenware sold in the European Union.",
    expected: {
      regulation_name: ["EU Regulation 10/2011"],
      regulated_substance: ["bisphenol A", "BPA"],
      deadline: ["September 2024"],
      jurisdiction: ["European Union"],
      affected_product_category: ["plastic food contact materials", "plastic packaging", "containers", "kitchenware"],
    },
  },
  // 10 – California / AB 45 / hemp-derived CBD
  {
    text: "California's AB 45 legalized hemp-derived CBD in food, beverages, and dietary supplements, but requires manufacturers to obtain a Certificate of Analysis from an ISO 17025-accredited laboratory and register with the California Department of Public Health (CDPH) before selling CBD products in California.",
    expected: {
      regulation_name: ["AB 45"],
      regulated_substance: ["hemp-derived CBD", "CBD"],
      jurisdiction: ["California"],
      agency: ["California Department of Public Health", "CDPH"],
      affected_product_category: ["food", "beverages", "dietary supplements"],
    },
  },
  // 11 – OSHA / ethylene oxide / workplace safety
  {
    text: "OSHA issued a final rule lowering the permissible exposure limit (PEL) for ethylene oxide to 0.1 ppm as an 8-hour time-weighted average under 29 CFR 1910.1047, effective June 2026. Facilities using ethylene oxide as a sterilant must implement engineering controls within 180 days or face penalties up to $156,259 per willful violation.",
    expected: {
      agency: ["OSHA"],
      regulation_name: ["29 CFR 1910.1047"],
      regulated_substance: ["ethylene oxide"],
      deadline: ["June 2026"],
      penalty: ["$156,259 per willful violation"],
    },
  },
  // 12 – FDA / structure/function claim / DSHEA
  {
    text: "Under DSHEA and 21 CFR 101.93, dietary supplement companies must notify the FDA within 30 days of first marketing a product with a structure/function claim. Claims such as 'supports immune health' are permissible, but 'treats or cures COVID-19' constitutes an unauthorized drug claim and is prohibited.",
    expected: {
      agency: ["FDA"],
      regulation_name: ["DSHEA", "21 CFR 101.93"],
      deadline: ["30 days"],
      prohibited_claim: ["treats or cures COVID-19"],
      affected_product_category: ["dietary supplements"],
    },
  },
  // 13 – TTB / alcohol labeling / sulfite disclosure
  {
    text: "The Alcohol and Tobacco Tax and Trade Bureau (TTB) requires all wine containing more than 10 ppm of sulfites to carry the statement 'Contains Sulfites' on the label under 27 CFR Part 16. Wines produced in the United States must comply or face label rejection and potential fines of up to $10,000.",
    expected: {
      agency: ["Alcohol and Tobacco Tax and Trade Bureau", "TTB"],
      regulated_substance: ["sulfites"],
      regulation_name: ["27 CFR Part 16"],
      jurisdiction: ["United States"],
      penalty: ["$10,000"],
      affected_product_category: ["wine"],
    },
  },
  // 14 – USDA / organic certification / NOP
  {
    text: "The USDA's National Organic Program (NOP) prohibits the use of synthetic pesticides, including glyphosate, in certified organic products. Manufacturers using the USDA Organic seal without certification are subject to civil penalties up to $22,186 per violation under 7 CFR Part 205.",
    expected: {
      agency: ["USDA"],
      regulation_name: ["National Organic Program", "NOP", "7 CFR Part 205"],
      regulated_substance: ["glyphosate"],
      penalty: ["$22,186 per violation"],
      affected_product_category: ["certified organic products"],
    },
  },
  // 15 – EU / REACH / restricted chemicals in cosmetics
  {
    text: "Under the EU REACH Regulation (EC No 1907/2006), formaldehyde-releasing preservatives such as DMDM hydantoin are restricted to a maximum concentration of 0.1% in cosmetics and personal care products. Non-compliant products may not be placed on the EU market and are subject to import bans.",
    expected: {
      regulation_name: ["EU REACH Regulation", "EC No 1907/2006"],
      regulated_substance: ["formaldehyde-releasing preservatives", "DMDM hydantoin", "formaldehyde"],
      jurisdiction: ["EU"],
      affected_product_category: ["cosmetics", "personal care products"],
    },
  },
  // 16 – Health Canada / natural health products
  {
    text: "Health Canada requires all natural health products (NHPs) sold in Canada to obtain a Natural Product Number (NPN) under the Natural Health Products Regulations (SOR/2003-196) before market entry. Companies without NPN authorization face product seizure and fines up to CAD $5,000,000.",
    expected: {
      agency: ["Health Canada"],
      regulation_name: ["Natural Health Products Regulations", "SOR/2003-196"],
      jurisdiction: ["Canada"],
      penalty: ["CAD $5,000,000"],
      affected_product_category: ["natural health products", "NHPs"],
    },
  },
  // 17 – FDA / heavy metals / baby food
  {
    text: "The FDA's Closer to Zero action plan established action levels of 10 ppb for inorganic arsenic and 20 ppb for lead in infant and toddler foods, including purees, cereals, and snacks. Manufacturers must test each product lot for these heavy metals and submit results to FDA by December 2025.",
    expected: {
      agency: ["FDA"],
      regulated_substance: ["inorganic arsenic", "lead"],
      deadline: ["December 2025"],
      affected_product_category: ["infant and toddler foods", "purees", "cereals", "snacks"],
    },
  },
  // 18 – FTC / influencer disclosure / social media
  {
    text: "The FTC's updated Guides Concerning the Use of Endorsements and Testimonials (16 CFR Part 255) require social media influencers to clearly disclose material connections to brands using unambiguous language such as '#ad' or '#sponsored' at the beginning of posts. Failure to disclose carries fines of up to $50,120 per violation.",
    expected: {
      agency: ["FTC"],
      regulation_name: ["16 CFR Part 255"],
      penalty: ["$50,120 per violation"],
      prohibited_claim: [],
    },
  },
  // 19 – EPA / VOC / architectural coatings
  {
    text: "EPA's Architectural Coatings Rule under 40 CFR Part 59 limits volatile organic compound (VOC) content in interior flat paints to 50 grams per liter. Products exceeding these limits may not be sold in any state and manufacturers face civil penalties of $25,000 per day per violation.",
    expected: {
      agency: ["EPA"],
      regulation_name: ["40 CFR Part 59"],
      regulated_substance: ["volatile organic compound", "VOC"],
      penalty: ["$25,000 per day per violation"],
      affected_product_category: ["architectural coatings", "interior flat paints"],
    },
  },
  // 20 – Prop 65 / acrylamide / coffee
  {
    text: "California's Office of Environmental Health Hazard Assessment determined that coffee does not pose a significant cancer risk under Prop 65, exempting coffee sellers in California from the requirement to include Proposition 65 cancer warnings for acrylamide on their products as of June 2024.",
    expected: {
      agency: ["Office of Environmental Health Hazard Assessment"],
      regulation_name: ["Prop 65", "Proposition 65"],
      regulated_substance: ["acrylamide"],
      jurisdiction: ["California"],
      deadline: ["June 2024"],
      affected_product_category: ["coffee"],
    },
  },
  // 21 – CPSC / flame retardants / children's sleepwear
  {
    text: "The CPSC prohibits the use of TRIS (tris(1,3-dichloro-2-propyl)phosphate) as a flame retardant in children's sleepwear under 16 CFR Part 1615 and 1616. Any children's sleepwear treated with this chemical must be recalled and destroyed, and manufacturers face penalties of up to $100,000 per product hazard.",
    expected: {
      agency: ["CPSC"],
      regulated_substance: ["TRIS", "tris(1,3-dichloro-2-propyl)phosphate"],
      regulation_name: ["16 CFR Part 1615", "16 CFR Part 1616"],
      affected_product_category: ["children's sleepwear"],
      penalty: ["$100,000 per product hazard"],
    },
  },
  // 22 – UK FSA / post-Brexit food labeling
  {
    text: "The UK Food Standards Agency (FSA) requires all pre-packaged food sold in Great Britain to display a full ingredients list, allergen declarations for the 14 major allergens, and a 'Best before' or 'Use by' date under the Food Information Regulations 2014 (SI 2014/1855). Products not complying by October 1, 2025 will be withdrawn from shelves.",
    expected: {
      agency: ["UK Food Standards Agency", "FSA"],
      regulation_name: ["Food Information Regulations 2014", "SI 2014/1855"],
      jurisdiction: ["Great Britain"],
      deadline: ["October 1, 2025"],
      affected_product_category: ["pre-packaged food"],
    },
  },
  // 23 – FDA / new dietary ingredient notification / NDI
  {
    text: "Under DSHEA Section 8, any dietary supplement containing a new dietary ingredient (NDI) not marketed before October 15, 1994, requires a 75-day pre-market notification to the FDA. Companies failing to submit an NDI notification face the product being deemed adulterated under 21 U.S.C. 342(f).",
    expected: {
      agency: ["FDA"],
      regulation_name: ["DSHEA", "21 U.S.C. 342(f)"],
      deadline: ["75-day", "October 15, 1994"],
      affected_product_category: ["dietary supplements"],
    },
  },
  // 24 – FTC / negative option / subscription billing
  {
    text: "The FTC's Negative Option Rule (16 CFR Part 425) requires subscription-based businesses to obtain explicit informed consent from consumers before charging recurring fees and to provide a simple cancellation mechanism. Violations carry civil penalties of $51,744 per offense and the rule applies to all subscription services sold to US consumers.",
    expected: {
      agency: ["FTC"],
      regulation_name: ["Negative Option Rule", "16 CFR Part 425"],
      penalty: ["$51,744 per offense"],
      jurisdiction: ["US"],
      affected_product_category: ["subscription services"],
    },
  },
  // 25 – FDA / FSMA / produce safety rule
  {
    text: "FDA's Food Safety Modernization Act (FSMA) Produce Safety Rule (21 CFR Part 112) establishes science-based standards for growing, harvesting, and packing produce. Small farms with less than $1M in annual sales have until January 26, 2025 to comply; violations carry penalties up to $500,000 per facility per year.",
    expected: {
      agency: ["FDA"],
      regulation_name: ["Food Safety Modernization Act", "FSMA", "21 CFR Part 112"],
      deadline: ["January 26, 2025"],
      penalty: ["$500,000 per facility per year"],
      affected_product_category: ["produce"],
    },
  },
];

// ── F1 computation ────────────────────────────────────────────────────────────

function normalizeSpan(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    // Strip leading articles to reduce annotation-boundary noise
    .replace(/^(the|a|an) /, "");
}

/**
 * Partial match: two normalized spans match if one is a substring of the other
 * AND they share the same entity type. This handles common annotation boundary
 * variants: "FDA" matches "the FDA", "EFSA" matches "European Food Safety
 * Authority (EFSA)", "$50,000" matches "$50,000 per violation".
 */
function partialMatch(pred: string, gt: string): boolean {
  return pred.includes(gt) || gt.includes(pred);
}

interface NerMetrics {
  /** Strict: exact normalized span match */
  f1: number;
  precision: number;
  recall: number;
  perEntityF1: Record<string, number>;
  /** Partial: substring containment match */
  f1_partial: number;
  precision_partial: number;
  recall_partial: number;
  perEntityF1Partial: Record<string, number>;
}

function computeNerMetrics(
  allPredicted: EntityMention[][],
  allGroundTruth: EntityMention[][]
): NerMetrics {
  let totalTpStrict = 0, totalFpStrict = 0, totalFnStrict = 0;
  let totalTpPartial = 0, totalFpPartial = 0, totalFnPartial = 0;

  const entityTpS: Record<string, number> = {};
  const entityFpS: Record<string, number> = {};
  const entityFnS: Record<string, number> = {};
  const entityTpP: Record<string, number> = {};
  const entityFpP: Record<string, number> = {};
  const entityFnP: Record<string, number> = {};
  const entityTypes = new Set<string>();

  for (let i = 0; i < allPredicted.length; i++) {
    const predicted = allPredicted[i];
    const groundTruth = allGroundTruth[i];

    const gtByType: Record<string, string[]> = {};
    for (const e of groundTruth) {
      entityTypes.add(e.type);
      if (!gtByType[e.type]) gtByType[e.type] = [];
      gtByType[e.type].push(normalizeSpan(e.text));
    }

    const predByType: Record<string, string[]> = {};
    for (const e of predicted) {
      entityTypes.add(e.type);
      if (!predByType[e.type]) predByType[e.type] = [];
      predByType[e.type].push(normalizeSpan(e.text));
    }

    const allTypes = new Set([...Object.keys(gtByType), ...Object.keys(predByType)]);

    for (const t of allTypes) {
      if (!entityTpS[t]) { entityTpS[t] = 0; entityFpS[t] = 0; entityFnS[t] = 0; }
      if (!entityTpP[t]) { entityTpP[t] = 0; entityFpP[t] = 0; entityFnP[t] = 0; }

      const gtSpans = gtByType[t] ?? [];
      const predSpans = predByType[t] ?? [];

      // ── Strict (exact normalized match) ──────────────────────────────────
      const gtSet = new Set(gtSpans);
      let tpS = 0, fpS = 0, fnS = 0;
      for (const span of predSpans) {
        if (gtSet.has(span)) tpS++;
        else fpS++;
      }
      const predSet = new Set(predSpans);
      for (const span of gtSpans) {
        if (!predSet.has(span)) fnS++;
      }
      totalTpStrict += tpS; totalFpStrict += fpS; totalFnStrict += fnS;
      entityTpS[t] += tpS; entityFpS[t] += fpS; entityFnS[t] += fnS;

      // ── Partial (substring containment match) ─────────────────────────────
      // Greedy match: each ground-truth span can absorb at most one prediction.
      const gtMatched = new Array(gtSpans.length).fill(false);
      let tpP = 0, fpP = 0;
      for (const pred of predSpans) {
        let matched = false;
        for (let j = 0; j < gtSpans.length; j++) {
          if (!gtMatched[j] && partialMatch(pred, gtSpans[j])) {
            gtMatched[j] = true;
            matched = true;
            break;
          }
        }
        if (matched) tpP++;
        else fpP++;
      }
      const fnP = gtMatched.filter((v) => !v).length;
      totalTpPartial += tpP; totalFpPartial += fpP; totalFnPartial += fnP;
      entityTpP[t] += tpP; entityFpP[t] += fpP; entityFnP[t] += fnP;
    }
  }

  function calcF1(tp: number, fp: number, fn: number): number {
    const p = tp / Math.max(1, tp + fp);
    const r = tp / Math.max(1, tp + fn);
    return tp === 0 ? 0 : (2 * p * r) / (p + r);
  }
  function pct(n: number) { return parseFloat((n * 100).toFixed(1)); }

  const pS = totalTpStrict / Math.max(1, totalTpStrict + totalFpStrict);
  const rS = totalTpStrict / Math.max(1, totalTpStrict + totalFnStrict);
  const pP = totalTpPartial / Math.max(1, totalTpPartial + totalFpPartial);
  const rP = totalTpPartial / Math.max(1, totalTpPartial + totalFnPartial);

  const perEntityF1: Record<string, number> = {};
  const perEntityF1Partial: Record<string, number> = {};
  for (const t of entityTypes) {
    perEntityF1[t] = pct(calcF1(entityTpS[t] ?? 0, entityFpS[t] ?? 0, entityFnS[t] ?? 0));
    perEntityF1Partial[t] = pct(calcF1(entityTpP[t] ?? 0, entityFpP[t] ?? 0, entityFnP[t] ?? 0));
  }

  return {
    f1: pct(totalTpStrict === 0 ? 0 : (2 * pS * rS) / (pS + rS)),
    precision: pct(pS),
    recall: pct(rS),
    perEntityF1,
    f1_partial: pct(totalTpPartial === 0 ? 0 : (2 * pP * rP) / (pP + rP)),
    precision_partial: pct(pP),
    recall_partial: pct(rP),
    perEntityF1Partial,
  };
}

// Build flat ground truth mention list from an example
function groundTruthMentions(example: EvalExample): EntityMention[] {
  const out: EntityMention[] = [];
  for (const [type, spans] of Object.entries(example.expected)) {
    for (const text of spans) {
      if (text) out.push({ type, text });
    }
  }
  return out;
}

/**
 * Count how many ground-truth annotations exist per entity type across all
 * eval examples. Determines which per-entity F1 scores are statistically
 * reliable (≥ 15 annotations needed for useful signal).
 */
export function countAnnotations(examples: EvalExample[]): AnnotationCounts {
  const counts: AnnotationCounts = {};
  for (const ex of examples) {
    for (const [type, spans] of Object.entries(ex.expected)) {
      const n = spans.filter(Boolean).length;
      counts[type] = (counts[type] ?? 0) + n;
    }
  }
  return counts;
}

// ── GLiNER evaluation ─────────────────────────────────────────────────────────

type PioneerRaw = {
  result?: { data?: { entities?: Record<string, Array<{ text: string; confidence?: number }>> } };
  entities?: Array<{ label: string; text: string; score?: number }>;
};

function parsePioneerEntities(raw: unknown): EntityMention[] {
  const data = raw as PioneerRaw | null;
  if (!data) return [];

  const nested = data.result?.data?.entities;
  if (nested) {
    return Object.entries(nested).flatMap(([type, spans]) =>
      spans.map((s) => ({ type, text: s.text }))
    );
  }
  return (data.entities ?? []).map((e) => ({ type: e.label, text: e.text }));
}

async function runGlinerInference(
  modelId: string,
  text: string
): Promise<EntityMention[]> {
  const res = await fetch(`${PIONEER_BASE}/inference`, {
    method: "POST",
    headers: pioneerHeaders(),
    body: JSON.stringify({
      model_id: modelId,
      text: text.slice(0, 6000),
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
      },
      threshold: 0.35,
    }),
  });
  if (!res.ok) return [];
  return parsePioneerEntities(await res.json());
}

export async function evaluateGlinerModel(
  modelId: string,
  examples: EvalExample[]
): Promise<ModelResult> {
  const CONCURRENCY = 5;
  const allPredicted: EntityMention[][] = new Array(examples.length).fill([]);
  const latencies: number[] = [];

  for (let i = 0; i < examples.length; i += CONCURRENCY) {
    const batch = examples.slice(i, i + CONCURRENCY);
    const t0 = Date.now();
    const results = await Promise.all(
      batch.map((ex) => runGlinerInference(modelId, ex.text).catch(() => [] as EntityMention[]))
    );
    const elapsed = Date.now() - t0;
    latencies.push(elapsed / batch.length);
    for (let j = 0; j < results.length; j++) {
      allPredicted[i + j] = results[j];
    }
  }

  const allGroundTruth = examples.map(groundTruthMentions);
  const metrics = computeNerMetrics(allPredicted, allGroundTruth);
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  return {
    f1: metrics.f1,
    precision: metrics.precision,
    recall: metrics.recall,
    f1_partial: metrics.f1_partial,
    precision_partial: metrics.precision_partial,
    recall_partial: metrics.recall_partial,
    latency_ms: avgLatency,
    perEntityF1: metrics.perEntityF1,
    perEntityF1Partial: metrics.perEntityF1Partial,
  };
}

// ── LLM evaluation ────────────────────────────────────────────────────────────

// 5-shot examples used in the LLM prompt — distinct from the 25 eval examples
const FEW_SHOT_EXAMPLES = [
  {
    text: "The FDA required removal of ephedrine from all dietary supplements sold in the United States by April 12, 2004.",
    json: '{"agency":["FDA"],"regulated_substance":["ephedrine"],"affected_product_category":["dietary supplements"],"jurisdiction":["United States"],"deadline":["April 12, 2004"]}',
  },
  {
    text: "California Prop 65 requires businesses selling products in California to provide clear warnings before knowingly exposing anyone to chemicals on its list.",
    json: '{"regulation_name":["California Prop 65"],"jurisdiction":["California"]}',
  },
  {
    text: "The FTC banned the claim 'prevents Alzheimer disease' from neurocognitive supplement labels and imposed $8M in fines on BrainHealth Corp.",
    json: '{"agency":["FTC"],"prohibited_claim":["prevents Alzheimer disease"],"penalty":["$8M"],"affected_product_category":["neurocognitive supplements"]}',
  },
  {
    text: "EFSA restricted the use of titanium dioxide (E171) as a food additive across EU member states effective August 2022.",
    json: '{"agency":["EFSA"],"regulated_substance":["titanium dioxide","E171"],"jurisdiction":["EU"],"deadline":["August 2022"]}',
  },
  {
    text: "Under REACH Regulation 1907/2006, PFAS above 1 ppb in food packaging are banned in the European Union; manufacturers face fines up to €200,000.",
    json: '{"regulation_name":["REACH Regulation 1907/2006"],"regulated_substance":["PFAS"],"affected_product_category":["food packaging"],"jurisdiction":["European Union"],"penalty":["€200,000"]}',
  },
];

function buildLlmPrompt(text: string): string {
  const shotBlock = FEW_SHOT_EXAMPLES.map(
    (s, i) => `Example ${i + 1}:\nText: ${s.text}\nJSON: ${s.json}`
  ).join("\n\n");

  return `You are a regulatory Named Entity Recognition (NER) system. Extract entities from regulatory compliance text and return ONLY a JSON object.

Entity types to extract:
- regulation_name: official names/citations of laws, rules, or regulations
- regulated_substance: specific chemicals, compounds, or ingredients that are regulated
- agency: government regulatory bodies or agencies
- deadline: specific dates or time periods for compliance
- penalty: fines, civil penalties, or sanctions
- affected_product_category: categories of products subject to the regulation
- jurisdiction: geographic areas where the regulation applies
- prohibited_claim: marketing claims that are banned or restricted

Rules:
- Each value must be an array of exact text spans found in the input.
- Only include entity types where you found at least one entity.
- Do not include entities you are not confident about.
- Output ONLY the raw JSON object, no explanation.

${shotBlock}

Text: ${text}
JSON:`;
}

type LlmExtracted = Record<string, string | string[]>;

function parseLlmOutput(raw: string): EntityMention[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.search(/\{/);
  if (start < 0) return [];
  try {
    const obj = JSON.parse(cleaned.slice(start)) as LlmExtracted;
    const out: EntityMention[] = [];
    for (const [type, value] of Object.entries(obj)) {
      const spans = Array.isArray(value) ? value : [value];
      for (const span of spans) {
        if (typeof span === "string" && span.trim()) {
          out.push({ type, text: span.trim() });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function evaluateLlm(
  modelName: string,
  examples: EvalExample[]
): Promise<ModelResult> {
  const client = new OpenAI({
    apiKey: process.env.PIONEER_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.PIONEER_BASE_URL ?? "https://api.pioneer.ai/v1",
  });

  const CONCURRENCY = 5;
  const allPredicted: EntityMention[][] = new Array(examples.length).fill([]);
  const latencies: number[] = [];

  for (let i = 0; i < examples.length; i += CONCURRENCY) {
    const batch = examples.slice(i, i + CONCURRENCY);
    const t0 = Date.now();

    const results = await Promise.all(
      batch.map(async (ex) => {
        try {
          const resp = await client.chat.completions.create({
            model: modelName,
            max_tokens: 600,
            temperature: 0.0,
            messages: [
              {
                role: "system",
                content:
                  "You are a regulatory NER system. Output ONLY a raw JSON object — no markdown, no commentary.",
              },
              { role: "user", content: buildLlmPrompt(ex.text) },
            ],
          });
          const text = resp.choices[0]?.message?.content ?? "";
          return parseLlmOutput(text);
        } catch {
          return [] as EntityMention[];
        }
      })
    );

    const elapsed = Date.now() - t0;
    latencies.push(elapsed / batch.length);
    for (let j = 0; j < results.length; j++) {
      allPredicted[i + j] = results[j];
    }
  }

  const allGroundTruth = examples.map(groundTruthMentions);
  const metrics = computeNerMetrics(allPredicted, allGroundTruth);
  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  return {
    f1: metrics.f1,
    precision: metrics.precision,
    recall: metrics.recall,
    f1_partial: metrics.f1_partial,
    precision_partial: metrics.precision_partial,
    recall_partial: metrics.recall_partial,
    latency_ms: avgLatency,
    perEntityF1: metrics.perEntityF1,
    perEntityF1Partial: metrics.perEntityF1Partial,
  };
}

// ── Full benchmark orchestrator ───────────────────────────────────────────────

/**
 * Fetch the real F1/precision/recall that Pioneer computed on its own
 * held-out validation split during training. This is more credible than the
 * 25-example synthetic eval set because:
 * 1. Pioneer splits the data before training — eval examples were never seen.
 * 2. Pioneer's split is ~60 examples (80/20 of 300), not 25.
 * 3. It was computed before any of our hand-written examples existed.
 */
export async function fetchPioneerJobMetrics(
  jobId: string
): Promise<PioneerJobMetrics | null> {
  if (!process.env.PIONEER_API_KEY) return null;
  try {
    const res = await fetch(
      `${PIONEER_BASE}/felix/training-jobs/${jobId}`,
      { headers: pioneerHeaders(), cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const m = data.metrics;
    if (!m || typeof m.f1 !== "number") return null;
    return {
      f1: parseFloat((m.f1 * 100).toFixed(1)),
      precision: parseFloat((m.precision * 100).toFixed(1)),
      recall: parseFloat((m.recall * 100).toFixed(1)),
      jobId,
      status: data.status ?? "unknown",
    };
  } catch {
    return null;
  }
}

function makeEmptyResult(error: string): ModelResult {
  return {
    f1: 0, precision: 0, recall: 0,
    f1_partial: 0, precision_partial: 0, recall_partial: 0,
    latency_ms: 0, perEntityF1: {}, perEntityF1Partial: {}, error,
  };
}

export async function runBenchmark(): Promise<BenchmarkResults> {
  if (!process.env.PIONEER_API_KEY) {
    throw new Error("PIONEER_API_KEY is not set");
  }

  const fineTunedModelId = process.env.PIONEER_GLINER_MODEL ?? BASE_GLINER_MODEL;
  const hasFineTunedModel = fineTunedModelId !== BASE_GLINER_MODEL;
  const llmModel = process.env.PIONEER_MODEL ?? "claude-sonnet-4-6";
  const examples = EVAL_EXAMPLES;

  // Run all models + Pioneer training metrics in parallel
  const [
    glinerBaseResult,
    fineTunedResult,
    claudeResult,
    gpt4oResult,
    pioneerJobMetrics,
  ] = await Promise.all([
    evaluateGlinerModel(BASE_GLINER_MODEL, examples).catch(
      (e: Error): ModelResult => makeEmptyResult(e.message)
    ),
    hasFineTunedModel
      ? evaluateGlinerModel(fineTunedModelId, examples).catch(
          (e: Error): ModelResult => makeEmptyResult(e.message)
        )
      : Promise.resolve(null as ModelResult | null),
    evaluateLlm(llmModel, examples).catch(
      (e: Error): ModelResult => makeEmptyResult(e.message)
    ),
    evaluateLlm("gpt-4o", examples).catch(
      (e: Error): ModelResult => makeEmptyResult(e.message)
    ),
    hasFineTunedModel
      ? fetchPioneerJobMetrics(fineTunedModelId)
      : Promise.resolve(null),
  ]);

  const models: Record<string, ModelResult> = {
    "gliner-base": glinerBaseResult,
    "claude35": claudeResult,
    "gpt4o": gpt4oResult,
  };

  if (hasFineTunedModel && fineTunedResult) {
    models["pioneer-ft"] = fineTunedResult;
  }

  return {
    models,
    timestamp: new Date().toISOString(),
    examplesCount: examples.length,
    hasFineTunedModel,
    annotationCounts: countAnnotations(examples),
    pioneerJobMetrics,
  };
}
