import { getSessionCompany } from "@/lib/data";
import { LiveMonitorPanel } from "@/components/dashboard/LiveMonitorPanel";
import { redirect } from "next/navigation";

export const metadata = { title: "Live Monitor — Recall0" };

const BASE_MODEL = "fastino/gliner2-base-v1";

export default async function LivePage() {
  const { company } = await getSessionCompany();
  if (!company) redirect("/onboarding");

  const glinerModel = process.env.PIONEER_GLINER_MODEL ?? BASE_MODEL;
  const isFineTuned = glinerModel !== BASE_MODEL;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Live Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time regulatory scanning with GLiNER2 entity extraction — watch the model work.
        </p>
      </div>
      <LiveMonitorPanel
        companyName={company.name}
        industry={company.industry}
        products={company.products ?? []}
        glinerModel={glinerModel}
        isFineTuned={isFineTuned}
      />
    </div>
  );
}
