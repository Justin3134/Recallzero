import "server-only";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily";
import { synthesizeRegulatoryAlert } from "@/lib/ai";
import { extractRegulatoryEntities } from "@/lib/pioneer";
import { getAgenciesForProfile } from "@/lib/regulatory-sources";
import { logMonitorRun, logRegulatoryIntelligence } from "@/lib/clickhouse";
import type { CompanyProfile, TavilyResult } from "@/types";

export const maxDuration = 180;

const GLINER_MODEL = process.env.PIONEER_GLINER_MODEL ?? "fastino/gliner2-base-v1";

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Try to get company from DB first; fall back to query params for onboarding context
  let profile: (CompanyProfile & { id: string }) | null = null;
  let companyId: string | null = null;

  if (user) {
    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (company) {
      profile = company as CompanyProfile & { id: string };
      companyId = company.id;
    }
  }

  // Fall back to query params (used when rendering from ComplianceDashboard without a saved profile)
  const qp = req.nextUrl.searchParams;
  const qpCompanyName = qp.get("companyName");
  const qpIndustry = qp.get("industry");
  const qpProducts = qp.get("products")?.split(",").filter(Boolean) ?? [];

  if (!profile) {
    if (!qpCompanyName) {
      return new Response("No company profile. Pass ?companyName= to use query-param mode.", { status: 400 });
    }
    // Synthesise a minimal profile from query params
    profile = {
      id: "anon",
      name: qpCompanyName,
      industry: qpIndustry ?? "food",
      jurisdictions: ["US"],
      products: qpProducts.map((name) => ({ name, description: "" })),
    } as unknown as CompanyProfile & { id: string };
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;

  function emit(data: Record<string, unknown>) {
    try {
      controllerRef?.enqueue(encoder.encode(sse(data)));
    } catch {
      // client disconnected
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;

      try {
        const agencies = getAgenciesForProfile(profile!.industry, profile!.jurisdictions);
        const searchTasks: { agency: string; term: string }[] = [];
        for (const agency of agencies.slice(0, 5)) {
          for (const term of agency.searchTerms.slice(0, 2)) {
            searchTasks.push({ agency: agency.name, term });
          }
        }

        emit({ type: "start", sources: searchTasks.length, model: GLINER_MODEL, industry: profile!.industry });

        const searchResults = await Promise.allSettled(
          searchTasks.map(async ({ agency, term }) => {
            const res = await tavilySearch(term, { timeRange: "month", maxResults: 3, topic: "news" });
            return { agency, results: (res.results ?? []) as TavilyResult[] };
          })
        );

        // Deduplicate against existing alerts (only when we have a real DB company)
        const seenUrls = new Set<string>();
        if (companyId) {
          const { data: existing } = await supabase
            .from("alerts")
            .select("source_url")
            .eq("company_id", companyId);
          (existing ?? []).forEach((a: { source_url: string }) => seenUrls.add(a.source_url));
        }

        const hits: { agency: string; result: TavilyResult }[] = [];
        const dedupe = new Set<string>();
        for (const sr of searchResults) {
          if (sr.status !== "fulfilled") continue;
          for (const result of sr.value.results) {
            if (!result.url || dedupe.has(result.url) || seenUrls.has(result.url)) continue;
            dedupe.add(result.url);
            hits.push({ agency: sr.value.agency, result });
          }
        }

        emit({ type: "fetched", count: hits.length });

        const newAlerts: Record<string, unknown>[] = [];
        let processed = 0;

        for (const { agency, result } of hits.slice(0, 12)) {
          const rawText = `${result.title}\n\n${result.content}`;
          emit({ type: "source", agency, title: result.title, url: result.url });

          const t0 = Date.now();
          let pioneer: Awaited<ReturnType<typeof extractRegulatoryEntities>> = null;
          try {
            pioneer = await extractRegulatoryEntities(rawText);
          } catch {
            // non-fatal
          }
          const latencyMs = Date.now() - t0;

          const rawChars = pioneer?.rawChars ?? rawText.length;
          const summaryChars = pioneer?.structuredSummary?.length ?? rawText.length;
          const savedPct = rawChars > 0
            ? Math.round((1 - summaryChars / rawChars) * 100)
            : 0;

          emit({
            type: "gliner",
            agency,
            title: result.title,
            latency_ms: latencyMs,
            model_id: GLINER_MODEL,
            is_fine_tuned: GLINER_MODEL !== "fastino/gliner2-base-v1",
            entities: pioneer?.entities ?? {},
            classifications: pioneer?.classifications ?? {},
            structured_summary: pioneer?.structuredSummary ?? "",
            raw_chars: rawChars,
            summary_chars: summaryChars,
            token_savings_pct: savedPct,
          });

          // ── ClickHouse: log GLiNER telemetry (fire-and-forget) ──────────
          const entityCount = Object.values(pioneer?.entities ?? {}).flat().length;
          void logMonitorRun({
            company_id: companyId ?? "anon",
            agency,
            jurisdiction: profile!.jurisdictions?.[0] ?? "US",
            industry: profile!.industry ?? "",
            tavily_results: hits.length,
            gliner_entities: entityCount,
            gliner_latency_ms: latencyMs,
            token_savings_pct: savedPct,
            alert_generated: false, // updated below after synthesis
            alert_severity: "low",
          });

          if (result.content) {
            void logRegulatoryIntelligence({
              company_id: companyId ?? "anon",
              agency,
              jurisdiction: profile!.jurisdictions?.[0] ?? "US",
              industry: profile!.industry ?? "",
              source_url: result.url ?? "",
              source_title: result.title ?? "",
              content: String(result.content ?? "").slice(0, 10_000),
              entities_json: JSON.stringify(pioneer?.entities ?? {}),
              relevance_score: 0,
              alert_generated: false,
            });
          }
          // ────────────────────────────────────────────────────────────────

          const regulatoryUpdate = pioneer?.structuredSummary
            ? `[Pioneer GLiNER2 extracted entities]\n${pioneer.structuredSummary}\n\n[Source excerpt]\n${rawText.slice(0, 1200)}`
            : rawText;

          let alert: Awaited<ReturnType<typeof synthesizeRegulatoryAlert>> = null;
          try {
            alert = await synthesizeRegulatoryAlert({
              regulatoryUpdate,
              companyProfile: profile!,
              sourceUrl: result.url,
              sourceTitle: result.title,
            });
          } catch {
            emit({ type: "error", title: result.title, reason: "LLM synthesis failed" });
            processed++;
            continue;
          }

          if (!alert || !alert.is_relevant || alert.confidence < 0.6) {
            emit({
              type: "skip",
              agency,
              title: result.title,
              reason: !alert ? "No response" : `low confidence`,
            });
          } else {
            const alertRow = {
              company_id: companyId ?? "anon",
              title: alert.title,
              summary: alert.summary,
              agency,
              jurisdiction: profile!.jurisdictions[0] ?? "US",
              severity: alert.severity,
              affected_products: alert.affected_products ?? [],
              required_action: alert.required_action,
              deadline: alert.deadline,
              source_url: result.url,
              source_title: result.title,
              raw_tavily_data: {
                ...result,
                ...(pioneer?.inferenceId ? { pioneer_inference_id: pioneer.inferenceId } : {}),
              },
            };

            // Only persist to DB when we have a real company
            if (companyId) {
              newAlerts.push(alertRow);
            }

            emit({
              type: "relevant",
              agency,
              title: alert.title,
              severity: alert.severity,
              summary: alert.summary,
              required_action: alert.required_action,
              affected_products: alert.affected_products ?? [],
              deadline: alert.deadline ?? null,
              url: result.url,
              confidence: alert.confidence,
            });
          }

          processed++;
        }

        let saved = 0;
        if (companyId && newAlerts.length > 0) {
          const { error } = await supabase.from("alerts").insert(newAlerts);
          if (!error) saved = newAlerts.length;
        }

        emit({ type: "complete", processed, found: newAlerts.length, saved });
      } catch (err) {
        emit({ type: "fatal", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
    cancel() {
      controllerRef = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
