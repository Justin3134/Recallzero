/**
 * End-to-end smoke test against the running dev server.
 * Run: set -a; source .env.local; set +a; npx tsx scripts/e2e.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

const BASE = "http://localhost:3000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];
const TEST_EMAIL = `e2e-${Date.now()}@recall0.test`;
const TEST_PASSWORD = "e2e-password-123";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function cookieHeaderFor(session: object): string {
  const value =
    "base64-" +
    Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = `sb-${PROJECT_REF}-auth-token`;
  // Chunk like @supabase/ssr does when > 3180 chars.
  const MAX = 3180;
  if (value.length <= MAX) return `${name}=${value}`;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += MAX) {
    chunks.push(value.slice(i, i + MAX));
  }
  return chunks.map((c, i) => `${name}.${i}=${c}`).join("; ");
}

async function main() {
  // 0. Unauthenticated checks
  const loginPage = await fetch(`${BASE}/login`);
  check("GET /login returns 200", loginPage.status === 200);

  const rootRedirect = await fetch(`${BASE}/`, { redirect: "manual" });
  check(
    "GET / redirects to /login when logged out",
    rootRedirect.status >= 300 &&
      rootRedirect.status < 400 &&
      (rootRedirect.headers.get("location") ?? "").includes("/login")
  );

  const unauthAlerts = await fetch(`${BASE}/api/alerts`);
  check("GET /api/alerts unauthorized => 401", unauthAlerts.status === 401);

  // 1. Signup via API
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  check("POST /api/auth/signup creates user", signupRes.ok);

  // 2. Sign in to get a session
  const supabase = createClient(
    SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  check("Password sign-in works", !!signIn.session && !signInErr, signInErr?.message);
  if (!signIn.session) throw new Error("no session");

  const cookie = cookieHeaderFor(signIn.session);
  const authHeaders = { Cookie: cookie, "Content-Type": "application/json" };

  // 3. Surface mapping (onboarding step)
  console.log("\nRunning surface mapping (may take a while)...");
  const surfaceRes = await fetch(`${BASE}/api/surface`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      companyProfile: {
        name: "E2E BNPL Co",
        description: "BNPL financing for online checkout in California, Texas and the UK.",
        industry: "fintech",
        products: ["BNPL checkout loans", "Consumer financing"],
        ingredients: [],
        claims: ["0% interest"],
        jurisdictions: ["US-CA", "US-TX", "UK"],
      },
    }),
  });
  const surfaceData = await surfaceRes.json().catch(() => ({}));
  check(
    "POST /api/surface maps agencies",
    surfaceRes.ok && (surfaceData.surface?.agencies?.length ?? 0) > 0,
    `agencies=${surfaceData.surface?.agencies?.length}`
  );

  // 4. Monitor scan (live Tavily + synthesis)
  console.log("Running live monitor scan (Tavily)...");
  const monitorRes = await fetch(`${BASE}/api/monitor`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({}),
  });
  const monitorData = await monitorRes.json().catch(() => ({}));
  check(
    "POST /api/monitor completes",
    monitorRes.ok && typeof monitorData.count === "number",
    `new alerts=${monitorData.count}`
  );

  // 5. Alerts API
  const alertsRes = await fetch(`${BASE}/api/alerts`, { headers: { Cookie: cookie } });
  const alertsData = await alertsRes.json().catch(() => ({}));
  check(
    "GET /api/alerts returns list",
    alertsRes.ok && Array.isArray(alertsData.alerts),
    `count=${alertsData.alerts?.length}`
  );

  // 6. Document scan with the sample loan agreement
  console.log("Running document scan...");
  const fileBuf = readFileSync(resolve(__dirname, "../demo-assets/sample-loan-agreement.txt"));
  const formData = new FormData();
  formData.append(
    "file",
    new File([new Uint8Array(fileBuf)], "sample-loan-agreement.txt", { type: "text/plain" })
  );
  const scanRes = await fetch(`${BASE}/api/scan`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: formData,
  });
  const scanData = await scanRes.json().catch(() => ({}));
  check(
    "POST /api/scan audits document",
    scanRes.ok && !!scanData.audit?.overall_risk,
    `risk=${scanData.audit?.overall_risk} score=${scanData.audit?.risk_score} findings=${scanData.audit?.findings?.length}`
  );

  // 7. Dashboard renders for authed user
  const dashRes = await fetch(`${BASE}/`, { headers: { Cookie: cookie } });
  const dashHtml = await dashRes.text();
  check(
    "GET / renders command center",
    dashRes.status === 200 && dashHtml.includes("Live Alert Feed")
  );

  const surfacePageRes = await fetch(`${BASE}/surface`, { headers: { Cookie: cookie } });
  check("GET /surface renders", surfacePageRes.status === 200);

  // 8. Mark alerts read
  const patchRes = await fetch(`${BASE}/api/alerts`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({ all: true, is_read: true }),
  });
  check("PATCH /api/alerts marks read", patchRes.ok);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
