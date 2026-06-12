import { cn } from "@/lib/utils";

export function Logo({ className, animate }: { className?: string; animate?: boolean }) {
  return (
    <span
      className={cn(
        "font-sans font-semibold tracking-tight text-white select-none",
        className
      )}
    >
      Recall{" "}
      <span className={cn("text-white/60", animate && "pulse-zero")}>0</span>
    </span>
  );
}
