export type Severity = "critical" | "high" | "medium" | "low";
export type OverallRisk = "pass" | "review" | "fail";
export type Priority = "critical" | "high" | "medium" | "low";

export interface CompanyProfile {
  id?: string;
  user_id?: string;
  name: string;
  description?: string;
  industry: string;
  sub_industry?: string | null;
  products: string[];
  ingredients?: string[];
  claims?: string[];
  jurisdictions: string[];
  employee_count?: string | null;
  website?: string | null;
  created_at?: string;
}

export interface SurfaceAgency {
  id?: string;
  company_id?: string;
  agency: string;
  jurisdiction: string;
  relevance?: string;
  relevance_score: number;
  priority: Priority;
  key_regulations: string[];
  watch_urls: string[];
  last_crawled?: string | null;
  created_at?: string;
}

export interface Alert {
  id: string;
  company_id: string;
  title: string;
  summary: string;
  agency: string;
  jurisdiction?: string | null;
  severity: Severity;
  affected_products: string[];
  required_action?: string | null;
  deadline?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  is_read: boolean;
  created_at: string;
  /** Raw search result data — also carries `pioneer_inference_id` for adaptive feedback. */
  raw_tavily_data?: (Partial<TavilyResult> & { pioneer_inference_id?: string }) | null;
}

export interface Finding {
  issue: string;
  regulation: string;
  severity: Severity;
  location: string;
  recommendation: string;
}

export interface DocumentScan {
  id: string;
  company_id: string;
  file_name: string;
  file_type: string;
  findings: Finding[];
  overall_risk: OverallRisk;
  risk_score: number;
  summary?: string | null;
  regulations_checked: string[];
  created_at: string;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}

// ── Compliance analysis (stateless, multi-market) ───────────────────────────

export type MarketStatus = "allowed" | "review" | "prohibited";
export type OverallStatus = "clear" | "review" | "blocked";

export interface NutritionFacts {
  calories?: string;
  protein?: string;
  carbs?: string;
  fats?: string;
  total_sugars?: string;
}

export interface Allergens {
  contains?: string[];
  may_contain?: string[];
}

/** A product the user wants checked — detected from a site or uploaded as a label. */
export interface ProductInput {
  name: string;
  description?: string;
  image_url?: string | null;
  /** OCR'd / parsed text from an uploaded label or spec sheet. */
  label_text?: string;
  /** Structured nutrition facts (populated by AI extraction or client-side parsing). */
  nutrition_facts?: NutritionFacts;
  /** Allergen declarations parsed from the label. */
  allergens?: Allergens;
  /** Language(s) on the label, e.g. "English only" or "English / Spanish bilingual". */
  packaging_language?: string;
  /** Certifications visible on the product, e.g. ["Non-GMO Project", "Kosher", "USDA Organic"]. */
  certifications?: string[];
  /** Free-text packaging notes (Prop 65, bilingual requirement, country-of-origin, etc.). */
  packaging_notes?: string;
  /** URL the label/nutrition data was auto-fetched from — shown in the UI for user verification. */
  label_source_url?: string;
}

export interface ProductFinding {
  product: string;
  issue: string;
  regulation: string;
  severity: Severity;
  action: string;
}

export interface CountryVerdict {
  country: string;
  iso3: string;
  status: MarketStatus;
  score: number;
  reasons: string[];
  key_regulations: string[];
  /** When present, this verdict applies only to the listed products; absent = all products. */
  products?: string[];
}

export interface RetailerVerdict {
  retailer: string;
  status: MarketStatus;
  /** Primary verdict bullets — why they can/can't/need-review sell (3-5 items). */
  reasons: string[];
  /** Specific certifications, label changes, or ingredient swaps required. */
  requirements: string[];
  /** State or country-level laws that specifically affect this retailer's stores. */
  geographic_notes: string[];
  /** Concrete next steps to get listed or address blockers. */
  action_steps: string[];
  /** When present, this verdict applies only to the listed products; absent = all products. */
  products?: string[];
}

export interface StateVerdict {
  state: string;
  code: string;
  status: MarketStatus;
  reasons: string[];
  key_regulations: string[];
  /** Which products this verdict specifically applies to. Absent = applies to all products. */
  products?: string[];
}

export interface NewsCard {
  headline: string;
  why_it_matters: string;
  url: string;
  date?: string | null;
  severity: Severity;
}

export interface ActionStep {
  priority: number;
  action: string;
  regulation: string;
  deadline: string | null;
}

export interface ComplianceAnalysis {
  overall_status: OverallStatus;
  overall_score: number;
  summary: string;
  product_findings: ProductFinding[];
  country_verdicts: CountryVerdict[];
  state_verdicts: StateVerdict[];
  retailer_verdicts: RetailerVerdict[];
  action_plan: ActionStep[];
  news: NewsCard[];
}
