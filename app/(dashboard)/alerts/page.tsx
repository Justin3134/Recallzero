import { getAlerts, getSessionCompany } from "@/lib/data";
import { AlertsExplorer } from "@/components/dashboard/AlertsExplorer";

export const metadata = { title: "Alerts — Recall0" };

export default async function AlertsPage() {
  const { company } = await getSessionCompany();
  if (!company) return null;

  const alerts = await getAlerts(company.id);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">All Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every regulatory change that touches your business, mapped and scored.
        </p>
      </div>
      <AlertsExplorer alerts={alerts} />
    </div>
  );
}
