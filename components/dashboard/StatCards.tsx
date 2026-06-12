import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  trend,
  accent,
  sub,
}: {
  label: string;
  value: number | string;
  trend?: "up" | "down" | "flat";
  accent?: "red" | "green" | "indigo" | "default";
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground mb-3">{label}</p>
      <div className="flex items-end gap-2">
        <span
          className={cn(
            "text-3xl font-extrabold tracking-tight leading-none",
            accent === "red" && "text-red-400",
            accent === "green" && "text-green-400",
            accent === "indigo" && "text-foreground"
          )}
        >
          {value}
        </span>
        {trend === "up" && <TrendingUp size={15} className="text-red-400 mb-0.5" />}
        {trend === "down" && <TrendingDown size={15} className="text-green-400 mb-0.5" />}
        {trend === "flat" && <Minus size={15} className="text-muted-foreground mb-0.5" />}
      </div>
      {sub && (
        <p
          className={cn(
            "text-[11px] mt-2",
            accent === "red" ? "text-red-400" : "text-muted-foreground"
          )}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
