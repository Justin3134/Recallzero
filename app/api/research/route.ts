import "server-only";
import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily";
import { buildResearchSystemPrompt } from "@/lib/research-prompts";
import { searchRegulatoryCorpus } from "@/lib/clickhouse";
import type { TavilyResult } from "@/types";

export const maxDuration = 60;

const aiClient = new OpenAI({
  apiKey: process.env.PIONEER_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL:
    process.env.PIONEER_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.pioneer.ai/v1",
});

const MODEL =
  process.env.PIONEER_MODEL ?? process.env.OPENAI_MODEL ?? "claude-sonnet-4-6";

// ─── remove cached prompt block — now using lib/research-prompts.ts ──────────

type ChatMessage = { id?: string; role: "user" | "assistant" | "system"; content: string };

type UserData = {
  company: Record<string, unknown> | null;
  scans: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  surface: Record<string, unknown>[];
};

/**
 * Classify intent without an extra LLM call — keyword heuristic is fast and reliable
 * enough for the research vs report distinction.
 */
function detectIntent(message: string): "research" | "report" {
  const lower = message.toLowerCase();
  const reportSignals = [
    "my ",
    "our ",
    "we ",
    "show me my",
    "show me our",
    "my products",
    "our products",
    "my market",
    "our market",
    "my compliance",
    "our compliance",
    "my scans",
    "my alerts",
    "my status",
    "our status",
    "am i compliant",
    "where can i sell",
    "my business",
    "our business",
    "my findings",
    "our findings",
  ];
  return reportSignals.some((k) => lower.includes(k)) ? "report" : "research";
}

function buildSearchQueries(message: string): [string, string] {
  return [
    `${message} compliance requirements regulation`,
    `${message} regulatory rules enforcement current`,
  ];
}

function formatTavilyResults(results: TavilyResult[]): string {
  if (!results.length) return "No web results found.";
  return results
    .slice(0, 6)
    .map(
      (r, i) =>
        `[Source ${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? "").slice(0, 500)}`
    )
    .join("\n\n---\n\n");
}

