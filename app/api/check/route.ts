import { NextRequest, NextResponse } from "next/server";
import { runComplianceAnalysis } from "@/lib/compliance";
import { AiUnavailableError, enrichProductLabel } from "@/lib/ai";
import type { ProductInput } from "@/types";

export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { company_name, category, products, target_retailers, label_claims, market_scope } =
      body as {
        company_name: string;
        category: string;
        products: ProductInput[];
        target_retailers?: string[];
        label_claims?: string[];
        market_scope?: string;
      };

    if (!company_name?.trim() || !products?.length) {
      return NextResponse.json({ error: "Missing company name or products" }, { status: 400 });
    }

    // Enrich every product missing label_text with real ingredient/nutrition data
    // fetched from the web. Runs in parallel; failures fall back gracefully.
    const enriched = await Promise.all(
      products.map(async (p) => {
        if (p.label_text?.trim()) return p;
        const result = await enrichProductLabel(p.name, company_name.trim()).catch(() => null);
        if (!result) return p;
        return {
          ...p,
          label_text: result.label_text,
          ...(result.certifications?.length ? { certifications: result.certifications } : {}),
          ...(result.packaging_language ? { packaging_language: result.packaging_language } : {}),
        };
      })
    );

    const analysis = await runComplianceAnalysis({
      company_name: company_name.trim(),
      category: category || "general consumer products",
      products: enriched,
      target_retailers,
      label_claims,
      market_scope,
    });

    return NextResponse.json(analysis);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      console.error("AI billing error:", err.message);
      return NextResponse.json(
        {
          error:
            "AI service billing is not active. Please check your account billing status and retry.",
        },
        { status: 503 }
      );
    }
    console.error("Compliance check failed:", err);
    return NextResponse.json({ error: "Compliance check failed" }, { status: 500 });
  }
}
