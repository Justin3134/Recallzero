import "server-only";
import { tavilySearch } from "@/lib/tavily";
import {
  assessMarketBatch,
  assessProductFindings,
  assessRetailers,
  assessStates,
  distillNews,
  summarizeOverall,
} from "@/lib/ai";
import { MARKETS, type Market } from "@/lib/markets";
import { US_STATES } from "@/lib/states";
import { getMarketFallbacks } from "@/lib/market-knowledge";
import type {
  ActionStep,
  ComplianceAnalysis,
  CountryVerdict,
  NewsCard,
  ProductFinding,
  ProductInput,
  RetailerVerdict,
  StateVerdict,
  Severity,
  TavilyResult,
} from "@/types";

const DEFAULT_RETAILERS = ["Whole Foods", "Walmart", "Amazon", "Target", "Costco"];

// Maps CheckFlow retailer IDs to human-readable names used in assessRetailers
const RETAILER_ID_TO_NAME: Record<string, string> = {
  whole_foods: "Whole Foods",
  walmart: "Walmart",
  target: "Target",
  costco: "Costco",
  amazon: "Amazon",
  sprouts: "Sprouts",
  kroger: "Kroger",
  cvs: "CVS",
  gnc: "GNC",
  vitamin_shoppe: "Vitamin Shoppe",
  heb: "H-E-B",
  wegmans: "Wegmans",
};