function formatUserData(data: UserData): string {
  const parts: string[] = [];

  if (data.company) {
    const c = data.company;
    parts.push(
      [
        "COMPANY PROFILE:",
        `Name: ${c.name}`,
        `Industry: ${c.industry}`,
        `Products: ${(c.products as string[])?.join(", ") ?? "N/A"}`,
        `Target markets: ${(c.jurisdictions as string[])?.join(", ") ?? "N/A"}`,
      ].join("\n")
    );
  }

  if (data.scans.length) {
    const rows = data.scans.slice(0, 5).map((s) => {
      const highCount =
        (s.findings as { severity: string }[])?.filter(
          (f) => f.severity === "critical" || f.severity === "high"
        ).length ?? 0;
      return `- ${s.file_name}: ${String(s.overall_risk).toUpperCase()} (score ${s.risk_score ?? "?"}) — ${highCount} critical/high issues. ${s.summary ?? ""}`;
    });
    parts.push(`\nRECENT DOCUMENT SCANS (${data.scans.length} total):\n${rows.join("\n")}`);
  }

  if (data.alerts.length) {
    const rows = data.alerts
      .slice(0, 6)
      .map(
        (a) =>
          `- [${String(a.severity).toUpperCase()}] ${a.title}: ${a.summary}${a.deadline ? ` (deadline: ${a.deadline})` : ""}`
      );
    parts.push(`\nACTIVE COMPLIANCE ALERTS (${data.alerts.length} unread):\n${rows.join("\n")}`);
  }

  if (data.surface.length) {
    const rows = data.surface
      .slice(0, 8)
      .map((s) => `- ${s.agency} (${s.jurisdiction}) — ${s.relevance}`);
    parts.push(`\nTRACKED REGULATORY AGENCIES:\n${rows.join("\n")}`);
  }

  return parts.join("\n\n");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { messages?: ChatMessage[]; companyContext?: string; productContext?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const messages: ChatMessage[] = body.messages ?? [];
  const clientProductContext = body.productContext ?? null;
  if (!messages.length) {
    return new Response(JSON.stringify({ error: "No messages provided" }), { status: 400 });
  }

  // Always fetch the authenticated company — don't trust client-provided companyId
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const intent = detectIntent(lastUserMsg);

  // Phase 2: Gather context in parallel
  const [webResults, userData, corpusResults] = await Promise.all([
    // Research mode: search Tavily for regulatory info
    intent === "report"
      ? Promise.resolve([] as TavilyResult[])
      : Promise.all(
          buildSearchQueries(lastUserMsg).map((q) =>
            tavilySearch(q, { maxResults: 4, topic: "general" })
              .then((r) => (r?.results ?? []) as TavilyResult[])
              .catch(() => [] as TavilyResult[])
          )
        ).then((r) => r.flat()),

    // Report mode: fetch user compliance data from Supabase
    intent === "research" || !company
      ? Promise.resolve(null as UserData | null)
      : Promise.all([
          supabase
            .from("document_scans")
            .select("*")
            .eq("company_id", company.id)
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("alerts")
            .select("*")
            .eq("company_id", company.id)
            .eq("is_read", false)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("regulatory_surface")
            .select("*")
            .eq("company_id", company.id)
            .order("relevance_score", { ascending: false })
            .limit(10),
        ]).then(([scansRes, alertsRes, surfaceRes]) => ({
          company: company as Record<string, unknown>,
          scans: (scansRes.data ?? []) as Record<string, unknown>[],
          alerts: (alertsRes.data ?? []) as Record<string, unknown>[],
          surface: (surfaceRes.data ?? []) as Record<string, unknown>[],
        })),

    // Always: search ClickHouse monitoring corpus for historical intelligence
    searchRegulatoryCorpus(lastUserMsg, 6).catch(() => []),
  ]);

  // Phase 3: Build context injection
  const contextParts: string[] = [];

  if (company) {
    contextParts.push(
      `USER: ${company.name} (${company.industry}), target markets: ${(company.jurisdictions as string[] ?? []).join(", ")}`
    );
  }

  // Product scan context sent from the client (built from localStorage recent checks).
  // This includes product names, full ingredient lists, per-product compliance findings,
  // and market verdicts — grounding every AI response in the user's actual products.
  if (clientProductContext) {
    contextParts.push(`\nPRODUCT SCAN DATA:\n${clientProductContext}`);
  }

  if (webResults.length) {
    contextParts.push(`\nWEB RESEARCH:\n${formatTavilyResults(webResults)}`);
  }
  if (userData) {
    contextParts.push(`\nUSER COMPLIANCE DATA:\n${formatUserData(userData)}`);
  }
  if (corpusResults.length) {
    const corpusText = corpusResults
      .slice(0, 5)
      .map(
        (r, i) =>
          `[Monitor History ${i + 1}] ${r.source_title} (${r.agency}, ${r.ts})\n${r.content_snippet}`
      )
      .join("\n\n---\n\n");
    contextParts.push(
      `\nREGULATORY MONITORING HISTORY (from ClickHouse corpus):\n${corpusText}`
    );
  }

  const contextBlock = contextParts.length
    ? `\n\n--- CONTEXT (use this to ground your response) ---\n${contextParts.join("\n")}\n--- END CONTEXT ---`
    : "";

  const systemPrompt = buildResearchSystemPrompt(contextBlock);

  // Phase 4: Stream OpenUI Lang from the LLM
  const chatMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await aiClient.chat.completions.create({
      model: MODEL,
      stream: true,
      temperature: 0.25,
      max_tokens: 2048,
      messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
    });
  } catch (err) {
    console.error("[research] LLM error:", err);
    return new Response(JSON.stringify({ error: "AI service error" }), { status: 503 });
  }

  // Transform OpenAI SSE chunks → OpenUI SSE format:
  // data: {"type":"TEXT_MESSAGE_CONTENT","delta":"..."}\n\n
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            const event = JSON.stringify({ type: "TEXT_MESSAGE_CONTENT", delta });
            controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("[research] Stream error:", e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
