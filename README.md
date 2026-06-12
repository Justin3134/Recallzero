# Recall0 — Regulatory Surface Intelligence

**Zero recalls. Zero surprises.**

Recall0 is a B2B compliance intelligence agent. Tell it what your company does and where, and it maps your full regulatory surface area — every agency, jurisdiction, and standard that touches your business — then watches it 24/7 with live web intelligence. Any regulatory change that affects you becomes a structured alert: what changed, which of your products are hit, severity, and the required action. Upload any document (label, agreement, spec sheet) and it gets audited against live regulatory standards in real time.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind v4 + shadcn/ui |
| AI synthesis | OpenAI (`gpt-4o`, configurable via `OPENAI_MODEL`) with heuristic fallbacks |
| Live intelligence | Tavily (search, extract, crawl, research) |
| File parsing | pdf-parse v2, tesseract.js (OCR), mammoth (docx) |
| Database + auth | Supabase (Postgres, RLS, email/password auth) |
| Hosting | Vercel-ready |

## Getting started

```bash
npm install
```

Create `.env.local`:

```bash
TAVILY_API_KEY=tvly-...
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
```

Then:

```bash
npm run db:migrate   # applies supabase/schema.sql (tables + RLS)
npm run db:seed      # optional: stage-safe demo account with realistic data
npm run dev
```

## Demo account (after `db:seed`)

- **Email:** `demo@recall0.app`
- **Password:** `recall0demo`

Seeded as "SplitPay", a BNPL fintech operating in US-CA, US-TX, and the UK, with a mapped surface (CFPB, FCA, DFPI, OCCC, FTC, SEC, Fed/FDIC, ICO), a week of realistic alerts, and a prior document scan. A sample problematic loan agreement for the live document-scan demo is in `demo-assets/`.

## How it works

1. **Onboarding** — 3-step profile builder (industry, products/claims, jurisdictions). `/api/surface` uses the LLM (plus a curated agency source list in `lib/regulatory-sources.ts`) to map the company's regulatory surface and stores it.
2. **Monitoring** — `/api/monitor` runs time-filtered Tavily searches per mapped agency, then the LLM judges each hit for relevance against the company's actual products and claims. Relevant hits become severity-scored alerts. Triggered from the top bar, per-agency from the Surface Map, and automatically after onboarding.
3. **Document audit** — `/api/scan` extracts text (PDF/image OCR/docx/csv/txt), pulls live regulatory context via Tavily, and the LLM returns a PASS / REVIEW / FAIL verdict with concrete findings mapped to specific regulations.

If the OpenAI key is unavailable, every AI call degrades to a deterministic heuristic fallback so the product keeps functioning.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run db:migrate` | apply schema + RLS to Supabase |
| `npm run db:seed` | seed the demo account |
| `npx tsx scripts/e2e.ts` | end-to-end smoke test against a running dev server |

## Security notes

- All tables have row-level security scoped to the owning user.
- The browser only ever uses the publishable key; the secret key is server-only (`lib/supabase/admin.ts`, used solely for pre-confirmed signup and seeding).
- Signups are created with email pre-confirmed via the admin API for instant demo onboarding — switch to standard confirmations for production.
