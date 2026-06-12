import "server-only";
import OpenAI from "openai";
import { tavilySearch, tavilyExtract } from "@/lib/tavily";
import { getAgenciesForProfile } from "@/lib/regulatory-sources";
import type { Market } from "@/lib/markets";
import type { USState } from "@/lib/states";
import type {
  ActionStep,
  CompanyProfile,
  CountryVerdict,
  Finding,
  MarketStatus,
  NewsCard,
  OverallRisk,
  Priority,
  ProductFinding,
  ProductInput,
  RetailerVerdict,
  Severity,
  StateVerdict,
} from "@/types";

const client = new OpenAI({
  apiKey: process.env.PIONEER_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL:
    process.env.PIONEER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.pioneer.ai/v1",
});
const MODEL =
  process.env.PIONEER_MODEL ?? process.env.OPENAI_MODEL ?? "claude-sonnet-4-6";

export class AiUnavailableError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let s = (fenced ? fenced[1] : text).trim();
  // Trim anything before the first JSON token.
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  return s;
}

/**
 * Attempt to repair a truncated JSON string by closing any open strings,
 * arrays, and objects. Best-effort — lets a cut-off model response still parse.
 */
function salvageJson(raw: string): string {
  let s = raw.trim();
  // Drop a trailing partial token after the last comma if the string was cut.
  // Walk the string tracking structure; ignore escaped chars and string bodies.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      if (!inString) lastSafe = i + 1;
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
    if (c === "}" || c === "]" || c === '"') lastSafe = i + 1;
    else if (!/\s/.test(c)) lastSafe = i + 1;
  }
  // If we ended mid-string, cut back to the last completed value.
  if (inString) {
    s = s.slice(0, lastSafe);
    // Remove a dangling key like  "foo": "bar...  -> drop the partial pair
    s = s.replace(/,\s*"[^"]*"\s*:\s*$/, "");
    s = s.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/, "");
  }
  // Drop a trailing comma.
  s = s.replace(/,\s*$/, "");
  // Close any still-open structures.
  while (stack.length) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }
  return s;
}

function parseJsonLoose<T>(text: string): T | null {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    try {
      return JSON.parse(salvageJson(cleaned)) as T;
    } catch {
      return null;
    }
  }
}

export async function jsonCompletion<T>(prompt: string, maxTokens = 2000): Promise<T | null> {
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a compliance analyst. Respond ONLY with valid JSON. No markdown fences, no commentary, no explanation — just the raw JSON object.",
        },
        { role: "user", content: prompt },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    const parsed = parseJsonLoose<T>(text);
    if (parsed === null) {
      console.error(`AI completion returned unparseable JSON (len ${text.length}).`);
    }
    return parsed;
  } catch (err) {
    // The OpenAI SDK stores HTTP status in `status` and the raw parsed body in
    // `error`. Pioneer wraps billing errors in { detail: { code, message } }
    // which the SDK may surface either in `error` or as the raw body.
    const apiErr = err as {
      status?: number;
      code?: string;
      error?: unknown;
      message?: string;
    };

    const httpStatus = apiErr?.status ?? 0;

    // Drill into raw error body regardless of schema (OpenAI vs Pioneer formats)
    const rawBody = apiErr?.error as Record<string, unknown> | undefined;
    const detail = rawBody?.detail as Record<string, unknown> | undefined;
    const errorBlock = rawBody?.error as Record<string, unknown> | undefined;
    const pioneerCode =
      (detail?.code as string | undefined) ??
      (errorBlock?.code as string | undefined) ??
      apiErr?.code ??
      "";

    // Pioneer 403 billing gate
    if (httpStatus === 403) {
      const billingUrl =
        (detail?.billing_url as string | undefined) ?? "https://agent.pioneer.ai/billing";
      console.error(
        `[Pioneer] Inference blocked — subscription required. Activate your plan at: ${billingUrl}`
      );
      // Return null; callers degrade to curated knowledge fallback (no throw).
      return null;
    }

    if (pioneerCode === "billing_not_active" || httpStatus === 429) {
      const msg =
        (detail?.message as string | undefined) ??
        (errorBlock?.message as string | undefined) ??
        apiErr?.message ??
        "AI service billing is not active.";
      console.error("AI completion failed (billing):", msg);
      throw new AiUnavailableError(msg, pioneerCode || "billing_not_active");
    }

    const errMsg =
      (detail?.message as string | undefined) ??
      (errorBlock?.message as string | undefined) ??
      (err instanceof Error ? err.message : String(err));
    console.error(`AI completion failed [${httpStatus || "?"}] ${errMsg}`);
    return null;
  }
}

export interface SynthesizedAlert {
  is_relevant: boolean;
  title: string;
  summary: string;
  severity: Severity;
  affected_products: string[];
  required_action: string;
  deadline: string | null;
  confidence: number;
}

