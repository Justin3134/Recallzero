/**
 * Seeds a stage-safe demo account:
 *   email: demo@recall0.app
 *   password: recall0demo
 *
 * Run: set -a; source .env.local; set +a; npx tsx scripts/seed-demo.ts
 */
import { createClient } from "@supabase/supabase-js";

const DEMO_EMAIL = "demo@recall0.app";
const DEMO_PASSWORD = "recall0demo";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function daysAgo(n: number, hourOffset = 0) {
  return new Date(Date.now() - n * 24 * 3600 * 1000 - hourOffset * 3600 * 1000).toISOString();
}

async function main() {
  // 1. Demo user
  let userId: string;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (createErr) {
    if (!createErr.message.includes("already been registered")) throw createErr;
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === DEMO_EMAIL);
    if (!existing) throw new Error("Demo user lookup failed");
    userId = existing.id;
  } else {
    userId = created.user.id;
  }
  console.log("Demo user:", DEMO_EMAIL, "/", DEMO_PASSWORD);

  // 2. Wipe previous demo data
  await admin.from("companies").delete().eq("user_id", userId);

  // 3. Company profile — BNPL fintech
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .insert({
      user_id: userId,
      name: "SplitPay",
      description:
        "SplitPay offers buy-now-pay-later financing at checkout for online retailers. Consumers split purchases into 4 interest-free installments; we also offer longer-term financing with APR for larger purchases.",
      industry: "fintech",
      products: [
        "BNPL checkout loans (Pay in 4)",
        "Long-term consumer financing (6-24 mo APR)",
        "Virtual card issuing",
        "Merchant settlement platform",
      ],
      ingredients: [],
      claims: ["0% interest", "No hidden fees", "Instant approval"],
      jurisdictions: ["US-CA", "US-TX", "UK"],
    })
    .select()
    .single();
  if (companyErr || !company) throw companyErr;
  console.log("Company:", company.name, company.id);

  // 4. Regulatory surface
  const surface = [
    { agency: "CFPB", jurisdiction: "US", relevance: "Federal consumer credit oversight; BNPL interpretive rules apply directly to Pay-in-4 products.", relevance_score: 0.97, priority: "critical", key_regulations: ["Truth in Lending Act (Reg Z)", "CFPB BNPL Interpretive Rule", "UDAAP"], watch_urls: ["https://www.consumerfinance.gov"] },
    { agency: "FCA", jurisdiction: "UK", relevance: "UK BNPL products fall under FCA's new consumer credit regime with affordability requirements.", relevance_score: 0.93, priority: "critical", key_regulations: ["Consumer Credit Act", "FCA Affordability Rules", "Consumer Duty"], watch_urls: ["https://www.fca.org.uk"] },
    { agency: "California DFPI", jurisdiction: "US-CA", relevance: "California licenses BNPL lenders under the CFL and actively supervises point-of-sale financing.", relevance_score: 0.9, priority: "high", key_regulations: ["California Financing Law (CFL)", "SB 1235 disclosures"], watch_urls: ["https://dfpi.ca.gov"] },
    { agency: "Texas OCCC", jurisdiction: "US-TX", relevance: "Texas regulates retail installment transactions and consumer loans through the OCCC.", relevance_score: 0.82, priority: "high", key_regulations: ["Texas Finance Code Ch. 345", "Retail Installment Sales Act"], watch_urls: ["https://occc.texas.gov"] },
    { agency: "FTC", jurisdiction: "US", relevance: "Marketing claims like '0% interest' and 'no hidden fees' are subject to FTC deceptive advertising standards.", relevance_score: 0.78, priority: "high", key_regulations: ["FTC Act Section 5", "Truth in Advertising"], watch_urls: ["https://www.ftc.gov"] },
    { agency: "SEC", jurisdiction: "US", relevance: "Relevant if loan receivables are securitized or capital is raised through securities offerings.", relevance_score: 0.55, priority: "medium", key_regulations: ["Securities Act of 1933", "Reg AB II"], watch_urls: ["https://www.sec.gov"] },
    { agency: "Federal Reserve / FDIC", jurisdiction: "US", relevance: "Bank partnership model exposes SplitPay to bank-partner oversight and third-party risk guidance.", relevance_score: 0.6, priority: "medium", key_regulations: ["Interagency Third-Party Risk Guidance"], watch_urls: ["https://www.federalreserve.gov"] },
    { agency: "ICO (UK)", jurisdiction: "UK", relevance: "Processing UK consumer credit data requires UK GDPR compliance.", relevance_score: 0.58, priority: "medium", key_regulations: ["UK GDPR", "Data Protection Act 2018"], watch_urls: ["https://ico.org.uk"] },
  ].map((s) => ({ ...s, company_id: company.id, last_crawled: daysAgo(0, 1) }));

  await admin.from("regulatory_surface").insert(surface);
  console.log("Surface rows:", surface.length);

  // 5. Alerts across the last 7 days
  const alerts = [
    {
      title: "CFPB finalizes BNPL interpretive rule — Pay-in-4 treated as credit cards",
      summary:
        "The CFPB's interpretive rule classifies Pay-in-4 BNPL products as credit cards under Regulation Z. SplitPay must provide periodic statements, billing dispute rights, and refund processing equivalent to card issuers.",
      agency: "CFPB", jurisdiction: "US", severity: "critical",
      affected_products: ["BNPL checkout loans (Pay in 4)"],
      required_action: "Implement Reg Z billing dispute workflows and periodic statements for all Pay-in-4 users. Audit refund handling against credit card standards.",
      deadline: "60 days from publication",
      source_url: "https://www.consumerfinance.gov/rules-policy/final-rules/",
      source_title: "CFPB Interpretive Rule: BNPL and Regulation Z",
      is_read: false, created_at: daysAgo(0, 2),
    },
    {
      title: "FCA affordability rules now apply to interest-free BNPL in the UK",
      summary:
        "The FCA's updated consumer credit regime extends mandatory affordability checks and Section 75-equivalent protections to interest-free BNPL agreements. SplitPay's UK checkout flow requires creditworthiness assessment before approval.",
      agency: "FCA", jurisdiction: "UK", severity: "critical",
      affected_products: ["BNPL checkout loans (Pay in 4)", "Long-term consumer financing (6-24 mo APR)"],
      required_action: "Add affordability assessment to UK onboarding flow; update terms to reflect FCA-regulated agreement status.",
      deadline: null,
      source_url: "https://www.fca.org.uk/news",
      source_title: "FCA: Regulation of Buy Now Pay Later products",
      is_read: false, created_at: daysAgo(1, 5),
    },
    {
      title: "California DFPI proposes registration requirement for point-of-sale financers",
      summary:
        "DFPI issued a proposed rulemaking requiring BNPL providers operating in California to register and submit annual lending data. Comment period is open; final rule expected within two quarters.",
      agency: "California DFPI", jurisdiction: "US-CA", severity: "high",
      affected_products: ["BNPL checkout loans (Pay in 4)", "Merchant settlement platform"],
      required_action: "Prepare CFL registration documentation and data reporting pipeline; consider submitting comments before the deadline.",
      deadline: "Comment period closes in 45 days",
      source_url: "https://dfpi.ca.gov/news/",
      source_title: "DFPI Notice of Proposed Rulemaking: Point-of-Sale Financing",
      is_read: false, created_at: daysAgo(2, 3),
    },
    {
      title: "FTC warns lenders on '0% interest' claims with deferred interest products",
      summary:
        "The FTC issued warning letters to consumer lenders whose '0% interest' marketing failed to disclose conditions under which interest accrues. SplitPay's '0% interest' claim must be reviewed against its long-term APR products.",
      agency: "FTC", jurisdiction: "US", severity: "high",
      affected_products: ["Long-term consumer financing (6-24 mo APR)"],
      required_action: "Review all marketing using '0% interest' to ensure clear and conspicuous disclosure of APR-bearing products.",
      deadline: null,
      source_url: "https://www.ftc.gov/news-events/news",
      source_title: "FTC Press Release: Deceptive Financing Claims",
      is_read: true, created_at: daysAgo(3, 6),
    },
    {
      title: "Texas OCCC clarifies retail installment licensing for online BNPL",
      summary:
        "New OCCC advisory clarifies that out-of-state BNPL providers serving Texas consumers may require a retail installment seller license depending on fee structure. Late fees above statutory caps trigger licensing.",
      agency: "Texas OCCC", jurisdiction: "US-TX", severity: "medium",
      affected_products: ["BNPL checkout loans (Pay in 4)"],
      required_action: "Compare SplitPay's late fee schedule to Texas Finance Code Ch. 345 caps; obtain license if applicable.",
      deadline: null,
      source_url: "https://occc.texas.gov/news",
      source_title: "OCCC Advisory Bulletin: Online Point-of-Sale Financing",
      is_read: true, created_at: daysAgo(4, 2),
    },
    {
      title: "ICO guidance on credit decisioning data under UK GDPR",
      summary:
        "Updated ICO guidance covers automated creditworthiness decisions, requiring meaningful human review options and explainability for declined applicants — relevant to SplitPay's instant approval flow in the UK.",
      agency: "ICO (UK)", jurisdiction: "UK", severity: "medium",
      affected_products: ["BNPL checkout loans (Pay in 4)"],
      required_action: "Document automated decisioning logic and add human review escalation for UK declines.",
      deadline: null,
      source_url: "https://ico.org.uk",
      source_title: "ICO: AI and Credit Decisions Guidance Update",
      is_read: true, created_at: daysAgo(5, 4),
    },
    {
      title: "Interagency guidance refresh on bank-fintech partnerships",
      summary:
        "Federal banking agencies refreshed third-party risk management expectations for banks partnering with fintech lenders. SplitPay's partner bank will likely pass through enhanced due diligence and audit requirements.",
      agency: "Federal Reserve / FDIC", jurisdiction: "US", severity: "low",
      affected_products: ["Virtual card issuing", "Merchant settlement platform"],
      required_action: "Expect updated due diligence questionnaires from partner bank; prepare compliance documentation package.",
      deadline: null,
      source_url: "https://www.federalreserve.gov",
      source_title: "Interagency Guidance: Third-Party Relationships",
      is_read: true, created_at: daysAgo(6, 1),
    },
  ].map((a) => ({ ...a, company_id: company.id }));

  await admin.from("alerts").insert(alerts);
  console.log("Alerts:", alerts.length);

  // 6. A past document scan
  await admin.from("document_scans").insert({
    company_id: company.id,
    file_name: "splitpay-merchant-agreement-v3.pdf",
    file_type: "pdf",
    extracted_text: "(seeded demo scan)",
    overall_risk: "review",
    risk_score: 46,
    summary:
      "The merchant agreement is largely standard but contains an indemnification clause that may conflict with CFPB UDAAP expectations and lacks required state-specific disclosure language for California merchants.",
    findings: [
      {
        issue: "Indemnification clause shifts all consumer-complaint liability to merchants",
        regulation: "CFPB UDAAP standards",
        severity: "medium",
        location: "Section 9.2, Indemnification",
        recommendation: "Limit indemnification to merchant-caused violations; SplitPay retains servicing liability.",
      },
      {
        issue: "Missing SB 1235-style commercial financing disclosure references",
        regulation: "California SB 1235 (Commercial Financing Disclosures)",
        severity: "high",
        location: "Exhibit B, Fee Schedule",
        recommendation: "Add APR-equivalent disclosure block for California merchant financing offers.",
      },
    ],
    regulations_checked: ["CFPB UDAAP", "California SB 1235", "FTC Act Section 5", "Reg Z"],
    created_at: daysAgo(2, 8),
  });
  console.log("Document scan seeded.");

  console.log("\nDone. Log in with demo@recall0.app / recall0demo");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
