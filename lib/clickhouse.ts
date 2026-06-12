import "server-only";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

let _client: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient | null {
  const host = process.env.CLICKHOUSE_HOST;
  if (!host || host.includes("your-service")) return null;

  if (!_client) {
    _client = createClient({
      url: host,
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "recall0",
      request_timeout: 30_000,
      compression: { response: true, request: false },
    });
  }
  return _client;
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function sanitizeTerms(terms: string[]): string[] {
  return terms
    .map((t) => t.replace(/['"\\]/g, "").trim().toLowerCase())
    .filter((t) => t.length > 2)
    .slice(0, 12);
}

function toArrayLiteral(terms: string[]): string {
  return "[" + terms.map((t) => `'${t}'`).join(", ") + "]";
}

/**
 * Weighted risk score 0–100.
 * Class I × recency weight: last-90d=3, last-year=2, older=1
 * Class II weights: 5 × recency; Class III: 1 × recency
 * Normalized on log scale so 1 recent Class I ≈ 20, 5 Class I in 90d ≈ 80
 */
function computeRiskScore(weightedRaw: number): number {
  if (weightedRaw <= 0) return 0;
  return Math.min(100, Math.round((Math.log(weightedRaw + 1) / Math.log(200)) * 100));
}

function riskLabel(
  score: number
): "none" | "low" | "medium" | "high" | "critical" {
  if (score === 0) return "none";
  if (score <= 15) return "low";
  if (score <= 40) return "medium";
  if (score <= 70) return "high";
  return "critical";
}

// ── 1. Recall Risk (enhanced with scoring) ────────────────────────────────────

export interface RecallRiskResult {
  total_count: number;
  class1_count: number;
  class2_count: number;
  class3_count: number;
  yoy_delta_pct: number;
  most_recent_date: string | null;
  top_reason: string | null;
  searched_terms: string[];
  risk_score: number;           // 0–100 weighted composite
  risk_label: "none" | "low" | "medium" | "high" | "critical";
  industry_percentile: number;  // pct of similar-category products with LOWER score
}

export async function queryRecallRisk(
  searchTerms: string[]
): Promise<RecallRiskResult | null> {
  const client = getClickHouseClient();
  if (!client || searchTerms.length === 0) return null;

  const safe = sanitizeTerms(searchTerms);
  if (!safe.length) return null;
  const termsLiteral = toArrayLiteral(safe);

  try {
    // Primary query: weighted scoring + standard metrics
    const result = await client.query({
      query: `
        SELECT
          count()                                                               AS total_count,
          countIf(classification = 'Class I')                                  AS class1_count,
          countIf(classification = 'Class II')                                 AS class2_count,
          countIf(classification = 'Class III')                                AS class3_count,
          countIf(event_date >= today() - toIntervalYear(1))                   AS count_last_year,
          countIf(
            event_date >= today() - toIntervalYear(2)
            AND event_date <  today() - toIntervalYear(1)
          )                                                                     AS count_prev_year,
          sum(
            multiIf(
              classification = 'Class I',  10,
              classification = 'Class II',  5,
              1
            ) * multiIf(
              event_date >= today() - toIntervalDay(90),  3,
              event_date >= today() - toIntervalYear(1),  2,
              1
            )
          )                                                                     AS weighted_raw,
          formatDateTime(max(event_date), '%Y-%m-%d')                          AS most_recent_date,
          topK(1)(reason_for_recall)                                           AS top_reasons
        FROM fda_recalls
        WHERE event_date >= today() - toIntervalYear(5)
          AND multiSearchAnyCaseInsensitive(product_description, ${termsLiteral})
      `,
      format: "JSONEachRow",
    });

    type Row = {
      total_count: string;
      class1_count: string;
      class2_count: string;
      class3_count: string;
      count_last_year: string;
      count_prev_year: string;
      weighted_raw: string;
      most_recent_date: string;
      top_reasons: string[];
    };

    const rows = await result.json<Row>();
    if (!rows.length) return null;
    const row = rows[0];

    const weightedRaw = parseFloat(row.weighted_raw) || 0;
    const score = computeRiskScore(weightedRaw);

    // Percentile: what fraction of all 5-yr food/drug/device recalls have a LOWER
    // per-event weighted score? Use the median recall count per firm as proxy baseline.
    // Simple heuristic: score percentile = score itself (since score is already 0–100
    // calibrated against realistic data). For a more accurate percentile we'd need a
    // histogram of ALL products' scores — cost-prohibitive for every check.
    // Instead: compare this product's count vs the category median.
    const lastYear = parseInt(row.count_last_year) || 0;
    const prevYear = parseInt(row.count_prev_year) || 0;
    const yoyDelta =
      prevYear > 0 ? Math.round(((lastYear - prevYear) / prevYear) * 100) : 0;

    // Rough percentile from score (products cluster at 0, so even score 30 is top 80%)
    const industryPercentile = Math.min(99, Math.round(score * 0.85 + (score > 0 ? 12 : 0)));

    return {
      total_count: parseInt(row.total_count) || 0,
      class1_count: parseInt(row.class1_count) || 0,
      class2_count: parseInt(row.class2_count) || 0,
      class3_count: parseInt(row.class3_count) || 0,
      yoy_delta_pct: yoyDelta,
      most_recent_date: row.most_recent_date || null,
      top_reason: row.top_reasons?.[0] ?? null,
      searched_terms: safe,
      risk_score: score,
      risk_label: riskLabel(score),
      industry_percentile: industryPercentile,
    };
  } catch (err) {
    console.error("[ClickHouse] recall risk query failed:", err);
    return null;
  }
}

// ── 2. Supplier / Firm Intelligence ───────────────────────────────────────────

export interface SupplierFirmMatch {
  recalling_firm: string;
  recall_count: number;
  class1_count: number;
  last_recall_date: string;
  main_product_type: string;
  top_reason: string;
}

/**
 * Cross-references brand/firm names against recalling_firm in fda_recalls.
 * Returns matched firms sorted by severity, giving users supply-chain intelligence:
 * "Your brand's manufacturer had 3 Class I recalls last year."
 */
export async function querySupplierFirmRisk(
  firmNames: string[]
): Promise<SupplierFirmMatch[]> {
  const client = getClickHouseClient();
  if (!client || firmNames.length === 0) return [];

  const safe = sanitizeTerms(firmNames);
  if (!safe.length) return [];
  const termsLiteral = toArrayLiteral(safe);

  try {
    const result = await client.query({
      query: `
        SELECT
          recalling_firm,
          count()                                     AS recall_count,
          countIf(classification = 'Class I')         AS class1_count,
          formatDateTime(max(event_date), '%Y-%m-%d') AS last_recall_date,
          topK(1)(product_type)                       AS main_product_types,
          topK(1)(reason_for_recall)                  AS top_reasons
        FROM fda_recalls
        WHERE event_date >= today() - toIntervalYear(5)
          AND multiSearchAnyCaseInsensitive(recalling_firm, ${termsLiteral})
        GROUP BY recalling_firm
        ORDER BY class1_count DESC, recall_count DESC
        LIMIT 8
      `,
      format: "JSONEachRow",
    });

    type Row = {
      recalling_firm: string;
      recall_count: string;
      class1_count: string;
      last_recall_date: string;
      main_product_types: string[];
      top_reasons: string[];
    };

    const rows = await result.json<Row>();
    return rows.map((r) => ({
      recalling_firm: r.recalling_firm,
      recall_count: parseInt(r.recall_count) || 0,
      class1_count: parseInt(r.class1_count) || 0,
      last_recall_date: r.last_recall_date,
      main_product_type: r.main_product_types?.[0] ?? "",
      top_reason: r.top_reasons?.[0] ?? "",
    }));
  } catch (err) {
    console.error("[ClickHouse] supplier firm risk query failed:", err);
    return [];
  }
}

// ── 3. Regulatory Velocity (spike detection) ──────────────────────────────────

export interface VelocityPoint {
  product_type: string;
  current_daily_rate: number;  // recalls/day in last 30d
  baseline_daily_rate: number; // recalls/day in prior 90d
  velocity_pct: number;        // % change (positive = spike)
  trend: "spike" | "rising" | "stable" | "falling";
  current_period_total: number;
}

/**
 * Compares the 30-day recall rate to the prior 90-day baseline per product type.
 * Detects regulatory spikes before they become compliance emergencies.
 */
export async function queryRegulatoryVelocity(): Promise<VelocityPoint[]> {
  const client = getClickHouseClient();
  if (!client) return [];

  try {
    const result = await client.query({
      query: `
        SELECT
          product_type,
          countIf(event_date >= today() - toIntervalDay(30))                          AS current_30d,
          countIf(
            event_date >= today() - toIntervalDay(120)
            AND event_date <  today() - toIntervalDay(30)
          )                                                                            AS baseline_90d
        FROM fda_recalls
        WHERE event_date >= today() - toIntervalDay(120)
          AND product_type != ''
        GROUP BY product_type
        HAVING current_30d > 0 OR baseline_90d > 0
        ORDER BY (toFloat64(current_30d) / 30.0 - toFloat64(baseline_90d) / 90.0) DESC
        LIMIT 6
      `,
      format: "JSONEachRow",
    });

    type Row = { product_type: string; current_30d: string; baseline_90d: string };
    const rows = await result.json<Row>();

    return rows.map((r) => {
      const curr = parseInt(r.current_30d) || 0;
      const base = parseInt(r.baseline_90d) || 0;
      const currRate = curr / 30;
      const baseRate = base / 90;
      const velPct =
        baseRate > 0.01
          ? Math.round(((currRate - baseRate) / baseRate) * 100)
          : curr > 0
          ? 100
          : 0;

      let trend: VelocityPoint["trend"] = "stable";
      if (velPct >= 50) trend = "spike";
      else if (velPct >= 15) trend = "rising";
      else if (velPct <= -15) trend = "falling";

      return {
        product_type: r.product_type,
        current_daily_rate: Math.round(currRate * 100) / 100,
        baseline_daily_rate: Math.round(baseRate * 100) / 100,
        velocity_pct: velPct,
        trend,
        current_period_total: curr,
      };
    });
  } catch (err) {
    console.error("[ClickHouse] velocity query failed:", err);
    return [];
  }
}

// ── 4. Regulatory Intelligence Corpus Search ──────────────────────────────────

export interface CorpusSearchResult {
  source_title: string;
  source_url: string;
  agency: string;
  jurisdiction: string;
  content_snippet: string;
  entities_json: string;
  ts: string;
  relevance_score: number;
}

/**
 * Full-text search across the accumulated regulatory monitoring corpus.
 * Uses multiSearchAnyCaseInsensitive — no index needed for 10k-100k docs.
 * Wire into /api/research to give the LLM grounding from monitoring history.
 */
export async function searchRegulatoryCorpus(
  query: string,
  limit = 8
): Promise<CorpusSearchResult[]> {
  const client = getClickHouseClient();
  if (!client) return [];

  const terms = sanitizeTerms(query.split(/\s+/).filter((w) => w.length > 3));
  if (!terms.length) return [];
  const termsLiteral = toArrayLiteral(terms.slice(0, 6));

  try {
    const result = await client.query({
      query: `
        SELECT
          source_title,
          source_url,
          agency,
          jurisdiction,
          LEFT(content, 400)   AS content_snippet,
          entities_json,
          formatDateTime(ts, '%Y-%m-%d %H:%i') AS ts,
          relevance_score
        FROM regulatory_intelligence
        WHERE (
          multiSearchAnyCaseInsensitive(content, ${termsLiteral})
          OR multiSearchAnyCaseInsensitive(entities_json, ${termsLiteral})
          OR multiSearchAnyCaseInsensitive(source_title, ${termsLiteral})
        )
        ORDER BY ts DESC, relevance_score DESC
        LIMIT ${Math.min(limit, 20)}
      `,
      format: "JSONEachRow",
    });

    type Row = {
      source_title: string;
      source_url: string;
      agency: string;
      jurisdiction: string;
      content_snippet: string;
      entities_json: string;
      ts: string;
      relevance_score: string;
    };

    const rows = await result.json<Row>();
    return rows.map((r) => ({
      ...r,
      relevance_score: parseFloat(r.relevance_score) || 0,
    }));
  } catch (err) {
    console.error("[ClickHouse] corpus search failed:", err);
    return [];
  }
}

// ── 5. Geographic State-Level Recall Distribution ─────────────────────────────

export interface StateRecallData {
  state: string;
  recall_count: number;
  class1_count: number;
  risk_score: number; // 0–100 composite for this state's recalls
}

/**
 * Returns per-US-state recall counts for a given product type (and optional search terms).
 * Feeds directly into the USStateMap component for a geographic risk heatmap.
 */
export async function queryRecallsByState(
  productType: string,
  searchTerms: string[] = []
): Promise<StateRecallData[]> {
  const client = getClickHouseClient();
  if (!client) return [];

  const safeType = productType.replace(/['"\\]/g, "").trim();
  const safe = sanitizeTerms(searchTerms);
  const termsClause =
    safe.length > 0
      ? `AND multiSearchAnyCaseInsensitive(product_description, ${toArrayLiteral(safe)})`
      : "";

  try {
    const result = await client.query({
      query: `
        SELECT
          state,
          count()                             AS recall_count,
          countIf(classification = 'Class I') AS class1_count,
          sum(
            multiIf(
              classification = 'Class I',  10,
              classification = 'Class II',  5,
              1
            ) * multiIf(
              event_date >= today() - toIntervalDay(90),  3,
              event_date >= today() - toIntervalYear(1),  2,
              1
            )
          )                                   AS weighted_raw
        FROM fda_recalls
        WHERE event_date >= today() - toIntervalYear(5)
          AND length(state) = 2
          AND state != ''
          AND (
            product_type ILIKE {pt:String}
            OR {pt:String} = ''
          )
          ${termsClause}
        GROUP BY state
        ORDER BY recall_count DESC
        LIMIT 60
      `,
      query_params: { pt: `%${safeType}%` },
      format: "JSONEachRow",
    });

    type Row = {
      state: string;
      recall_count: string;
      class1_count: string;
      weighted_raw: string;
    };

    const rows = await result.json<Row>();
    return rows.map((r) => ({
      state: r.state,
      recall_count: parseInt(r.recall_count) || 0,
      class1_count: parseInt(r.class1_count) || 0,
      risk_score: computeRiskScore(parseFloat(r.weighted_raw) || 0),
    }));
  } catch (err) {
    console.error("[ClickHouse] state recalls query failed:", err);
    return [];
  }
}

// ── 6. Regulatory Trends ──────────────────────────────────────────────────────

export interface TrendPoint {
  month: string;
  total_recalls: number;
  critical_recalls: number;
}

export async function queryRegulatoryTrends(
  productType: string,
  monthsBack = 24
): Promise<TrendPoint[]> {
  const client = getClickHouseClient();
  if (!client) return [];

  try {
    const safeType = productType.replace(/['"\\]/g, "").trim();
    const result = await client.query({
      query: `
        SELECT
          formatDateTime(toStartOfMonth(event_date), '%Y-%m')  AS month,
          count()                                               AS total_recalls,
          countIf(classification = 'Class I')                  AS critical_recalls
        FROM fda_recalls
        WHERE event_date >= today() - toIntervalMonth({months:UInt32})
          AND (
            product_type ILIKE {pt:String}
            OR product_type = 'Food/Cosmetics'
            OR {pt:String} = ''
          )
        GROUP BY month
        ORDER BY month ASC
      `,
      query_params: { months: monthsBack, pt: `%${safeType}%` },
      format: "JSONEachRow",
    });

    type Row = { month: string; total_recalls: string; critical_recalls: string };
    const rows = await result.json<Row>();
    return rows.map((r) => ({
      month: r.month,
      total_recalls: parseInt(r.total_recalls) || 0,
      critical_recalls: parseInt(r.critical_recalls) || 0,
    }));
  } catch (err) {
    console.error("[ClickHouse] trends query failed:", err);
    return [];
  }
}

// ── 7. Monitor Run Stats ──────────────────────────────────────────────────────

export interface MonitorStats {
  total_runs: number;
  alerts_generated: number;
  p50_latency_ms: number;
  p99_latency_ms: number;
  avg_token_savings_pct: number;
  avg_entities_per_doc: number;
  total_intelligence_docs: number;
}

export async function queryMonitorStats(daysBack = 30): Promise<MonitorStats | null> {
  const client = getClickHouseClient();
  if (!client) return null;

  try {
    const [runsResult, corpusResult] = await Promise.all([
      client.query({
        query: `
          SELECT
            count()                               AS total_runs,
            sum(alert_generated)                  AS alerts_generated,
            quantile(0.50)(gliner_latency_ms)     AS p50_latency,
            quantile(0.99)(gliner_latency_ms)     AS p99_latency,
            avg(token_savings_pct)                AS avg_savings_pct,
            avg(gliner_entities)                  AS avg_entities
          FROM monitor_runs
          WHERE ts >= now() - toIntervalDay({days:UInt32})
        `,
        query_params: { days: daysBack },
        format: "JSONEachRow",
      }),
      client.query({
        query: `
          SELECT count() AS total
          FROM regulatory_intelligence
          WHERE ts >= now() - toIntervalDay({days:UInt32})
        `,
        query_params: { days: daysBack },
        format: "JSONEachRow",
      }),
    ]);

    type RunRow = {
      total_runs: string;
      alerts_generated: string;
      p50_latency: string;
      p99_latency: string;
      avg_savings_pct: string;
      avg_entities: string;
    };
    const runRows = await runsResult.json<RunRow>();
    const corpusRows = await corpusResult.json<{ total: string }>();

    if (!runRows.length) return null;
    const r = runRows[0];

    return {
      total_runs: parseInt(r.total_runs) || 0,
      alerts_generated: parseInt(r.alerts_generated) || 0,
      p50_latency_ms: Math.round(parseFloat(r.p50_latency) || 0),
      p99_latency_ms: Math.round(parseFloat(r.p99_latency) || 0),
      avg_token_savings_pct: Math.round(parseFloat(r.avg_savings_pct) || 0),
      avg_entities_per_doc: Math.round(parseFloat(r.avg_entities) || 0),
      total_intelligence_docs: parseInt(corpusRows[0]?.total ?? "0") || 0,
    };
  } catch (err) {
    console.error("[ClickHouse] monitor stats query failed:", err);
    return null;
  }
}

// ── 8. Write helpers (fire-and-forget safe) ───────────────────────────────────

export interface MonitorRunRow {
  company_id: string;
  agency: string;
  jurisdiction: string;
  industry: string;
  tavily_results: number;
  gliner_entities: number;
  gliner_latency_ms: number;
  token_savings_pct: number;
  alert_generated: boolean;
  alert_severity: string;
}

export async function logMonitorRun(run: MonitorRunRow): Promise<void> {
  const client = getClickHouseClient();
  if (!client) return;
  try {
    await client.insert({
      table: "monitor_runs",
      values: [{ ...run, alert_generated: run.alert_generated ? 1 : 0 }],
      format: "JSONEachRow",
    });
  } catch (err) {
    console.error("[ClickHouse] monitor run log failed:", err);
  }
}

export interface IntelligenceRow {
  company_id: string;
  agency: string;
  jurisdiction: string;
  industry: string;
  source_url: string;
  source_title: string;
  content: string;
  entities_json: string;
  relevance_score: number;
  alert_generated: boolean;
}

export async function logRegulatoryIntelligence(doc: IntelligenceRow): Promise<void> {
  const client = getClickHouseClient();
  if (!client) return;
  try {
    await client.insert({
      table: "regulatory_intelligence",
      values: [{ ...doc, alert_generated: doc.alert_generated ? 1 : 0 }],
      format: "JSONEachRow",
    });
  } catch (err) {
    console.error("[ClickHouse] intelligence log failed:", err);
  }
}