/** Map a regulatory finding to a company's specific products. */
export async function synthesizeRegulatoryAlert(params: {
  regulatoryUpdate: string;
  companyProfile: CompanyProfile;
  sourceUrl: string;
  sourceTitle?: string;
}): Promise<SynthesizedAlert | null> {
  const { regulatoryUpdate, companyProfile, sourceUrl } = params;

  const result = await jsonCompletion<SynthesizedAlert>(
    `You are a regulatory compliance analyst. Analyze this regulatory update and determine its impact on this specific company.

REGULATORY UPDATE:
${regulatoryUpdate.slice(0, 4000)}

COMPANY PROFILE:
Company: ${companyProfile.name}
Description: ${companyProfile.description ?? "n/a"}
Industry: ${companyProfile.industry}
Products/Services: ${JSON.stringify(companyProfile.products)}
${companyProfile.ingredients?.length ? `Key Ingredients/Compounds: ${JSON.stringify(companyProfile.ingredients)}` : ""}
${companyProfile.claims?.length ? `Marketing Claims: ${JSON.stringify(companyProfile.claims)}` : ""}
Jurisdictions: ${JSON.stringify(companyProfile.jurisdictions)}
Source: ${sourceUrl}

Be strict about relevance: only mark is_relevant true if this update plausibly affects this company's actual products, claims, operations, or jurisdictions. Generic industry news is not relevant.

Respond ONLY with a JSON object:
{
  "is_relevant": boolean,
  "title": "short alert title (max 90 chars)",
  "summary": "2-3 sentence plain English summary of what changed and why it matters to THIS company",
  "severity": "critical" | "high" | "medium" | "low",
  "affected_products": ["company's specific products/services affected"],
  "required_action": "specific action the company must take",
  "deadline": "deadline if mentioned, else null",
  "confidence": 0.0-1.0
}`,
    1500
  );
  return result ?? fallbackAlert(params);
}

