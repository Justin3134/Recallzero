import { redirect } from "next/navigation";
import { getSessionCompany } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Topbar } from "@/components/dashboard/Topbar";
import { cn } from "@/lib/utils";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userEmail, company } = await getSessionCompany();

  if (!company) {
    redirect("/onboarding");
  }

  const supabase = await createClient();
  const [{ count: unreadCount }, { count: criticalUnread }, { data: surfaceRow }] =
    await Promise.all([
      supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("is_read", false),
      supabase
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("is_read", false)
        .eq("severity", "critical"),
      supabase
        .from("regulatory_surface")
        .select("last_crawled")
        .eq("company_id", company.id)
        .not("last_crawled", "is", null)
        .order("last_crawled", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar unreadCount={unreadCount ?? 0} />
      <div className="flex-1 flex flex-col min-w-0">
        <div
          className={cn("regulatory-pulse", (criticalUnread ?? 0) > 0 && "critical")}
        />
        <Topbar
          companyName={company.name}
          userEmail={userEmail}
          lastScanned={surfaceRow?.last_crawled ?? null}
          unreadCount={unreadCount ?? 0}
        />
        <main className="flex-1 p-6 bg-background">{children}</main>
      </div>
    </div>
  );
}
