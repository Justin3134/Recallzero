import { getAlerts, getSessionCompany, getSurface } from "@/lib/data";
import { SurfaceMap } from "@/components/dashboard/SurfaceMap";

export const metadata = { title: "Surface Map — Recall0" };

export default async function SurfacePage() {
  const { company } = await getSessionCompany();
  if (!company) return null;

  const [surface, alerts] = await Promise.all([
    getSurface(company.id),
    getAlerts(company.id),
  ]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Regulatory Surface Map</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every agency that touches your business — {surface.length} bodies under 24/7 watch.
        </p>
      </div>
      <SurfaceMap surface={surface} alerts={alerts} />
    </div>
  );
}