/** Heuristic fallback when the LLM is unavailable — keeps the product functional. */
function fallbackAlert(params: {
  regulatoryUpdate: string;
  companyProfile: CompanyProfile;
  sourceUrl: string;
  sourceTitle?: string;
}): SynthesizedAlert | null {
  const text = params.regulatoryUpdate.toLowerCase();
  const profile = params.companyProfile;
  const signals = [
    profile.industry,
    ...(profile.products ?? []),
    ...(profile.ingredients ?? []),
    ...(profile.claims ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);

  const matched = Array.from(new Set(signals.filter((w) => text.includes(w))));
  if (matched.length === 0) return null;

  let severity: Severity = "medium";
  if (/recall|enforcement|penalt|fine|violation|ban|prohibit/.test(text)) severity = "high";
  if (/immediate|critical|class i recall|cease/.test(text)) severity = "critical";
  if (/proposal|comment period|draft|consider/.test(text)) severity = "low";

  const firstSentence = params.regulatoryUpdate.split(/(?<=[.!?])\s+/)[0]?.slice(0, 200) ?? "";

  return {
    is_relevant: true,
    title: (params.sourceTitle ?? firstSentence).slice(0, 90),
    summary: `${firstSentence} This update matches your business profile (${matched
      .slice(0, 4)
      .join(", ")}). Review the source for full details.`,
    severity,
    affected_products: (profile.products ?? []).filter((p) =>
      p
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((w) => w.length > 3 && text.includes(w))
    ),
    required_action: "Review the source update and assess applicability with your compliance team.",
    deadline: null,
    confidence: 0.62,
  };
}

export interface DocumentAudit {
  overall_risk: OverallRisk;
  risk_score: number;
  findings: Finding[];
  regulations_checked: string[];
  summary: string;
}

/** Audit an uploaded document against live regulations. */
export async function auditDocument(params: {
  documentText: string;
  fileName: string;
  industry: string;
  jurisdictions: string[];
  regulatoryContext: string;
}): Promise<DocumentAudit | null> {
  const { documentText, fileName, industry, jurisdictions, regulatoryContext } = params;

  const result = await jsonCompletion<DocumentAudit>(
    `You are a compliance auditor. Review this document and identify regulatory compliance issues.

DOCUMENT (${fileName}):
${documentText.slice(0, 8000)}

INDUSTRY: ${industry}
JURISDICTIONS: ${jurisdictions.join(", ")}

CURRENT REGULATORY CONTEXT (from live web search):
${regulatoryContext.slice(0, 4000)}

Identify concrete issues: missing disclosures, prohibited claims, labeling violations, missing safety language, non-compliant terms, etc. Cite the specific regulation or standard for each. If the document is clean, say so.

Respond ONLY with JSON:
{
  "overall_risk": "pass" | "review" | "fail",
  "risk_score": 0-100 (0 = fully compliant, 100 = severe violations),
  "findings": [
    {
      "issue": "description of the compliance issue",
      "regulation": "which regulation or standard is relevant",
      "severity": "critical" | "high" | "medium" | "low",
      "location": "where in the document this appears",
      "recommendation": "what to change or fix"
    }
  ],
  "regulations_checked": ["regulations reviewed"],
  "summary": "2-3 sentence overall assessment"
}`,
    2500
  );
  return result ?? fallbackAudit(params);
}

/** Heuristic fallback audit when the LLM is unavailable. */
function fallbackAudit(params: {
  documentText: string;
  fileName: string;
  industry: string;
  jurisdictions: string[];
}): DocumentAudit {
  const text = params.documentText.toLowerCase();
  const findings: Finding[] = [];

  const checks: { pattern: RegExp; missing?: boolean; finding: Finding }[] = [
    {
      pattern: /guarantee|risk[- ]free|no risk|100% safe/,
      finding: {
        issue: "Absolute or guarantee-style claim detected",
        regulation: "FTC Act Section 5 (deceptive practices)",
        severity: "high",
        location: "Claim language in document body",
        recommendation: "Remove or qualify absolute claims; substantiate with evidence.",
      },
    },
    {
      pattern: /cure|treat|prevent|heal/,
      finding: {
        issue: "Potential disease claim language",
        regulation: "FDA labeling rules (21 CFR 101.93) / FTC health claims guidance",
        severity: "high",
        location: "Marketing or label copy",
        recommendation: "Remove disease claims unless approved; use structure/function language.",
      },
    },
    {
      pattern: /apr|interest rate|finance charge/,
      finding: {
        issue: "Credit terms present — verify TILA/Reg Z disclosure completeness",
        regulation: "Truth in Lending Act / Regulation Z",
        severity: "medium",
        location: "Pricing and terms sections",
        recommendation: "Ensure APR, finance charges, and payment schedule disclosures are complete and conspicuous.",
      },
    },
  ];

  for (const c of checks) {
    if (c.pattern.test(text)) findings.push(c.finding);
  }

  const score = Math.min(95, 20 + findings.length * 25);
  return {
    overall_risk: findings.length === 0 ? "pass" : findings.length >= 2 ? "fail" : "review",
    risk_score: findings.length === 0 ? 12 : score,
    findings,
    regulations_checked: [
      "FTC Act Section 5",
      params.industry === "fintech" ? "TILA / Regulation Z" : "FDA labeling rules",
    ],
    summary:
      findings.length === 0
        ? "No obvious compliance red flags detected in automated review. A manual review is still recommended."
        : `${findings.length} potential compliance issue(s) detected in automated review. Validate against current ${params.jurisdictions.join(", ")} requirements.`,
  };
}

export interface SurfaceMapResult {
  agencies: {
    name: string;
    jurisdiction: string;
    relevance: string;
    relevance_score: number;
    priority: Priority;
    key_regulations: string[];
    watch_url?: string;
  }[];
  total_exposure: string;
}

/** Map a company's full regulatory surface area. */
export async function mapRegulatorySurface(
  companyProfile: CompanyProfile
): Promise<SurfaceMapResult> {
  const result = await jsonCompletion<SurfaceMapResult>(
    `You are a regulatory expert. Map the complete regulatory surface area for this company.

COMPANY PROFILE:
${JSON.stringify(companyProfile, null, 2)}

List every regulatory body, agency, and standard that plausibly applies to this company across all of its jurisdictions, including federal, state-level, and international bodies. Be comprehensive but accurate (8-15 agencies typical).

Respond ONLY with JSON:
{
  "agencies": [
    {
      "name": "agency name",
      "jurisdiction": "US | EU | UK | US-CA | US-TX | US-NY | etc",
      "relevance": "one sentence on why this applies to this company",
      "relevance_score": 0.0-1.0,
      "priority": "critical" | "high" | "medium" | "low",
      "key_regulations": ["specific regulations/acts that apply"],
      "watch_url": "official agency homepage URL"
    }
  ],
  "total_exposure": "2-3 sentence description of overall regulatory exposure"
}`,
    3000
  );
  if (result?.agencies?.length) return result;
  return fallbackSurface(companyProfile);
}

/** Curated-list fallback when the LLM is unavailable. */
function fallbackSurface(profile: CompanyProfile): SurfaceMapResult {
  const agencies = getAgenciesForProfile(profile.industry, profile.jurisdictions);
  return {
    agencies: agencies.map((a, i) => ({
      name: a.name,
      jurisdiction: a.jurisdiction,
      relevance: `Oversees ${profile.industry} activity in ${a.jurisdiction}.`,
      relevance_score: Math.max(0.5, 0.95 - i * 0.07),
      priority: i < 2 ? "critical" : i < 4 ? "high" : "medium",
      key_regulations: a.searchTerms.slice(0, 3),
      watch_url: a.url,
    })),
    total_exposure: `Your ${profile.industry} business operating in ${profile.jurisdictions.join(
      ", "
    )} is subject to oversight from ${agencies.length} primary regulatory bodies across federal, state, and international levels.`,
  };
}

// ── Product extraction from an uploaded label ───────────────────────────────

/** Derive a product name + short description from OCR'd label / spec text. */
export async function extractProductFromLabel(
  labelText: string,
  fallbackName: string
): Promise<{ name: string; description: string }> {
  const result = await jsonCompletion<{ name: string; description: string }>(
    `From this product label / packaging / spec text, extract the product's commercial name and a one-sentence description.

LABEL TEXT:
${labelText.slice(0, 3000)}

Respond ONLY with JSON: { "name": "product name (max 6 words)", "description": "one sentence" }`,
    500
  );
  return {
    name: result?.name?.trim() || fallbackName,
    description: result?.description?.trim() || "",
  };
}

// ── Website product extraction (replaces Tavily Research API) ────────────────

/**
 * E-commerce product pages (Shopify, etc.) often render a large navigation
 * block — sometimes 10,000+ characters — before the actual ingredient/nutrition
 * data. A naive .slice(0, N) will only see nav menus and miss the label entirely.
 *
 * This helper scans the full content for the earliest nutrition/ingredient
 * section and returns a window that always includes it. When the section is near
 * the start (≤ 200 chars in) we just return a straight prefix slice since nothing
 * is being buried. When found deeper we prepend a short header excerpt (for
 * product-name context) and then jump to the nutrition block.
 */
function extractNutritionWindow(content: string, maxLen = 12000): string {
  const PATTERNS = [
    /\bINGREDIENTS\s*:/,
    /\bIngredients\s*\n/,
    /Nutrition Facts/i,
    /\bCalories\s+\d/,
  ];

  let earliestIdx = -1;
  for (const pattern of PATTERNS) {
    const m = content.match(pattern);
    if (m?.index !== undefined) {
      if (earliestIdx === -1 || m.index < earliestIdx) earliestIdx = m.index;
    }
  }

  if (earliestIdx > 200) {
    const header = content.slice(0, 400);
    const nutritionStart = Math.max(0, earliestIdx - 150);
    const nutritionSection = content.slice(nutritionStart, nutritionStart + (maxLen - 500));
    return `${header}\n\n[...]\n\n${nutritionSection}`;
  }

  return content.slice(0, maxLen);
}

export interface WebsiteProducts {
  company_name: string;
  description: string;
  products: {
    name: string;
    description: string;
    /** Ingredient list, nutrition facts, and allergen info when visible in the source content. */
    label_text?: string;
    /** Certifications visible on the product page (e.g. Non-GMO Project, Kosher, USDA Organic). */
    certifications?: string[];
    /** Label language(s) if visible (e.g. "English only", "English / Spanish bilingual"). */
    packaging_language?: string;
  }[];
}

/**
 * Extract structured company/product info from raw web search snippets.
 * Called by /api/website-products to replace the expensive Tavily Research API.
 * All inference is routed through Pioneer's OpenAI-compatible endpoint.
 */
export async function extractProductsFromWebSearch(
  url: string,
  searchText: string
): Promise<WebsiteProducts | null> {
  const result = await jsonCompletion<WebsiteProducts>(
    `You are analyzing web content about a company to extract its products and any available nutritional/ingredient details.

WEBSITE URL: ${url}

PAGE CONTENT:
${extractNutritionWindow(searchText, 15000)}

Instructions:
1. Identify the company name and write a 1-2 sentence description of what they do.
2. List up to 8 specific products or services they sell (not generic things like "customer support").
3. For each product, provide a concise name (1-4 words) and one short sentence description.
4. If the content contains ingredient lists, nutrition facts, or allergen information for a product, capture it verbatim in the "label_text" field using the following complete format. Include EVERY line present in the source — missing fields (e.g. % DV, micronutrients) can cause failed compliance checks:

Serving size: [e.g. 1 donut (67g)]
Servings per container: [N]

Calories [N]
Total Fat [X]g [X]% DV
  Saturated Fat [X]g [X]% DV
  Trans Fat [X]g
Cholesterol [X]mg [X]% DV
Sodium [X]mg [X]% DV
Total Carbohydrates [X]g [X]% DV
  Dietary Fiber [X]g [X]% DV
  Total Sugars [X]g
    Includes [X]g Added Sugars [X]% DV
  Sugar Alcohols [X]g
Protein [X]g [X]% DV
Vitamin D [X]mcg [X]% DV
Calcium [X]mg [X]% DV
Iron [X]mg [X]% DV
Potassium [X]mg [X]% DV

Ingredients
[full ingredient list verbatim]

Contains
[allergen declaration verbatim, e.g. MILK, EGGS, SOY, WHEAT]

May Contain
[may-contain list if present]

Omit any line whose value is not present in the source content. Only include "label_text" when actual ingredient/nutrition data is present — do not fabricate values.
5. If any certifications are visible on the page (e.g., "Non-GMO Project Verified", "USDA Organic", "Kosher", "Halal", "Gluten-Free Certified", "B Corp"), list them in "certifications". Leave out if none visible.
6. If the label language is visible or inferable, set "packaging_language" (e.g., "English only", "English / Spanish bilingual").

Respond ONLY with JSON:
{
  "company_name": "company name",
  "description": "1-2 sentence company description",
  "products": [
    { "name": "product name", "description": "one sentence", "label_text": "nutrition and ingredient text if available", "certifications": ["cert1"], "packaging_language": "English only" }
  ]
}`,
    3000
  );
  return result;
}

// ── Granular compliance helpers (stateless, multi-market) ───────────────────
//
// Each helper makes a SMALL, focused model call backed by its own web evidence
// so responses never truncate. The orchestrator in lib/compliance.ts fans these
// out in parallel and assembles the final ComplianceAnalysis.

const VALID_STATUS: MarketStatus[] = ["allowed", "review", "prohibited"];

function normalizeStatus(s: unknown): MarketStatus {
  return VALID_STATUS.includes(s as MarketStatus) ? (s as MarketStatus) : "review";
}

function clampScore(n: unknown, fallback = 50): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function asStringArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()).slice(0, max);
}

