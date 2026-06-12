/**
 * Ingests FDA enforcement/recall data from openFDA into ClickHouse.
 *
 * Covers: drug/enforcement, food/enforcement, device/recall
 * Total rows: ~80k–120k records (ingests in ~2–4 minutes)
 *
 * Usage:
 *   npx tsx scripts/ingest-fda.ts
 *   npx tsx scripts/ingest-fda.ts --limit 5000   # quick test
 */

import { createClient } from "@clickhouse/client";

const host = process.env.CLICKHOUSE_HOST;
if (!host || host.includes("your-service")) {
  console.error("CLICKHOUSE_HOST not configured. See .env.local.");
  process.exit(1);
}

const client = createClient({
  url: host,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DB ?? "recall0",
  request_timeout: 120_000,
});

const FDA_API = "https://api.fda.gov";
const PAGE_SIZE = 1000;
const BATCH_INSERT = 1000; // keep batches small so they span ≤ a few yearly partitions
const DELAY_MS = 300; // be polite to the FDA API

const limitArg = process.argv.includes("--limit")
  ? parseInt(process.argv[process.argv.indexOf("--limit") + 1] ?? "0")
  : 0;

// openFDA field maps per endpoint
type FdaRecord = Record<string, unknown>;

interface NormalizedRow {
  recall_number: string;
  event_date: string;
  classification: string;
  product_type: string;
  product_description: string;
  reason_for_recall: string;
  recalling_firm: string;
  city: string;
  state: string;
  country: string;
  voluntary_mandated: string;
  status: string;
  distribution_pattern: string;
}

function parseDate(s: unknown): string {
  if (typeof s !== "string" || !s) return "1970-01-01";
  // openFDA dates are YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // ISO date already
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "1970-01-01";
}

function str(v: unknown, max = 1000): string {
  if (typeof v !== "string") return "";
  return v.slice(0, max).replace(/\u0000/g, "");
}

function normalizeDrugEnforcement(r: FdaRecord): NormalizedRow {
  return {
    recall_number: str(r.recall_number, 50),
    event_date: parseDate(r.event_date_initiated ?? r.recall_initiation_date),
    classification: str(r.classification, 20),
    product_type: "Drug",
    product_description: str(r.product_description, 500),
    reason_for_recall: str(r.reason_for_recall, 500),
    recalling_firm: str(r.recalling_firm, 200),
    city: str(r.city, 100),
    state: str(r.state, 10),
    country: str(r.country, 50),
    voluntary_mandated: str(r.voluntary_mandated, 50),
    status: str(r.status, 30),
    distribution_pattern: str(r.distribution_pattern, 300),
  };
}

function normalizeFoodEnforcement(r: FdaRecord): NormalizedRow {
  return {
    recall_number: str(r.recall_number, 50),
    event_date: parseDate(r.event_date_initiated ?? r.recall_initiation_date),
    classification: str(r.classification, 20),
    product_type: "Food/Cosmetics",
    product_description: str(r.product_description, 500),
    reason_for_recall: str(r.reason_for_recall, 500),
    recalling_firm: str(r.recalling_firm, 200),
    city: str(r.city, 100),
    state: str(r.state, 10),
    country: str(r.country, 50),
    voluntary_mandated: str(r.voluntary_mandated, 50),
    status: str(r.status, 30),
    distribution_pattern: str(r.distribution_pattern, 300),
  };
}

function normalizeDeviceRecall(r: FdaRecord): NormalizedRow {
  return {
    recall_number: str(r.res_event_number ?? r.cfres_id, 50),
    event_date: parseDate(r.event_date_initiated ?? r.recall_initiation_date),
    classification: str(r.classification, 20),
    product_type: "Device",
    product_description: str(r.device_name ?? r.product_description, 500),
    reason_for_recall: str(r.reason_for_recall, 500),
    recalling_firm: str(r.firm_fei_number ? `FEI:${r.firm_fei_number}` : String(r.recalling_firm ?? ""), 200),
    city: str(r.city ?? r.address_1, 100),
    state: str(r.state, 10),
    country: str(r.country ?? "US", 50),
    voluntary_mandated: str(r.voluntary_mandated, 50),
    status: str(r.status, 30),
    distribution_pattern: str(r.distribution_pattern, 300),
  };
}

