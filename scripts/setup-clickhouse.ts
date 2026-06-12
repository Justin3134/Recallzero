/**
 * Creates ClickHouse tables for the Recall0 analytical layer.
 * Run once: npx tsx scripts/setup-clickhouse.ts
 */

import { createClient } from "@clickhouse/client";

const host = process.env.CLICKHOUSE_HOST;
if (!host || host.includes("your-service")) {
  console.error(
    "CLICKHOUSE_HOST is not configured.\n" +
      "Set it in .env.local: CLICKHOUSE_HOST=https://your-host.clickhouse.cloud:8443"
  );
  process.exit(1);
}

const client = createClient({
  url: host,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  request_timeout: 60_000,
});

const DB = process.env.CLICKHOUSE_DB ?? "recall0";

const TABLES = [
  // ── Pillar A: FDA enforcement history ──────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS ${DB}.fda_recalls (
    recall_number        String,
    event_date           Date,
    classification       LowCardinality(String),
    product_type         LowCardinality(String),
    product_description  String,
    reason_for_recall    String,
    recalling_firm       String,
    city                 LowCardinality(String),
    state                LowCardinality(String),
    country              LowCardinality(String),
    voluntary_mandated   LowCardinality(String),
    status               LowCardinality(String),
    distribution_pattern String
  )
  ENGINE = MergeTree()
  PARTITION BY toYear(event_date)
  ORDER BY (product_type, classification, event_date, recall_number)
  SETTINGS index_granularity = 8192
  `,

  // ── Pillar C: Regulatory intelligence corpus ───────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS ${DB}.regulatory_intelligence (
    id              UUID    DEFAULT generateUUIDv4(),
    ts              DateTime DEFAULT now(),
    company_id      String,
    agency          LowCardinality(String),
    jurisdiction    LowCardinality(String),
    industry        LowCardinality(String),
    source_url      String,
    source_title    String,
    content         String,
    entities_json   String,
    relevance_score Float32,
    alert_generated UInt8
  )
  ENGINE = MergeTree()
  ORDER BY (agency, jurisdiction, ts)
  SETTINGS index_granularity = 8192
  `,

  // ── Monitor run telemetry ──────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS ${DB}.monitor_runs (
    run_id             UUID     DEFAULT generateUUIDv4(),
    ts                 DateTime DEFAULT now(),
    company_id         String,
    agency             LowCardinality(String),
    jurisdiction       LowCardinality(String),
    industry           LowCardinality(String),
    tavily_results     UInt16,
    gliner_entities    UInt16,
    gliner_latency_ms  UInt32,
    token_savings_pct  UInt16,
    alert_generated    UInt8,
    alert_severity     LowCardinality(String)
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(ts)
  ORDER BY (company_id, ts)
  SETTINGS index_granularity = 8192
  `,
];

async function setup() {
  console.log(`Connecting to ClickHouse at ${host}…`);

  // Create database if it doesn't exist
  await client.exec({ query: `CREATE DATABASE IF NOT EXISTS ${DB}` });
  console.log(`Database '${DB}' ready.`);

  for (const ddl of TABLES) {
    const tableName = ddl.match(/CREATE TABLE IF NOT EXISTS [\w.]+\.(\w+)/)?.[1] ?? "?";
    await client.exec({ query: ddl });
    console.log(`  Table '${tableName}' created (or already exists).`);
  }

  console.log("\nClickHouse setup complete.");
  console.log("Next step: run `npx tsx scripts/ingest-fda.ts` to load FDA recall data.");
}

setup()
  .catch((err) => {
    console.error("Setup failed:", err);
    process.exit(1);
  })
  .finally(() => client.close());