export function productSummary(products: ProductInput[]): string {
  return products
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.name}`];
      if (p.description) parts.push(`(${p.description})`);
      if (p.label_text) parts.push(`[label: ${p.label_text.slice(0, 2500)}]`);
      if (p.packaging_language) parts.push(`[lang: ${p.packaging_language}]`);
      if (p.certifications?.length) parts.push(`[certs: ${p.certifications.join(", ")}]`);
      if (p.packaging_notes) parts.push(`[pkg: ${p.packaging_notes}]`);
      return parts.join(" ");
    })
    .join("\n");
}

/** Assess whether the products can be sold in a small batch of markets. */
export async function assessMarketBatch(params: {
  markets: Market[];
  category: string;
  products: ProductInput[];
  evidence: string;
}): Promise<CountryVerdict[] | null> {
  const { markets, category, products, evidence } = params;
  const marketList = markets.map((m) => `${m.name} (${m.iso3})`).join(", ");
  const productNames = products.map((p) => p.name).join(", ");

  const result = await jsonCompletion<{ verdicts: Partial<CountryVerdict>[] }>(
    `You are a global trade & regulatory compliance expert. Decide, for EACH market below, whether these ${category} products can legally be sold there.

PRODUCTS:
${productSummary(products)}

MARKETS (return one verdict per market, using the EXACT iso3 in parentheses):
${marketList}

LIVE REGULATORY EVIDENCE (recent web search):
${evidence.slice(0, 4500)}

For each market choose status:
- "allowed": compliant or only minor steps needed.
- "review": notable requirements, registration, or unclear points.
- "prohibited": a key ingredient/additive/claim is banned or needs approval not held.
Cite concrete regulations (e.g. "EU Reg 1169/2011", "China GB 7718", "FSSAI 2020", "FDA 21 CFR 101") in key_regulations only. Give specific, varied reasons per market — do NOT default everything to the same status.

