import { redirect } from "next/navigation";
import { getSessionCompany } from "@/lib/data";
import { ResearchPanel } from "@/components/dashboard/ResearchPanel";

export const metadata = { title: "Reg Research — Recall0" };

export default async function ResearchPage() {
  const { company } = await getSessionCompany();

  if (!company) {
    redirect("/onboarding");
  }

  return (
    // Pull back the layout's p-6 padding so FullScreen can fill the viewport.
    <div className="-m-6 h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden">
      <ResearchPanel
        companyName={company.name}
        industry={company.industry ?? undefined}
        markets={company.jurisdictions ?? []}
      />
    </div>
  );
}