/** Curated baseline knowledge per retailer — shown when AI is unavailable. */
const RETAILER_FALLBACKS: Record<string, Omit<RetailerVerdict, "retailer">> = {
  "Whole Foods": {
    status: "review",
    reasons: [
      "Whole Foods maintains a published Unacceptable Ingredients list (~100+ additives) that must be audited before listing.",
      "Products high in protein with very low calories often use sweeteners or binders flagged by Whole Foods (e.g., acesulfame potassium, sucralose).",
      "Claims like '3rd-party tested' or 'no artificial ingredients' must be substantiated with documentation before buyer review.",
    ],
    requirements: [
      "Complete Whole Foods Market supplier questionnaire and submit to regional buyer.",
      "Provide third-party lab results (CoA) verifying ingredient compliance against the Unacceptable Ingredients list.",
      "Non-GMO Project Verification or USDA Organic certification strengthens acceptance odds.",
    ],
    geographic_notes: [
      "California stores require Prop 65 warnings for products exceeding safe-harbor thresholds for lead, acrylamide, or other listed substances.",
      "Northeast and Pacific regions enforce stricter regional buyer standards — ingredient thresholds may vary by distribution center.",
    ],
    action_steps: [
      "Cross-reference all ingredients against the Whole Foods Unacceptable Ingredients list at wholefoodsmarket.com/quality-standards.",
      "Contact the nearest Whole Foods regional buyer to open a supplier portal account.",
      "Obtain a CoA from a USDA-accredited lab and prepare a complete ingredient safety dossier.",
    ],
  },
  Walmart: {
    status: "review",
    reasons: [
      "Walmart has no proprietary banned-ingredient list equivalent to Whole Foods; most food products meeting FDA standards are eligible.",
      "High-protein bars sit in Walmart's Sports Nutrition or Snack Bar sets — category buyer approval and a Retail Link account are required.",
      "Items sold in Walmart must comply with the FSVP (Foreign Supplier Verification Program) if any ingredients are imported.",
    ],
    requirements: [
      "Register as a supplier via Walmart's Retail Link portal and complete the supplier onboarding questionnaire.",
      "Obtain a GlobalGAP, SQF Level 2, or BRC Global Standard food-safety certification.",
      "Product UPC/GTIN must be registered with GS1 and synced to Walmart's item data system.",
    ],
    geographic_notes: [
      "Stores in California require Prop 65 shelf warning compliance for certain sweeteners and additives.",
      "Products sold in Puerto Rico locations must carry Spanish-language labeling per FDA 21 CFR Part 101.",
    ],
    action_steps: [
      "Create a Walmart Retail Link account at retaillink.walmart.com.",
      "Obtain SQF Level 2 or equivalent food-safety certification.",
      "Submit product for Walmart's third-party item data verification before first purchase order.",
    ],
  },
  Amazon: {
    status: "review",
    reasons: [
      "Amazon has no blanket platform ban on high-protein, low-calorie food bars.",
      "Products making health or nutrient content claims must comply with FDA 21 CFR Part 101 to avoid listing takedowns.",
      "Amazon's dietary supplement and food policies require accurate listing of all ingredients and allergens matching the physical label.",
    ],
    requirements: [
      "Register brand via Amazon Brand Registry to protect listings and access A+ content.",
      "Ensure product title and description match FDA-compliant label; avoid unapproved structure-function claims.",
      "For any international Amazon marketplace (EU, UK, CA), additional country-specific labeling and import rules apply.",
    ],
    geographic_notes: [
      "Sales to California customers via Amazon require Prop 65 compliance — add required warnings to listing if applicable.",
      "UK/EU Amazon sales require UKCA/CE markings and UK/EU nutrition labeling formats (kJ instead of kcal only, traffic-light labels).",
      "Canada Amazon requires bilingual (English/French) labeling per the Safe Food for Canadians Act.",
    ],
    action_steps: [
      "Enroll in Amazon Brand Registry at brandregistry.amazon.com.",
      "Audit product claims against FDA 21 CFR 101.13 (nutrient content claims) and 101.65 (implied claims).",
      "For international sales, engage a customs broker and review each marketplace's food import requirements.",
    ],
  },
  Target: {
    status: "review",
    reasons: [
      "Target's Product Safety & Quality team reviews food products but maintains fewer proprietary ingredient restrictions than Whole Foods.",
      "Protein bars are an established, top-selling category in Target's snack set — peanut butter chocolate is a proven flavor profile.",
      "Target requires compliance with California Prop 65, FSMA Preventive Controls, and FDA labeling standards for all food suppliers.",
    ],
    requirements: [
      "Complete Target's Supplier Standards and submit through the Ariba supplier portal.",
      "Obtain a GFSI-recognized food-safety certification (SQF, BRC, or FSSC 22000).",
      "Product must carry a valid UPC registered with GS1 and meet Target's packaging and labeling standards.",
    ],
    geographic_notes: [
      "California Target locations trigger Prop 65 requirements — review product for listed chemicals at safe-harbor levels.",
      "Minnesota (Target's home state) has additional labeling requirements for certain food additives under MN Stat. § 31.101.",
    ],
    action_steps: [
      "Register as a Target supplier via the Ariba portal and request a buyer introduction.",
      "Obtain GFSI-recognized food-safety certification.",
      "Confirm Prop 65 compliance for California distribution and add warnings to packaging if needed.",
    ],
  },
  Costco: {
    status: "review",
    reasons: [
      "Costco requires products to meet Kirkland Signature-level quality thresholds or exceed the category's leading national brand.",
      "Costco's buyers evaluate cost-per-unit very aggressively — bulk/club pack sizing (e.g., 18-count box) is required for most items.",
      "Costco does not maintain a Whole-Foods-style banned ingredient list, but it enforces GFSI-certified food-safety standards.",
    ],
    requirements: [
      "GFSI-recognized food-safety certification (SQF Level 3, BRC Grade A, or FSSC 22000) is mandatory.",
      "Must be able to supply club-size pack formats and meet Costco's high-volume minimum order quantities.",
      "Costco requires supplier insurance ($5M+ general liability) and a Master Supply Agreement.",
    ],
    geographic_notes: [
      "California Costco locations require Prop 65 compliance for products containing any OEHHA-listed substances.",
      "Canadian Costco warehouses require bilingual (EN/FR) labeling and SFCA import compliance.",
      "Washington state (Costco HQ) enforces additional WSDA labeling rules for fortified food products.",
    ],
    action_steps: [
      "Obtain SQF Level 3 or BRC Grade A food-safety certification before approaching Costco buyers.",
      "Design a club-pack SKU (e.g., 18-count or 24-count) with appropriate cost structure for Costco margins.",
      "Contact Costco buyer through the Costco Vendor Portal or regional merchandising office.",
    ],
  },
};

