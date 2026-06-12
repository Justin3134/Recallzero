import { getSessionCompany } from "@/lib/data";
import { SettingsPanel } from "@/components/dashboard/SettingsPanel";

export const metadata = { title: "Settings — Recall0" };

const BASE_MODEL = "fastino/gliner2-base-v1";

export default async function SettingsPage() {
  const { userEmail, company } = await getSessionCompany();
  if (!company) return null;

  const glinerModel = process.env.PIONEER_GLINER_MODEL ?? BASE_MODEL;
  const isFineTuned = glinerModel !== BASE_MODEL;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Account and monitoring preferences.
        </p>
      </div>
      <SettingsPanel
        userEmail={userEmail}
        companyName={company.name}
        pioneerModelId={process.env.PIONEER_API_KEY ? glinerModel : undefined}
        pioneerIsFineTuned={isFineTuned}
      />
    </div>
  );
}
