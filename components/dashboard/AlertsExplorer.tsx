"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCard } from "./AlertCard";
import { cn } from "@/lib/utils";
import { BellOff, CheckCheck, Search } from "lucide-react";
import type { Alert } from "@/types";

const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;

export function AlertsExplorer({ alerts: initialAlerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("all");
  const [agency, setAgency] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const agencies = useMemo(
    () => Array.from(new Set(initialAlerts.map((a) => a.agency))).sort(),
    [initialAlerts]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return alerts.filter((a) => {
      if (severity !== "all" && a.severity !== severity) return false;
      if (agency !== "all" && a.agency !== agency) return false;
      if (unreadOnly && a.is_read) return false;
      if (
        q &&
        ![a.title, a.summary, a.agency, a.required_action ?? "", ...(a.affected_products ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [alerts, query, severity, agency, unreadOnly]);

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  async function markRead(id: string) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], is_read: true }),
    }).catch(() => null);
  }

  async function markAllRead() {
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, is_read: true }),
    }).catch(() => null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search alerts, agencies, products..."
            className="w-full bg-[#111113] border border-border rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-zinc-600 transition-colors placeholder:text-muted-foreground text-foreground"
          />
        </div>
        <select
          value={agency}
          onChange={(e) => setAgency(e.target.value)}
          className="bg-[#111113] border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-600 text-foreground"
        >
          <option value="all">All agencies</option>
          {agencies.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
          >
            <CheckCheck size={14} /> Mark all read ({unreadCount})
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-all capitalize",
              severity === s
                ? "bg-white/10 text-white border-white/20"
                : "border-border text-muted-foreground hover:text-foreground hover:border-zinc-600 bg-transparent"
            )}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-all",
            unreadOnly
              ? "bg-white/10 text-white border-white/20"
              : "border-border text-muted-foreground hover:text-foreground hover:border-zinc-600 bg-transparent"
          )}
        >
          Unread only
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <BellOff size={22} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No alerts match</p>
          <p className="text-xs text-muted-foreground mt-1">
            Adjust your filters or run a fresh scan from the top bar.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-mono text-muted-foreground">
            {filtered.length} alert{filtered.length === 1 ? "" : "s"}
          </p>
          {filtered.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}