/** Group the curated markets into small region batches for parallel calls. */
const REGION_BATCHES: { region: string; iso3: string[] }[] = [
  { region: "North America", iso3: ["USA", "CAN", "MEX"] },
  { region: "Europe", iso3: ["GBR", "DEU", "FRA", "ITA", "ESP"] },
  { region: "Asia-East", iso3: ["CHN", "JPN", "KOR"] },
  { region: "Asia-South", iso3: ["IND", "SGP"] },
  { region: "Other", iso3: ["BRA", "ARE", "AUS"] },
];

function marketsByIso3(iso3: string[]): Market[] {
  return iso3
    .map((code) => MARKETS.find((m) => m.iso3 === code))
    .filter((m): m is Market => Boolean(m));
}

function resultsToContext(results: TavilyResult[], limit = 10): string {
  return results
    .slice(0, limit)
    .map((r) => `${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n---\n\n");
}

function collect(s: PromiseSettledResult<{ results?: unknown }>): TavilyResult[] {
  return s.status === "fulfilled" ? ((s.value.results ?? []) as TavilyResult[]) : [];
}

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Build a prioritized action plan from product findings + market verdicts. */
function buildActionPlan(
  findings: ProductFinding[],
  countryVerdicts: CountryVerdict[]
): ActionStep[] {
  const steps: ActionStep[] = [];

  const sortedFindings = [...findings].sort(
    (a, b) => (SEV_RANK[a.severity] ?? 2) - (SEV_RANK[b.severity] ?? 2)
  );
  for (const f of sortedFindings.slice(0, 5)) {
    steps.push({
      priority: steps.length + 1,
      action: `${f.product}: ${f.action}`,
      regulation: f.regulation,
      deadline: null,
    });
  }

  const prohibited = countryVerdicts.filter((v) => v.status === "prohibited");
  if (prohibited.length) {
    steps.push({
      priority: steps.length + 1,
      action: `Resolve blockers before selling in ${prohibited
        .map((v) => v.country)
        .slice(0, 5)
        .join(", ")}${prohibited.length > 5 ? "…" : ""}.`,
      regulation: prohibited[0].key_regulations[0] ?? "Market-specific prohibition",
      deadline: null,
    });
  }

  const review = countryVerdicts.filter((v) => v.status === "review");
  if (review.length) {
    steps.push({
      priority: steps.length + 1,
      action: `Complete registration / labeling review for ${review.length} market${
        review.length > 1 ? "s" : ""
      } flagged for review.`,
      regulation: "Market entry requirements",
      deadline: null,
    });
  }

  if (!steps.length) {
    steps.push({
      priority: 1,
      action: "Maintain current labeling and monitor regulatory updates for your markets.",
      regulation: "Ongoing compliance",
      deadline: null,
    });
  }

  return steps;
}

function reviewFallbackVerdicts(markets: Market[], category: string): CountryVerdict[] {
  return getMarketFallbacks(markets, category);
}

/**
 * For any retailer whose AI result is missing requirements and geographic_notes
 * (meaning the AI gave incomplete or name-mismatched data), substitute the
 * curated RETAILER_FALLBACKS content so users always see useful information.
 * Preserves the per-product `products` field if set.
 */
function applyRetailerFallbacks(verdicts: RetailerVerdict[]): RetailerVerdict[] {
  return verdicts.map((v) => {
    const needsFallback = !v.requirements?.length && !v.geographic_notes?.length;
    const fb = RETAILER_FALLBACKS[v.retailer];
    if (needsFallback && fb) {
      return { ...fb, retailer: v.retailer, status: v.status, ...(v.products ? { products: v.products } : {}) };
    }
    return v;
  });
}

/**
 * Run the full compliance analysis: parallel web research, then parallel
 * focused AI calls, then deterministic assembly. Each phase degrades
 * gracefully so one failed batch never poisons the whole report.
 */
export async function runComplianceAnalysis(params: {
  company_name: string;
  category: string;
  products: ProductInput[];
  /** Specific retail channels to focus on (ids from CheckFlow, e.g. "whole_foods") */
  target_retailers?: string[];
  /** Label claims the user declared (e.g. "high_protein", "gluten_free") */
  label_claims?: string[];
  /** Market scope: "us_only" | "us_eu" | "global" (default) */
  market_scope?: string;
}): Promise<ComplianceAnalysis> {
  const company_name = params.company_name.trim();
  const category = params.category || "consumer products";
  const products = params.products;
  const market_scope = params.market_scope ?? "global";

  // Resolve which retailers to check
  const RETAILERS =
    params.target_retailers && params.target_retailers.length > 0
      ? params.target_retailers.map((id) => RETAILER_ID_TO_NAME[id] ?? id)
      : DEFAULT_RETAILERS;

  // Build claims context string for AI prompts
  const claimsContext =
    params.label_claims && params.label_claims.length > 0
      ? `Label claims on product: ${params.label_claims
          .map((c) => c.replace(/_/g, " "))
          .join(", ")}. Check regulatory requirements for each claim specifically.`
      : "";

  // Determine which region batches to run based on market scope
  const activeBatches =
    market_scope === "us_only"
      ? REGION_BATCHES.filter((b) => b.region === "North America")
      : market_scope === "us_eu"
      ? REGION_BATCHES.filter(
          (b) => b.region === "North America" || b.region === "Europe"
        )
      : REGION_BATCHES;

  const productNames = products.map((p) => p.name).filter(Boolean).join(", ");
  const labelSample = products
    .map((p) => p.label_text)
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);

  // ── Phase 1: parallel Tavily evidence ──────────────────────────────────────
  const regionSearches = activeBatches.map((b) =>
    tavilySearch(
      `${productNames} ${category} import regulations labeling requirements ${b.iso3.join(
        " "
      )} ${b.region} 2026`,
      { timeRange: "year", maxResults: 7 }
    )
  );

  // Build retailer-specific search query using the resolved retailer names
  const retailerNames = RETAILERS.slice(0, 4).join(", ");
  const claimsQuery = params.label_claims?.length
    ? ` ${params.label_claims.map((c) => c.replace(/_/g, " ")).join(" ")} claims compliance`
    : "";

  const [
    ...regionAndOtherSettled
  ] = await Promise.allSettled([
    ...regionSearches,
    tavilySearch(
      `${productNames} ${category} ${retailerNames} supplier unacceptable ingredients list banned additives standards 2026`,
      { timeRange: "year", maxResults: 5 }
    ),
    tavilySearch(
      `${productNames} ${category} ${retailerNames} supplier requirements ingredient policy shelf placement 2026`,
      { timeRange: "year", maxResults: 5 }
    ),
    tavilySearch(
      `${labelSample || productNames} ${category} banned additives ingredients label disclosure FDA EFSA requirements${claimsQuery} 2026`,
      { timeRange: "year", maxResults: 7 }
    ),
    tavilySearch(
      `${productNames} ${category} US state regulations California Prop 65 New York labeling requirements 2026`,
      { timeRange: "year", maxResults: 7 }
    ),
    tavilySearch(`${productNames} ${category} regulatory compliance recall enforcement news 2026`, {
      timeRange: "month",
      maxResults: 8,
      topic: "news",
    }),
  ]);

  // Slice results: first activeBatches.length entries are region results,
  // followed by retailerEv1, retailerEv2, ingredientEv, statesEv, newsEv
  const regionSettled = regionAndOtherSettled.slice(0, activeBatches.length);
  const [retailerEv1, retailerEv2, ingredientEv, statesEv, newsEv] =
    regionAndOtherSettled.slice(activeBatches.length) as PromiseSettledResult<{ results?: unknown }>[];

  const regionEvidence = regionSettled.map((s) =>
    resultsToContext(collect(s as PromiseSettledResult<{ results?: unknown }>))
  );
  const retailerContext = [
    resultsToContext(collect(retailerEv1)),
    resultsToContext(collect(retailerEv2)),
  ].filter(Boolean).join("\n\n");
  const ingredientContext = `${claimsContext}\n\n${resultsToContext(collect(ingredientEv))}`.trim();
  const statesContext = resultsToContext(collect(statesEv));
  const newsContext = resultsToContext(collect(newsEv), 12);

  // ── Phase 2: parallel focused AI calls ─────────────────────────────────────
  const marketBatchPromises = activeBatches.map((b, i) =>
    assessMarketBatch({
      markets: marketsByIso3(b.iso3),
      category,
      products,
      evidence: `${regionEvidence[i]}\n\n${ingredientContext}`,
    })
  );

  // Only assess product-level findings for products that have real label/ingredient data.
  // Without a label, any findings would be speculative — not fact-based.
  const productsWithLabels = products.filter((p) => p.label_text?.trim());

  const [
    marketResults,
    retailerResult,
    findingsResult,
    statesResult,
    newsResult,
  ] = await Promise.all([
    Promise.all(marketBatchPromises),
    assessRetailers({ retailers: RETAILERS, category, products, evidence: retailerContext }),
    productsWithLabels.length > 0
      ? assessProductFindings({ products: productsWithLabels, category, evidence: ingredientContext })
      : Promise.resolve(null),
    assessStates({ states: US_STATES, category, products, evidence: statesContext }),
    distillNews({ products, category, evidence: newsContext }),
  ]);

  // ── Phase 3: assemble ──────────────────────────────────────────────────────
  const country_verdicts: CountryVerdict[] = [];
  activeBatches.forEach((b, i) => {
    const batch = marketResults[i];
    if (batch && batch.length) country_verdicts.push(...batch);
    else country_verdicts.push(...reviewFallbackVerdicts(marketsByIso3(b.iso3), category));
  });

  // For market-scoped checks that didn't include all regions, fill in fallbacks
  // for excluded batches so the UI always shows some world coverage
  if (activeBatches.length < REGION_BATCHES.length) {
    const includedIso3Set = new Set(activeBatches.flatMap((b) => b.iso3));
    for (const b of REGION_BATCHES) {
      if (!b.iso3.some((code) => includedIso3Set.has(code))) {
        country_verdicts.push(...reviewFallbackVerdicts(marketsByIso3(b.iso3), category));
      }
    }
  }

  const retailer_verdicts: RetailerVerdict[] = applyRetailerFallbacks(
    retailerResult ??
    RETAILERS.map((retailer) => ({
      retailer,
      ...(RETAILER_FALLBACKS[retailer] ?? {
        status: "review" as const,
        reasons: ["Standards data unavailable — verify supplier requirements directly."],
        requirements: [],
        geographic_notes: [],
        action_steps: ["Contact retailer's supplier portal to begin onboarding process."],
      }),
    }))
  );

  const product_findings: ProductFinding[] = findingsResult ?? [];

  const state_verdicts: StateVerdict[] =
    statesResult ??
    US_STATES.map((s) => ({
      state: s.name,
      code: s.code,
      status: "review" as const,
      reasons: [s.focus],
      key_regulations: [],
    }));

  const news: NewsCard[] = newsResult ?? [];

  const { overall_status, overall_score, summary } = await summarizeOverall({
    company_name,
    category,
    countryVerdicts: country_verdicts,
    productFindings: product_findings,
  });

  const action_plan = buildActionPlan(product_findings, country_verdicts);

  return {
    overall_status,
    overall_score,
    summary,
    product_findings,
    country_verdicts,
    state_verdicts,
    retailer_verdicts,
    action_plan,
    news,
  };
}

/** Runs only the market/state analysis for a single product — fast path for per-product tab switching. */
export async function runMarketAnalysis(params: {
  category: string;
  products: ProductInput[];
  market_scope?: string;
}): Promise<{ country_verdicts: CountryVerdict[]; state_verdicts: StateVerdict[] }> {
  const { category, products } = params;
  const market_scope = params.market_scope ?? "global";
  const productNames = products.map((p) => p.name).filter(Boolean).join(", ");

  const activeBatches =
    market_scope === "us_only"
      ? REGION_BATCHES.filter((b) => b.region === "North America")
      : market_scope === "us_eu"
      ? REGION_BATCHES.filter((b) => b.region === "North America" || b.region === "Europe")
      : REGION_BATCHES;

  const regionSearches = activeBatches.map((b) =>
    tavilySearch(
      `${productNames} ${category} import regulations labeling requirements ${b.iso3.join(" ")} ${b.region} 2026`,
      { timeRange: "year", maxResults: 5 }
    )
  );

  const [statesSettled, ...regionSettled] = await Promise.allSettled([
    tavilySearch(
      `${productNames} ${category} US state regulations California Prop 65 New York labeling requirements 2026`,
      { timeRange: "year", maxResults: 5 }
    ),
    ...regionSearches,
  ]);

  const regionEvidence = regionSettled.map((s) =>
    resultsToContext(collect(s as PromiseSettledResult<{ results?: unknown }>))
  );
  const statesContext = resultsToContext(collect(statesSettled as PromiseSettledResult<{ results?: unknown }>));

  const marketBatchPromises = activeBatches.map((b, i) =>
    assessMarketBatch({
      markets: marketsByIso3(b.iso3),
      category,
      products,
      evidence: regionEvidence[i] ?? "",
    })
  );

  const [marketResults, statesResult] = await Promise.all([
    Promise.all(marketBatchPromises),
    assessStates({ states: US_STATES, category, products, evidence: statesContext }),
  ]);

  const country_verdicts: CountryVerdict[] = [];
  activeBatches.forEach((b, i) => {
    const batch = marketResults[i];
    if (batch && batch.length) country_verdicts.push(...batch);
    else country_verdicts.push(...reviewFallbackVerdicts(marketsByIso3(b.iso3), category));
  });

  if (activeBatches.length < REGION_BATCHES.length) {
    const includedIso3Set = new Set(activeBatches.flatMap((b) => b.iso3));
    for (const b of REGION_BATCHES) {
      if (!b.iso3.some((code) => includedIso3Set.has(code))) {
        country_verdicts.push(...reviewFallbackVerdicts(marketsByIso3(b.iso3), category));
      }
    }
  }

  const state_verdicts: StateVerdict[] =
    statesResult ??
    US_STATES.map((s) => ({
      state: s.name,
      code: s.code,
      status: "review" as const,
      reasons: [s.focus],
      key_regulations: [],
    }));

  return { country_verdicts, state_verdicts };
}

/** Runs only the retailer analysis — fast path for the reload button. */
export async function runRetailerAnalysis(params: {
  category: string;
  products: ProductInput[];
}): Promise<RetailerVerdict[]> {
  const { category, products } = params;
  const productNames = products.map((p) => p.name).join(", ");

  const [ev1, ev2] = await Promise.allSettled([
    tavilySearch(
      `${productNames} ${category} Whole Foods supplier unacceptable ingredients list banned additives standards 2026`,
      { timeRange: "year", maxResults: 5 }
    ),
    tavilySearch(
      `${productNames} ${category} Walmart Target Costco Amazon supplier requirements ingredient policy shelf placement 2026`,
      { timeRange: "year", maxResults: 5 }
    ),
  ]);

  const retailerContext = [
    resultsToContext(collect(ev1)),
    resultsToContext(collect(ev2)),
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await assessRetailers({
    retailers: DEFAULT_RETAILERS,
    category,
    products,
    evidence: retailerContext,
  });

  return applyRetailerFallbacks(
    result ??
    DEFAULT_RETAILERS.map((retailer) => ({
      retailer,
      ...(RETAILER_FALLBACKS[retailer] ?? {
        status: "review" as const,
        reasons: ["Standards data unavailable — verify supplier requirements directly."],
        requirements: [],
        geographic_notes: [],
        action_steps: ["Contact retailer's supplier portal to begin onboarding process."],
      }),
    }))
  );
}
