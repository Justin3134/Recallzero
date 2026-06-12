import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily";
import { synthesizeRegulatoryAlert } from "@/lib/ai";
import { extractRegulatoryEntities } from "@/lib/pioneer";
import { getAgenciesForProfile, type RegulatoryAgency } from "@/lib/regulatory-sources";
import { logMonitorRun, logRegulatoryIntelligence } from "@/lib/clickhouse";
import type { CompanyProfile, TavilyResult } from "@/types";

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const agencyFilter: string | undefined = body.agency;

    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (!company) {
      return NextResponse.json({ error: "No company profile" }, { status: 400 });
    }

    const profile = company as CompanyProfile;
    let agencies = getAgenciesForProfile(profile.industry, profile.jurisdictions);
    if (agencyFilter) {
      agencies = agencies.filter((a) =>
        a.name.toLowerCase().includes(agencyFilter.toLowerCase())
      );
      if (agencies.length === 0) {
        agencies = [
          {
            name: agencyFilter,
            url: "",
            feedUrl: "",
            industries: [profile.industry],
            jurisdiction: "US",
            searchTerms: [
              `${agencyFilter} ${profile.industry} regulation update`,
              `${agencyFilter} enforcement action ${profile.industry}`,
            ],
          },
        ];
      }
    }

    const { data: existing } = await supabase
      .from("alerts")
      .select("source_url")
      .eq("company_id", company.id);
    const seenUrls = new Set((existing ?? []).map((a) => a.source_url));

    const searchTasks: { agency: RegulatoryAgency; term: string }[] = [];
    for (const agency of agencies.slice(0, 6)) {
      for (const term of agency.searchTerms.slice(0, 2)) {
        searchTasks.push({ agency, term });
      }
    }

    const searchResults = await Promise.allSettled(
      searchTasks.map(async ({ agency, term }) => {
        const res = await tavilySearch(term, {
          timeRange: "month",
          maxResults: 4,
          topic: "news",
        });
        return { agency, results: (res.results ?? []) as TavilyResult[] };
      })
    );

    const hits: { agency: RegulatoryAgency; result: TavilyResult }[] = [];
    const dedupe = new Set<string>();
    for (const sr of searchResults) {
      if (sr.status !== "fulfilled") continue;
      for (const result of sr.value.results) {
        if (!result.url || dedupe.has(result.url) || seenUrls.has(result.url)) continue;
        dedupe.add(result.url);
        hits.push({ agency: sr.value.agency, result });
      }
    }

    // Run GLiNER2 extraction in parallel with all hits — deterministic structured
    // entities replace raw text as LLM input, cutting token cost by ~60%.
    const synthesized = await Promise.allSettled(
      hits.slice(0, 14).map(async ({ agency, result }) => {
        const rawText = `${result.title}\n\n${result.content}`;

        // GLiNER2: extract regulation names, agencies, deadlines, penalties,
        // severity, and action type in a single forward pass (~200ms, $0.15/1M tok).
        const t0 = Date.now();
        const pioneer = await extractRegulatoryEntities(rawText);
        const glinerLatencyMs = Date.now() - t0;

        // Feed the LLM a compact structured summary if GLiNER2 produced one;
        // otherwise fall back to the raw text so the pipeline never breaks.
        const regulatoryUpdate = pioneer?.structuredSummary
          ? `[Pioneer GLiNER2 extracted entities]\n${pioneer.structuredSummary}\n\n[Source excerpt]\n${rawText.slice(0, 1200)}`
          : rawText;

        const alert = await synthesizeRegulatoryAlert({
          regulatoryUpdate,
          companyProfile: profile,
          sourceUrl: result.url,
          sourceTitle: result.title,
        });

        return { agency, result, alert, pioneer, glinerLatencyMs };
      })
    );

    const newAlerts = [];
    for (const s of synthesized) {
      if (s.status !== "fulfilled") continue;
      const { agency, result, alert, pioneer, glinerLatencyMs } = s.value;

      // ── ClickHouse: log every hit (fire-and-forget) ──────────────────────
      const entityCount = Object.values(pioneer?.entities ?? {}).flat().length;
      const rawChars = pioneer?.rawChars ?? rawTextLen(result);
      const summaryChars = pioneer?.structuredSummary?.length ?? rawChars;
      const savingsPct = rawChars > 0
        ? Math.round(Math.max(0, (1 - summaryChars / rawChars) * 100))
        : 0;

      void logMonitorRun({
        company_id: company.id,
        agency: agency.name,
        jurisdiction: agency.jurisdiction,
        industry: profile.industry,
        tavily_results: hits.length,
        gliner_entities: entityCount,
        gliner_latency_ms: glinerLatencyMs,
        token_savings_pct: savingsPct,
        alert_generated: !!(alert?.is_relevant && (alert?.confidence ?? 0) >= 0.6),
        alert_severity: alert?.severity ?? "low",
      });

      if (result.content) {
        void logRegulatoryIntelligence({
          company_id: company.id,
          agency: agency.name,
          jurisdiction: agency.jurisdiction,
          industry: profile.industry,
          source_url: result.url ?? "",
          source_title: result.title ?? "",
          content: String(result.content ?? "").slice(0, 10_000),
          entities_json: JSON.stringify(pioneer?.entities ?? {}),
          relevance_score: alert?.confidence ?? 0,
          alert_generated: !!(alert?.is_relevant && (alert?.confidence ?? 0) >= 0.6),
        });
      }
      // ─────────────────────────────────────────────────────────────────────

      if (!alert?.is_relevant || (alert?.confidence ?? 0) < 0.6) continue;
      newAlerts.push({
        company_id: company.id,
        title: alert.title,
        summary: alert.summary,
        agency: agency.name,
        jurisdiction: agency.jurisdiction,
        severity: alert.severity,
        affected_products: alert.affected_products ?? [],
        required_action: alert.required_action,
        deadline: alert.deadline,
        source_url: result.url,
        source_title: result.title,
        // Pioneer inference_id stored alongside Tavily data — no schema migration needed.
        raw_tavily_data: {
          ...result,
          ...(pioneer?.inferenceId ? { pioneer_inference_id: pioneer.inferenceId } : {}),
        },
      });
    }

    function rawTextLen(result: TavilyResult): number {
      return ((result.title ?? "") + "\n\n" + (result.content ?? "")).length;
    }

    if (newAlerts.length > 0) {
      const { error } = await supabase.from("alerts").insert(newAlerts);
      if (error) console.error("Alert insert failed:", error);
    }

    await supabase
      .from("regulatory_surface")
      .update({ last_crawled: new Date().toISOString() })
      .eq("company_id", company.id);

    return NextResponse.json({ count: newAlerts.length, alerts: newAlerts });
  } catch (err) {
    console.error("Monitor scan failed:", err);
    return NextResponse.json({ error: "Monitor scan failed" }, { status: 500 });
  }
}
