"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid, X, ChevronRight, Building2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedCheck } from "@/hooks/useRecentChecks";

const STATUS_META = {
  clear: { label: "Clear", color: "#22c55e", bg: "bg-green-500/10", border: "border-green-500/20" },
  review: { label: "Review", color: "#eab308", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
  blocked: { label: "Blocked", color: "#ef4444", bg: "bg-red-500/10", border: "border-red-500/20" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function DashboardButton({
  checks,
  onSelect,
  onRemove,
}: {
  checks: SavedCheck[];
  onSelect: (check: SavedCheck) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex items-center gap-2 h-8 px-3 rounded-lg text-[13px] font-medium transition-all border",
          open
            ? "bg-white/[0.08] border-white/[0.15] text-white"
            : "bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.07] hover:border-white/[0.12]"
        )}
      >
        <LayoutGrid size={13} />
        My companies
        {checks.length > 0 && (
          <span
            className={cn(
              "min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center tabular-nums transition-colors",
              open ? "bg-white/15 text-white" : "bg-white/[0.08] text-white/50"
            )}
          >
            {checks.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[340px] rounded-2xl border border-white/[0.1] bg-[#111113]/98 backdrop-blur-xl shadow-2xl shadow-black/60 overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/[0.06]">
            <div>
              <p className="text-[13px] font-semibold text-white">Recent companies</p>
              <p className="text-[11px] text-white/35 mt-0.5">
                {checks.length === 0
                  ? "No checks saved yet"
                  : `${checks.length} saved · click to reload`}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-6 h-6 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] flex items-center justify-center text-white/40 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          </div>

          {/* Company list / empty state */}
          <div className="max-h-[360px] overflow-y-auto py-1.5 scrollbar-none">
            {checks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center mb-3">
                  <Building2 size={16} className="text-white/25" />
                </div>
                <p className="text-[13px] font-medium text-white/50 mb-1">No companies yet</p>
                <p className="text-[11px] text-white/25 leading-relaxed">
                  Complete a compliance check to save it here for quick access.
                </p>
              </div>
            ) : (
              checks.map((check) => {
                const meta = STATUS_META[check.overallStatus] ?? STATUS_META.review;
                return (
                  <div
                    key={check.id}
                    className="group relative flex items-center gap-3 mx-1.5 my-0.5 px-3 py-2.5 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer"
                    onClick={() => {
                      onSelect(check);
                      setOpen(false);
                    }}
                  >
                    {/* Icon */}
                    <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.07] flex items-center justify-center shrink-0">
                      <Building2 size={14} className="text-white/40" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-medium text-white/90 truncate">
                          {check.companyName}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border",
                            meta.bg,
                            meta.border
                          )}
                          style={{ color: meta.color }}
                        >
                          {meta.label.toUpperCase()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-white/30 tabular-nums font-mono">
                          {check.overallScore}
                          <span className="text-white/20"> risk</span>
                        </span>
                        <span className="w-px h-2.5 bg-white/[0.08]" />
                        <span className="text-[11px] text-white/25">
                          {check.products.length} product{check.products.length !== 1 ? "s" : ""}
                        </span>
                        <span className="w-px h-2.5 bg-white/[0.08]" />
                        <span className="flex items-center gap-0.5 text-[11px] text-white/25 font-mono">
                          <Clock size={9} className="opacity-60" />
                          {timeAgo(check.date)}
                        </span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-white/20 group-hover:text-white/50 transition-colors"
                    />

                    {/* Remove button — appears on hover */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(check.id);
                      }}
                      className="absolute right-10 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md bg-white/[0.06] hover:bg-red-500/20 flex items-center justify-center text-white/20 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                      title="Remove"
                    >
                      <X size={9} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note */}
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <p className="text-[10px] font-mono text-white/20">
              Saved locally · no account needed
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
