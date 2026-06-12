import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Alert, CompanyProfile, DocumentScan, SurfaceAgency } from "@/types";

export async function getSessionCompany(): Promise<{
  userEmail: string | null;
  company: (CompanyProfile & { id: string }) | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userEmail: null, company: null };

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return {
    userEmail: user.email ?? null,
    company: (company as CompanyProfile & { id: string }) ?? null,
  };
}

export async function getAlerts(companyId: string): Promise<Alert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alerts")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data as Alert[]) ?? [];
}

export async function getSurface(companyId: string): Promise<SurfaceAgency[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("regulatory_surface")
    .select("*")
    .eq("company_id", companyId)
    .order("relevance_score", { ascending: false });
  return (data as SurfaceAgency[]) ?? [];
}

export async function getScans(companyId: string): Promise<DocumentScan[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("document_scans")
    .select("id, company_id, file_name, file_type, findings, overall_risk, risk_score, summary, regulations_checked, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data as DocumentScan[]) ?? [];
}
