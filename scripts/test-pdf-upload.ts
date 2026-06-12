import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const BASE = "http://localhost:3000";
const REF = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data } = await supabase.auth.signInWithPassword({
    email: "demo@recall0.app",
    password: "recall0demo",
  });
  if (!data.session) throw new Error("login failed");
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const MAX = 3180;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += MAX) chunks.push(value.slice(i, i + MAX));
  const cookie =
    chunks.length === 1
      ? `sb-${REF}-auth-token=${value}`
      : chunks.map((c, i) => `sb-${REF}-auth-token.${i}=${c}`).join("; ");

  const buf = readFileSync(resolve(__dirname, "../demo-assets/sample-loan-agreement.pdf"));
  const formData = new FormData();
  formData.append(
    "file",
    new File([new Uint8Array(buf)], "sample-loan-agreement.pdf", { type: "application/pdf" })
  );
  const res = await fetch(`${BASE}/api/scan`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: formData,
  });
  const out = await res.json();
  console.log("status:", res.status);
  console.log("risk:", out.audit?.overall_risk, "score:", out.audit?.risk_score);
  console.log("findings:", out.audit?.findings?.length);
  if (!res.ok || !out.audit?.overall_risk) throw new Error("PDF upload scan failed");
  console.log("PDF UPLOAD SCAN OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
