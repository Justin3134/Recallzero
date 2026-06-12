import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseFile } from "@/lib/parser";
import { tavilySearch } from "@/lib/tavily";
import { auditDocument } from "@/lib/ai";
import { extractRegulatoryEntities } from "@/lib/pioneer";
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

    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (!company) {
      return NextResponse.json({ error: "No company profile" }, { status: 400 });
    }
    const profile = company as CompanyProfile;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = await parseFile(buffer, file.type, file.name);
    } catch {
      return NextResponse.json(
        { error: "Unsupported or unreadable file. Use PDF, PNG, JPG, DOCX, CSV, or TXT." },
        { status: 400 }
      );
    }

    if (!parsed.text || parsed.text.trim().length < 20) {
      return NextResponse.json(
        { error: "Could not extract readable text from this file." },
        { status: 400 }
      );
    }

    // Run GLiNER2 entity extraction and Tavily regulatory search in parallel.
    // GLiNER2 extracts structured entities from the document itself;
    // Tavily fetches current regulatory context for the company's industry.
    const [pioneerResult, tavilyResult] = await Promise.allSettled([
      extractRegulatoryEntities(parsed.text.slice(0, 8000)),
      tavilySearch(
        `${profile.industry} compliance requirements regulations ${profile.jurisdictions.join(" ")} 2026`,
        { timeRange: "month", maxResults: 5 }
      ),
    ]);

    const pioneer = pioneerResult.status === "fulfilled" ? pioneerResult.value : null;
    const tavilySearch_ = tavilyResult.status === "fulfilled" ? tavilyResult.value : null;

    const tavilyContext = ((tavilySearch_?.results ?? []) as TavilyResult[])
      .map((r) => `${r.title}: ${r.content}`)
      .join("\n\n");

    // Combine Pioneer's structured document entities with the live regulatory context.
    let regulatoryContext = tavilyContext;
    if (pioneer?.structuredSummary) {
      regulatoryContext =
        `[Pioneer GLiNER2 — document entity extraction]\n${pioneer.structuredSummary}\n\n` +
        `[Live regulatory context]\n${tavilyContext}`;
    }

    const audit = await auditDocument({
      documentText: parsed.text,
      fileName: file.name,
      industry: profile.industry,
      jurisdictions: profile.jurisdictions,
      regulatoryContext,
    });

    const { data: scan, error } = await supabase
      .from("document_scans")
      .insert({
        company_id: company.id,
        file_name: file.name,
        file_type: parsed.fileType,
        extracted_text: parsed.text.slice(0, 8000),
        findings: audit?.findings ?? [],
        overall_risk: audit?.overall_risk ?? "review",
        risk_score: audit?.risk_score ?? 50,
        summary: audit?.summary ?? null,
        regulations_checked: audit?.regulations_checked ?? [],
      })
      .select()
      .single();

    if (error) console.error("Scan insert failed:", error);

    return NextResponse.json({ scan, audit });
  } catch (err) {
    console.error("Document scan failed:", err);
    return NextResponse.json({ error: "Document scan failed" }, { status: 500 });
  }
}