PER-PRODUCT DIFFERENTIATION:
- If the products have meaningfully different compliance profiles for the SAME country (e.g. different ingredients, claims, or packaging language trigger different rules), return SEPARATE verdict entries for that country — one per affected product — with a "products" array listing only the relevant product name(s).
- If all products share the same status for a country, return a single entry with NO "products" field.
- Product names to reference: ${productNames}

WRITING RULES FOR reasons[]:
- Each reason MUST be a single plain-English sentence of 15 words or fewer.
- If a market has multiple distinct requirements, use separate items — do NOT combine into one sentence.
- Do NOT repeat regulation names in the reasons text; put those in key_regulations.
- Use active voice: "Register with GACC before exporting" not "Registration with GACC is required".

Respond ONLY with JSON:
{ "verdicts": [ { "country": "name", "iso3": "USA", "status": "allowed|review|prohibited", "score": 0-100, "reasons": ["short plain-English reason"], "key_regulations": ["reg"], "products": ["Product Name"] } ] }
Note: omit the "products" field entirely when the verdict applies to all products.`,
    2800
  );

  if (!result?.verdicts) return null;

  // Build a list of (iso3 → verdicts) allowing multiple verdicts per country
  const byIso = new Map<string, Partial<CountryVerdict>[]>();
  for (const v of result.verdicts) {
    if (!v?.iso3) continue;
    const key = String(v.iso3).toUpperCase();
    const existing = byIso.get(key) ?? [];
    existing.push(v);
    byIso.set(key, existing);
  }

  const out: CountryVerdict[] = [];
  for (const m of markets) {
    const verdicts = byIso.get(m.iso3.toUpperCase());
    if (!verdicts?.length) {
      out.push({
        country: m.name,
        iso3: m.iso3,
        status: "review",
        score: 50,
        reasons: ["Standard import and labeling requirements apply."],
        key_regulations: [],
      });
      continue;
    }
    for (const v of verdicts) {
      const productsList = Array.isArray(v.products) && v.products.length
        ? v.products.map(String).filter(Boolean)
        : undefined;
      out.push({
        country: m.name,
        iso3: m.iso3,
        status: normalizeStatus(v.status),
        score: clampScore(v.score),
        reasons: asStringArray(v.reasons, 4).length
          ? asStringArray(v.reasons, 4)
          : ["Standard import and labeling requirements apply."],
        key_regulations: asStringArray(v.key_regulations, 5),
        ...(productsList ? { products: productsList } : {}),
      });
    }
  }
  return out;
}

/** Assess major US retailers' ability to carry the products. */
export async function assessRetailers(params: {
  retailers: string[];
  category: string;
  products: ProductInput[];
  evidence: string;
}): Promise<RetailerVerdict[] | null> {
  const { retailers, category, products, evidence } = params;
  const productNames = products.map((p) => p.name).join(", ");

  const result = await jsonCompletion<{ verdicts: Array<{
    retailer: string;
    status: string;
    reasons: unknown;
    requirements: unknown;
    geographic_notes: unknown;
    action_steps: unknown;
    products?: unknown;
  }> }>(
    `You are a senior retail-compliance strategist with deep knowledge of US retailer supplier programs, ingredient policies, and state/country-specific regulations. For EACH retailer below, produce a comprehensive eligibility analysis for these ${category} products.

PRODUCTS:
${productSummary(products)}

RETAILERS TO ANALYZE: ${retailers.join(", ")}

EVIDENCE (recent web research on retailer standards, supplier programs, and regulations):
${evidence.slice(0, 5000)}

For each retailer provide ALL of the following:

1. status — "allowed" | "review" | "prohibited"
   - "allowed": product clearly meets known standards with no significant changes required
   - "review": product may qualify but needs supplier audit, ingredient check, or category approval
   - "prohibited": product has a specific ingredient or attribute that violates a hard policy

2. reasons — 3–5 specific bullets explaining the verdict. Be concrete:
   - Name exact policies (e.g., "Whole Foods Unacceptable Ingredients list bans sodium benzoate")
   - Reference known bans, certifications, or shelf placement rules
   - Mention any relevant enforcement or recall precedents if applicable

3. requirements — 2–4 specific things the supplier must do or verify:
   - Certifications (Non-GMO Project, USDA Organic, Kosher, Halal, SQF/BRC/GFSI, third-party tested, etc.)
   - Label changes (front-of-pack claims, nutrition panel standards, Prop 65 warnings, bilingual labeling)
   - Documentation (supplier questionnaires, CoA, audit results)
   - Any retailer-specific onboarding portals or programs (e.g., Walmart Retail Link, Amazon Brand Registry)

4. geographic_notes — 2–4 notes on how specific US states OR countries affect sales at this retailer's locations:
   - California (Prop 65, CDPH, AB 45 for hemp/CBD, PFAS restrictions)
   - New York, Illinois, Texas, Florida state-level rules affecting shelf placement
   - For Amazon: EU marketplace rules if product ships internationally
   - Language/packaging requirements per region (e.g., Spanish labels for Puerto Rico, EN/FR for Canadian locations)

5. action_steps — 3–4 concrete prioritized next steps to either get listed or resolve blockers

PER-PRODUCT DIFFERENTIATION:
- If products have meaningfully different eligibility at the same retailer (e.g., different ingredients or missing certs for only one product), return SEPARATE verdict entries — one per affected product — with a "products" array naming the relevant product(s).
- If all products have the same eligibility, return a single entry with NO "products" field.
- Product names to reference: ${productNames}

