import { getScans, getSessionCompany } from "@/lib/data";
import { ScanUpload } from "@/components/dashboard/ScanUpload";

export const metadata = { title: "Document Scan — Recall0" };

export default async function ScanPage() {
  const { company } = await getSessionCompany();
  if (!company) return null;

  const scans = await getScans(company.id);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Document Scan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload any document and audit it against live regulatory standards.
        </p>
      </div>
      <ScanUpload recentScans={scans} />
    </div>
  );
}
