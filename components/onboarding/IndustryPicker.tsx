"use client";

import { cn } from "@/lib/utils";
import { INDUSTRIES } from "@/lib/industries";

export function IndustryPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {INDUSTRIES.map((ind) => {
        const Icon = ind.icon;
        const selected = value === ind.id;
        return (
          <button
            key={ind.id}
            type="button"
            onClick={() => onChange(ind.id)}
            className={cn(
              "relative text-left rounded-xl border p-5 transition-all duration-300 ease-out group overflow-hidden",
              selected
                ? "border-foreground bg-foreground text-background shadow-[0_0_30px_rgba(244,244,245,0.08)]"
                : "border-border bg-card hover:border-zinc-500 hover:bg-white/[0.03]"
            )}
          >
            {/* selection indicator dot */}
            <span
              className={cn(
                "absolute top-4 right-4 w-1.5 h-1.5 rounded-full transition-all duration-300",
                selected ? "bg-[#16a34a] scale-100" : "bg-transparent scale-0"
              )}
            />
            <Icon
              size={20}
              className={cn(
                "mb-3 transition-colors duration-300",
                selected
                  ? "text-background"
                  : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            <p
              className={cn(
                "font-semibold text-sm transition-colors duration-300",
                selected ? "text-background" : "text-foreground"
              )}
            >
              {ind.label}
            </p>
            <p
              className={cn(
                "text-xs mt-0.5 transition-colors duration-300",
                selected ? "text-background/60" : "text-muted-foreground"
              )}
            >
              {ind.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