Respond ONLY with valid JSON (no markdown, no commentary):
{
  "verdicts": [
    {
      "retailer": "Whole Foods",
      "status": "allowed|review|prohibited",
      "reasons": ["specific reason 1", "specific reason 2", "specific reason 3"],
      "requirements": ["requirement 1", "requirement 2"],
      "geographic_notes": ["state/country note 1", "state/country note 2"],
      "action_steps": ["step 1", "step 2", "step 3"],
      "products": ["Product Name"]
    }
  ]
}
Note: omit "products" entirely when the verdict applies to all products.`,
    3500
  );

  if (!result?.verdicts) return null;

  function normalizeRetailerName(n: string): string {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\b(market|markets|store|stores|warehouse|warehouses|club)\b/g, "")
      .replace(/\s+/g, "");
  }

  const byNorm = new Map<string, typeof result.verdicts[number][]>();
  for (const v of result.verdicts) {
    if (!v?.retailer) continue;
    const key = normalizeRetailerName(String(v.retailer));
    const existing = byNorm.get(key) ?? [];
    existing.push(v);
    byNorm.set(key, existing);
  }

  const out: RetailerVerdict[] = [];
  for (const retailer of retailers) {
    const verdicts = byNorm.get(normalizeRetailerName(retailer));
    if (!verdicts?.length) {
      out.push({
        retailer,
        status: "review",
        reasons: [],
        requirements: [],
        geographic_notes: [],
        action_steps: [],
      });
      continue;
    }
    for (const v of verdicts) {
      const productsList = Array.isArray(v.products) && (v.products as unknown[]).length
        ? (v.products as unknown[]).map(String).filter(Boolean)
        : undefined;
      out.push({
        retailer,
        status: normalizeStatus(v.status),
        reasons: asStringArray(v.reasons, 5),
        requirements: asStringArray(v.requirements, 4),
        geographic_notes: asStringArray(v.geographic_notes, 4),
        action_steps: asStringArray(v.action_steps, 4),
        ...(productsList ? { products: productsList } : {}),
      });
    }
  }
  return out;
}

/** Per-product / per-ingredient compliance findings. */
export async function assessProductFindings(params: {
  products: ProductInput[];
  category: string;
  evidence: string;
}): Promise<ProductFinding[] | null> {
  const { products, category, evidence } = params;

  const result = await jsonCompletion<{ findings: Partial<ProductFinding>[] }>(
    `You are a product compliance auditor. Identify concrete compliance issues for these ${category} products across ALL of the following dimensions:

1. INGREDIENTS & ADDITIVES — banned or restricted substances in any major market.
2. LABEL CLAIMS — substantiation requirements for nutrient-content or health claims on the label.
3. PACKAGING LANGUAGE — flag if a product's [lang:] field shows English-only labeling when the target market requires additional languages (e.g., French required in Canada/Quebec; native-language label required in EU, Arabic in UAE).
4. MISSING CERTIFICATIONS — flag if a product is sold in a market or retailer that requires/strongly expects a certification the product does not hold (e.g., Halal for UAE/Indonesia/Malaysia markets, Kosher for certain retailers, Non-GMO Project or USDA Organic for Whole Foods, GFSI/SQF/BRC for major retail programs).
5. PACKAGING REQUIREMENTS — flag missing Prop 65 warning (California), missing bilingual labeling, missing UPC/GS1, missing country-of-origin declaration, or missing net-weight declaration.

PRODUCTS:
${productSummary(products)}

EVIDENCE (recent web search on ingredient/label rules):
${evidence.slice(0, 4000)}

IMPORTANT RULES:
- Only raise ingredient/additive issues if that ingredient is explicitly in the product's [label:] section.
- Without a [label:] section, only flag issues evident from the product name, description, claims, or packaging metadata.
- Do NOT speculate about ingredients not shown in the label.
- For language and certification issues, use the [lang:] and [certs:] fields from the product summary if present.

Return specific findings tied to a named product and a concrete regulation. If a product looks clean on a dimension, omit it. Avoid generic filler.

Respond ONLY with JSON:
{ "findings": [ { "product": "name", "issue": "specific gap", "regulation": "exact reg", "severity": "critical|high|medium|low", "action": "concrete fix" } ] }`,
    2800
  );

  if (!result?.findings) return null;
  return result.findings
    .filter((f) => f?.issue && f?.product)
    .map((f) => ({
      product: String(f.product),
      issue: String(f.issue),
      regulation: String(f.regulation ?? "Applicable labeling rules"),
      severity: (["critical", "high", "medium", "low"].includes(f.severity as string)
        ? f.severity
        : "medium") as Severity,
      action: String(f.action ?? "Review with a compliance specialist."),
    }));
}

/** Assess a batch of US states for state-level requirements. */
export async function assessStates(params: {
  states: USState[];
  category: string;
  products: ProductInput[];
  evidence: string;
}): Promise<StateVerdict[] | null> {
  const { states, category, products, evidence } = params;
  const stateList = states.map((s) => `${s.name} (${s.code})`).join(", ");

  const productNames = products.map((p) => p.name);

  const result = await jsonCompletion<{ verdicts: Partial<StateVerdict & { products?: string[] }>[] }>(
    `You are a US state regulatory expert. For EACH state, decide whether these ${category} products meet state-level requirements that go beyond federal rules.

PRODUCTS:
${productSummary(products)}

STATES (return one verdict per state, using the EXACT 2-letter code):
${stateList}

EVIDENCE (recent web search on state rules):
${evidence.slice(0, 3500)}

