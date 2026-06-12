import { Client } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL not set");
  const sql = readFileSync(resolve(__dirname, "../supabase/schema.sql"), "utf-8");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Migration applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
