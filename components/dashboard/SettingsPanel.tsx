"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LogOut } from "lucide-react";
import { PioneerModelPanel } from "@/components/dashboard/PioneerModelPanel";

export function SettingsPanel({
  userEmail,
  companyName,
  pioneerModelId,
  pioneerIsFineTuned,
}: {
  userEmail: string | null;
  companyName: string;
  pioneerModelId?: string;
  pioneerIsFineTuned?: boolean;
}) {
  const router = useRouter();
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(true);

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Account</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Email</span>
            <span className="font-mono text-foreground">{userEmail ?? "—"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Company</span>
            <span className="font-medium">{companyName}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Plan</span>
            <span className="text-[#22c55e] font-semibold">Pro — $499/mo</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-4">Notifications</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Email alerts</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Get notified the moment a relevant change is detected
              </p>
            </div>
            <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Critical only</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only notify for critical-severity alerts
              </p>
            </div>
            <Switch checked={criticalOnly} onCheckedChange={setCriticalOnly} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Weekly digest</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                A summary of your regulatory week, every Monday
              </p>
            </div>
            <Switch checked={weeklyDigest} onCheckedChange={setWeeklyDigest} />
          </div>
        </div>
      </div>

      {pioneerModelId && (
        <PioneerModelPanel
          activeModelId={pioneerModelId}
          isFineTuned={pioneerIsFineTuned ?? false}
        />
      )}

      <Button
        variant="outline"
        onClick={logout}
        className="border-border text-muted-foreground hover:text-foreground"
      >
        <LogOut size={14} /> Log out
      </Button>
    </div>
  );
}