status: "allowed" (no special state issue), "review" (state-specific requirement like CA Prop 65 warning), "prohibited" (state bans an ingredient/claim).

IMPORTANT: In the "products" field, list ONLY the product names (from the PRODUCTS list above) that this specific state verdict applies to. If a rule applies to all products, list all product names. Use exact product names as listed.

WRITING RULES FOR reasons[]:
- Each reason MUST be a single plain-English sentence of 15 words or fewer.
- Split multi-part requirements into separate items — do NOT combine into one sentence.
- Do NOT repeat the regulation name in the reason text; put it in key_regulations.
- Focus on what the company must DO: "Add Prop 65 warning if acrylamide exceeds safe-harbor level."

Respond ONLY with JSON:
{ "verdicts": [ { "state": "California", "code": "CA", "products": ["exact product name"], "status": "allowed|review|prohibited", "reasons": ["short plain-English action"], "key_regulations": ["reg"] } ] }`,
    2600
  );

  if (!result?.verdicts) return null;
  const byCode = new Map<string, Partial<StateVerdict & { products?: string[] }>>();
  for (const v of result.verdicts) {
    if (v?.code) byCode.set(String(v.code).toUpperCase(), v);
  }
  return states.map((s) => {
    const v = byCode.get(s.code.toUpperCase());
    const rawProducts = (v as { products?: unknown })?.products;
    const mappedProducts: string[] | undefined = Array.isArray(rawProducts)
      ? (rawProducts as unknown[])
          .map((p) => String(p))
          .filter((name) => productNames.some((pn) => pn.toLowerCase() === name.toLowerCase()))
          .map((name) => productNames.find((pn) => pn.toLowerCase() === name.toLowerCase())!)
      : undefined;
    return {
      state: s.name,
      code: s.code,
      status: normalizeStatus(v?.status),
      reasons: asStringArray(v?.reasons, 4).length ? asStringArray(v?.reasons, 4) : [s.focus],
      key_regulations: asStringArray(v?.key_regulations, 4),
      // Only set products if the AI returned a subset (not all products)
      products:
        mappedProducts && mappedProducts.length > 0 && mappedProducts.length < productNames.length
          ? mappedProducts
          : undefined,
    };
  });
}

/** Distil raw news search results into clean cards. */
export async function distillNews(params: {
  products: ProductInput[];
  category: string;
  evidence: string;
}): Promise<NewsCard[] | null> {
  const { products, category, evidence } = params;

  const result = await jsonCompletion<{ news: Partial<NewsCard>[] }>(
    `You are a regulatory news editor. From the raw search results, pick up to 5 items that are genuinely relevant to these ${category} products and distil each into a clean card. Discard market-research, pricing, and unrelated items.

PRODUCTS: ${products.map((p) => p.name).join(", ")}

RAW RESULTS (title, url, and content):
${evidence.slice(0, 5000)}

Respond ONLY with JSON:
{ "news": [ { "headline": "short clear headline", "why_it_matters": "one line on impact to these products", "url": "source url", "date": "date or null", "severity": "critical|high|medium|low" } ] }`,
    2000
  );

  if (!result?.news) return null;
  return result.news
    .filter((n) => n?.headline && n?.url)
    .slice(0, 5)
    .map((n) => ({
      headline: String(n.headline),
      why_it_matters: String(n.why_it_matters ?? ""),
      url: String(n.url),
      date: (n.date as string) ?? null,
      severity: (["critical", "high", "medium", "low"].includes(n.severity as string)
        ? n.severity
        : "medium") as Severity,
    }));
}

/** Derive overall status/score deterministically; AI writes a one-line summary. */
export async function summarizeOverall(params: {
  company_name: string;
  category: string;
  countryVerdicts: CountryVerdict[];
  productFindings: ProductFinding[];
}): Promise<{ overall_status: "clear" | "review" | "blocked"; overall_score: number; summary: string }> {
  const { company_name, category, countryVerdicts, productFindings } = params;

  const prohibited = countryVerdicts.filter((v) => v.status === "prohibited").length;
  const review = countryVerdicts.filter((v) => v.status === "review").length;
  const allowed = countryVerdicts.filter((v) => v.status === "allowed").length;
  const total = Math.max(1, countryVerdicts.length);

  // Higher score = higher risk.
  const score = clampScore((prohibited * 100 + review * 45 + allowed * 8) / total);
  const overall_status: "clear" | "review" | "blocked" =
    prohibited > 0 ? "blocked" : review > total / 3 ? "review" : score > 35 ? "review" : "clear";

  let summary = "";
  const ai = await jsonCompletion<{ summary: string }>(
    `Write a 2-sentence plain-English compliance summary for ${company_name} (${category}).
Markets assessed: ${total}. Allowed: ${allowed}, needs review: ${review}, blocked: ${prohibited}.
Top issues: ${productFindings.slice(0, 4).map((f) => f.issue).join("; ") || "none flagged"}.
Be concrete and direct. Respond ONLY with JSON: { "summary": "..." }`,
    500
  );
  summary = ai?.summary?.trim() || "";
  if (!summary) {
    summary =
      prohibited > 0
        ? `${company_name}'s products are blocked in ${prohibited} of ${total} markets and need changes before selling there. ${allowed} markets are clear.`
        : `${company_name}'s products are clear or near-clear in ${allowed} of ${total} markets, with ${review} needing review before launch.`;
  }

  return { overall_status, overall_score: score, summary };
}

// ── Product label enrichment ──────────────────────────────────────────────────