interface Endpoint {
  path: string;
  normalize: (r: FdaRecord) => NormalizedRow;
  label: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    path: "/drug/enforcement.json",
    normalize: normalizeDrugEnforcement,
    label: "Drug Enforcement",
  },
  {
    path: "/food/enforcement.json",
    normalize: normalizeFoodEnforcement,
    label: "Food Enforcement",
  },
  {
    path: "/device/recall.json",
    normalize: normalizeDeviceRecall,
    label: "Device Recall",
  },
];

async function fetchPage(
  path: string,
  skip: number,
  limit: number
): Promise<{ results: FdaRecord[]; total: number } | null> {
  const url = `${FDA_API}${path}?limit=${limit}&skip=${skip}`;
  const res = await fetch(url);
  if (res.status === 404) return null; // no more records
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FDA API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { results?: FdaRecord[]; meta?: { results?: { total?: number } } };
  if (!json.results?.length) return null;
  return {
    results: json.results,
    total: json.meta?.results?.total ?? 0,
  };
}

async function ingestEndpoint(ep: Endpoint): Promise<number> {
  console.log(`\n[${ep.label}] Fetching total count…`);

  let skip = 0;
  let totalFetched = 0;
  let batch: NormalizedRow[] = [];
  let totalInserted = 0;
  let totalRecords = 0;

  while (true) {
    if (limitArg > 0 && totalFetched >= limitArg) break;

    const page = await fetchPage(ep.path, skip, PAGE_SIZE).catch((err) => {
      console.warn(`  Page skip=${skip} fetch failed: ${err.message}`);
      return null;
    });

    if (!page) break;

    if (skip === 0) {
      totalRecords = page.total;
      console.log(`  Total records available: ${totalRecords.toLocaleString()}`);
    }

    const rows = page.results.map(ep.normalize);
    batch.push(...rows);
    totalFetched += rows.length;
    skip += PAGE_SIZE;

    process.stdout.write(
      `\r  Fetched ${totalFetched.toLocaleString()} / ${Math.min(limitArg || totalRecords, totalRecords).toLocaleString()} records…`
    );

    if (batch.length >= BATCH_INSERT || page.results.length < PAGE_SIZE) {
      // Sort by date so each batch touches as few yearly partitions as possible
      batch.sort((a, b) => a.event_date.localeCompare(b.event_date));
      await client.insert({
        table: "fda_recalls",
        values: batch,
        format: "JSONEachRow",
      });
      totalInserted += batch.length;
      batch = [];
    }

    if (page.results.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // Flush remaining
  if (batch.length > 0) {
    batch.sort((a, b) => a.event_date.localeCompare(b.event_date));
    await client.insert({
      table: "fda_recalls",
      values: batch,
      format: "JSONEachRow",
    });
    totalInserted += batch.length;
  }

  console.log(`\n  Inserted ${totalInserted.toLocaleString()} rows.`);
  return totalInserted;
}

async function main() {
  console.log("=== FDA Recall Data Ingestion ===");
  console.log(`Target: ClickHouse ${host}`);
  if (limitArg) console.log(`Limit: ${limitArg} rows per endpoint`);

  let grand = 0;
  for (const ep of ENDPOINTS) {
    grand += await ingestEndpoint(ep);
  }

  const count = await client.query({
    query: "SELECT count() AS n FROM fda_recalls",
    format: "JSONEachRow",
  });
  const rows = await count.json<{ n: string }>();
  const stored = parseInt(rows[0]?.n ?? "0");

  console.log(`\n=== Done ===`);
  console.log(`Total ingested this run: ${grand.toLocaleString()} rows`);
  console.log(`Total rows in fda_recalls: ${stored.toLocaleString()}`);
  console.log(
    "\nRun the app and visit any compliance check to see recall risk data."
  );
}

main()
  .catch((err) => {
    console.error("\nIngestion failed:", err);
    process.exit(1);
  })
  .finally(() => client.close());
