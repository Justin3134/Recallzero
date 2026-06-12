"use client";

import { useMemo, useState } from "react";
import { AlertCard } from "./AlertCard";
import { cn } from "@/lib/utils";
import { BellOff } from "lucide-react";
import type { Alert } from "@/types";

const FILTERS = ["All", "Critical", "High", "Medium", "Low", "Unread"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#eab308",
  Low: "#22c55e",
};

export function AlertFeed({
  alerts: initialAlerts,
  compact,
}: {
  alerts: Alert[];
  compact?: boolean;
}) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [filter, setFilter] = useState<Filter>("All");

  const filtered = useMemo(() => {
    switch (filter) {
      case "All":
        return alerts;
      case "Unread":
        return alerts.filter((a) => !a.is_read);
      default:
        return alerts.filter((a) => a.severity === filter.toLowerCase());
    }
  }, [alerts, filter]);

  async function markRead(id: string) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], is_read: true }),
    }).catch(() => null);
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {FILTERS.map((f) => {
          const color = FILTER_COLORS[f];
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all duration-100",
                active && color
                  ? "text-white border-transparent"
                  : active
                    ? "bg-white/10 text-white border-white/20"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-zinc-600 bg-transparent"
              )}
              style={active && color ? { backgroundColor: color, borderColor: color } : undefined}
            >
              {f}
              {f === "Unread" && (
                <span className="ml-1 font-mono">
                  ({alerts.filter((a) => !a.is_read).length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center bg-transparent">
          <BellOff size={22} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-semibold text-foreground">No alerts here</p>
          <p className="text-xs text-muted-foreground mt-1">
            {filter === "All"
              ? "Run a scan from the top bar to check for new regulatory activity."
              : `No ${filter.toLowerCase()} alerts right now.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {(compact ? filtered.slice(0, 8) : filtered).map((alert) => (
            <AlertCard key={alert.id} alert={alert} onRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}