/** Return type for enrichProductLabel — includes label text plus any detected certifications and language. */
export interface EnrichedLabel {
  label_text: string;
  certifications?: string[];
  packaging_language?: string;
  /** The primary URL the nutrition/ingredient data was extracted from. */
  source_url?: string;
}

/**
 * Search the web for a specific product's ingredient/nutrition data and return
 * it formatted as label_text ready for productSummary and compliance analysis.
 * Also extracts certifications and label language when detectable.
 * Returns null if no usable ingredient data is found.
 */
export async function enrichProductLabel(
  productName: string,
  companyName?: string
): Promise<EnrichedLabel | null> {
  try {
    const nameQuery = companyName ? `${productName} ${companyName}` : productName;

    // Two parallel searches:
    // 1. Brand site + general ingredient search (no time filter — product pages are evergreen)
    // 2. Nutrition aggregator databases (Nutritionix, CalorieKing, FatSecret)
    const [brandSettled, nutritionSettled] = await Promise.allSettled([
      tavilySearch(`${nameQuery} ingredients nutrition facts allergens`, {
        maxResults: 5,
        timeRange: null,
      }),
      tavilySearch(
        `"${productName}" ingredients nutrition`,
        {
          maxResults: 4,
          timeRange: null,
          includeDomains: [
            "nutritionix.com",
            "calorieking.com",
            "fatsecret.com",
            "myfitnesspal.com",
            "fddb.info",
          ],
        }
      ),
    ]);

    const allResults = [
      ...((brandSettled.status === "fulfilled" ? brandSettled.value?.results : null) ?? []),
      ...((nutritionSettled.status === "fulfilled" ? nutritionSettled.value?.results : null) ?? []),
    ] as Array<{ url?: string; content?: string; raw_content?: string }>;

    if (allResults.length === 0) return null;

    // Use inline search snippets immediately — faster and works even when
    // the product site is a JS SPA that tavilyExtract can't render.
    const snippetContent = allResults
      .map((r) => r.raw_content ?? r.content ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");

    // Also deep-extract the top URLs to get the full ingredient block.
    const urls = allResults
      .map((r) => r.url)
      .filter((u): u is string => !!u)
      .slice(0, 3);

    let extractedContent = "";
    if (urls.length > 0) {
      const extracted = await tavilyExtract(urls).catch(() => null);
      extractedContent = (
        (extracted?.results ?? []) as Array<{ content?: string; raw_content?: string }>
      )
        .map((r) => r.raw_content ?? r.content ?? "")
        .join("\n\n---\n\n");
    }

    // Extracted page content takes priority; snippets fill in what's missing.
    // Use extractNutritionWindow so ingredient data buried deep in Shopify-style
    // nav-heavy pages is still included rather than truncated away.
    const rawContent = extractNutritionWindow(
      [extractedContent, snippetContent].filter(Boolean).join("\n\n===\n\n"),
      12000
    );

    if (!rawContent.trim()) return null;

    const result = await jsonCompletion<{ label_text: string; certifications?: string[]; packaging_language?: string }>(
      `You are extracting product label information from web page content. Find and extract the nutrition facts, ingredient list, allergen information, certifications, and label language for "${productName}"${companyName ? ` by ${companyName}` : ""}.

PAGE CONTENT:
${rawContent}

Format label_text EXACTLY like this, including EVERY nutrient line present in the source (only omit sections that have no data):

Serving size: [e.g. 1 bar (45g)]
Servings per container: [N]

Calories [N]
Total Fat [X]g [X]% DV
  Saturated Fat [X]g [X]% DV
  Trans Fat [X]g
Cholesterol [X]mg [X]% DV
Sodium [X]mg [X]% DV
Total Carbohydrates [X]g [X]% DV
  Dietary Fiber [X]g [X]% DV
  Total Sugars [X]g
    Includes [X]g Added Sugars [X]% DV
  Sugar Alcohols [X]g
Protein [X]g [X]% DV
Vitamin D [X]mcg [X]% DV
Calcium [X]mg [X]% DV
Iron [X]mg [X]% DV
Potassium [X]mg [X]% DV

Ingredients
[full ingredient list exactly as written on label]

Contains
[allergen declaration verbatim, e.g. MILK, EGGS, SOY, WHEAT]

May Contain
[may-contain list if present]

Also extract:
- certifications: any certification badges visible on the page (e.g. "Non-GMO Project Verified", "USDA Organic", "Kosher", "Halal", "Gluten-Free Certified", "B Corp"). Return as array of strings. Empty array if none found.
- packaging_language: the language(s) on the label if visible or inferable (e.g. "English only", "English / Spanish bilingual"). Empty string if unknown.

Rules:
- Include ALL nutrient rows present in the source — missing fields (e.g. % DV, micronutrients) cause compliance failures.
- Only include data that is explicitly present in the page content for this specific product.
- Do NOT fabricate or estimate any values.
- If you cannot find ingredient or nutrition data for this product, return an empty string for label_text.

Respond ONLY with JSON: { "label_text": "formatted label text, or empty string if not found", "certifications": [], "packaging_language": "" }`,
      2000
    );

    const label = result?.label_text?.trim() ?? "";
    if (!label) return null;
    return {
      label_text: label,
      ...(Array.isArray(result?.certifications) && (result?.certifications as unknown[]).length
        ? { certifications: (result.certifications as unknown[]).map(String).filter(Boolean) }
        : {}),
      ...(typeof result?.packaging_language === "string" && result.packaging_language.trim()
        ? { packaging_language: result.packaging_language.trim() }
        : {}),
      // Return the primary source URL so the UI can show users where data came from.
      ...(urls[0] ? { source_url: urls[0] } : {}),
    };
  } catch {
    return null;
  }
}
