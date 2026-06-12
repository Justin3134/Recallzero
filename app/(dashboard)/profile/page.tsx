import Link from "next/link";
import { getSessionCompany, getSurface } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { INDUSTRIES } from "@/lib/industries";

export const metadata = { title: "Business Profile — Recall0" };

function TagList({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className="text-xs bg-secondary text-foreground px-2 py-1 rounded">
          {t}
        </span>
      ))}
    </div>
  );
}

export default async function ProfilePage() {
  const { company } = await getSessionCompany();
  if (!company) return null;

  const surface = await getSurface(company.id);
  const industryLabel =
    INDUSTRIES.find((i) => i.id === company.industry)?.label ?? company.industry;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{company.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {industryLabel} · {surface.length} agencies monitored
          </p>
        </div>
        <Link href="/onboarding">
          <Button variant="outline" className="border-border text-sm">
            <Pencil size={14} /> Rebuild profile
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <div className="p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Description
          </p>
          <p className="text-sm">{company.description || "—"}</p>
        </div>
        <div className="p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Products & services
          </p>
          <TagList items={company.products ?? []} />
        </div>
        {(company.ingredients?.length ?? 0) > 0 && (
          <div className="p-5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Key ingredients / compounds
            </p>
            <TagList items={company.ingredients ?? []} />
          </div>
        )}
        {(company.claims?.length ?? 0) > 0 && (
          <div className="p-5">
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              Marketing claims
            </p>
            <TagList items={company.claims ?? []} />
          </div>
        )}
        <div className="p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            Jurisdictions
          </p>
          <TagList items={company.jurisdictions ?? []} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Rebuilding your profile re-maps your regulatory surface from scratch and replaces
        existing agency mappings.
      </p>
    </div>
  );
}
