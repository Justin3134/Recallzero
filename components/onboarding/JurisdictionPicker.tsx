"use client";

import { cn } from "@/lib/utils";
import { Globe } from "lucide-react";

const REGIONS = [
  { id: "US", label: "United States", sub: "Federal agencies" },
  { id: "EU", label: "European Union", sub: "EU-wide bodies" },
  { id: "UK", label: "United Kingdom", sub: "UK regulators" },
  { id: "CA", label: "Canada", sub: "Federal + provincial" },
  { id: "AU", label: "Australia", sub: "Federal regulators" },
];

const US_STATES = [
  ["US-CA", "California"],
  ["US-TX", "Texas"],
  ["US-NY", "New York"],
  ["US-FL", "Florida"],
  ["US-IL", "Illinois"],
  ["US-WA", "Washington"],
  ["US-MA", "Massachusetts"],
  ["US-CO", "Colorado"],
  ["US-GA", "Georgia"],
  ["US-NJ", "New Jersey"],
  ["US-PA", "Pennsylvania"],
  ["US-OH", "Ohio"],
] as const;

export function JurisdictionPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  const usSelected = value.some((v) => v === "US" || v.startsWith("US-"));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {REGIONS.map((r) => {
          const selected = value.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id)}
              className={cn(
                "relative text-left rounded-xl border p-4 transition-all duration-300 ease-out overflow-hidden",
                selected
                  ? "border-foreground bg-foreground text-background shadow-[0_0_30px_rgba(244,244,245,0.08)]"
                  : "border-border bg-card hover:border-zinc-500 hover:bg-white/[0.03]"
              )}
            >
              <span
                className={cn(
                  "absolute top-3.5 right-3.5 w-1.5 h-1.5 rounded-full transition-all duration-300",
                  selected ? "bg-[#16a34a] scale-100" : "bg-transparent scale-0"
                )}
              />
              <Globe
                size={17}
                className={cn(
                  "mb-2 transition-colors duration-300",
                  selected ? "text-background" : "text-muted-foreground"
                )}
              />
              <p
                className={cn(
                  "font-semibold text-sm transition-colors duration-300",
                  selected ? "text-background" : "text-foreground"
                )}
              >
                {r.label}
              </p>
              <p
                className={cn(
                  "text-xs mt-0.5 transition-colors duration-300",
                  selected ? "text-background/60" : "text-muted-foreground"
                )}
              >
                {r.sub}
              </p>
            </button>
          );
        })}
      </div>

      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">
          US state-level monitoring{" "}
          {!usSelected && <span className="normal-case">(also enables federal coverage)</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {US_STATES.map(([id, label]) => {
            const selected = value.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={cn(
                  "px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200",
                  selected
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-transparent text-muted-foreground hover:border-zinc-500 hover:text-foreground"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
