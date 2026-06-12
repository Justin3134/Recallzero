import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mapRegulatorySurface } from "@/lib/ai";
import type { CompanyProfile } from "@/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const profile: CompanyProfile = body.companyProfile;
    if (!profile?.name || !profile?.industry || !profile?.jurisdictions?.length) {
      return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
    }

    // Replace any existing company for this user (single-company model).
    await supabase.from("companies").delete().eq("user_id", user.id);

    const companyPayload: Record<string, unknown> = {
      user_id: user.id,
      name: profile.name,
      description: profile.description ?? null,
      industry: profile.industry,
      sub_industry: profile.sub_industry ?? null,
      products: profile.products ?? [],
      ingredients: profile.ingredients ?? [],
      claims: profile.claims ?? [],
      jurisdictions: profile.jurisdictions,
      employee_count: profile.employee_count ?? null,
      website: profile.website ?? null,
    };

    let { data: company, error: companyError } = await supabase
      .from("companies")
      .insert(companyPayload)
      .select()
      .single();

    // If the website column doesn't exist yet (PGRST204 = PostgREST schema cache miss,
    // 42703 = Postgres undefined_column), retry without it
    if (
      companyError &&
      (companyError.code === "42703" || companyError.code === "PGRST204") &&
      "website" in companyPayload
    ) {
      const { website: _w, ...payloadWithoutWebsite } = companyPayload;
      void _w;
      ({ data: company, error: companyError } = await supabase
        .from("companies")
        .insert(payloadWithoutWebsite)
        .select()
        .single());
    }

    if (companyError || !company) {
      console.error(companyError);
      return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
    }

    const surface = await mapRegulatorySurface(profile);

    const rows = surface.agencies.map((a) => ({
      company_id: company.id,
      agency: a.name,
      jurisdiction: a.jurisdiction,
      relevance: a.relevance,
      relevance_score: a.relevance_score,
      priority: a.priority,
      key_regulations: a.key_regulations ?? [],
      watch_urls: a.watch_url ? [a.watch_url] : [],
    }));

    const { error: surfaceError } = await supabase
      .from("regulatory_surface")
      .insert(rows);
    if (surfaceError) console.error(surfaceError);

    return NextResponse.json({ company, surface });
  } catch (err) {
    console.error("Surface mapping failed:", err);
    return NextResponse.json({ error: "Surface mapping failed" }, { status: 500 });
  }
}
