"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, ThumbsUp, ThumbsDown } from "lucide-react";
import { severityConfig, timeAgo } from "@/lib/severity";
import { cn } from "@/lib/utils";
import type { Alert } from "@/types";

type FeedbackState = "idle" | "sending" | "done";

export function AlertCard({
  alert,
  onRead,
}: {
  alert: Alert;
  onRead?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>("idle");
  const sev = severityConfig(alert.severity);

  const inferenceId = alert.raw_tavily_data?.pioneer_inference_id;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !alert.is_read) onRead?.(alert.id);
  }

  async function submitFeedback(correct: boolean) {
    if (!inferenceId || feedback !== "idle") return;
    setFeedback("sending");
    try {
      await fetch("/api/pioneer-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inferenceId, correct }),
      });
    } catch {
      // best-effort — don't surface errors to the user
    } finally {
      setFeedback("done");
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-4 cursor-pointer transition-all duration-150",
        !alert.is_read
          ? "bg-card border-border hover:border-zinc-600"
          : "bg-background border-border/40 hover:border-border"
      )}
      onClick={toggle}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: sev.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold"
              style={{ color: sev.color, backgroundColor: sev.color + "15" }}
            >
              {sev.label}
            </span>
            <span className="text-xs text-muted-foreground font-mono">{alert.agency}</span>
            {alert.jurisdiction && (
              <span className="text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded font-mono">
                {alert.jurisdiction}
              </span>
            )}
            {!alert.is_read && (
              <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" title="Unread" />
            )}
          </div>
          <p className="text-foreground font-semibold text-sm mb-1 leading-snug">{alert.title}</p>
          <p className={cn("text-muted-foreground text-sm leading-relaxed", !expanded && "line-clamp-2")}>
            {alert.summary}
          </p>
          {alert.affected_products?.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {alert.affected_products.map((p) => (
                <span
                  key={p}
                  className="text-[11px] text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded-md"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground font-mono">
            {timeAgo(alert.created_at)}
          </span>
          <ChevronDown
            size={15}
            className={cn(
              "text-muted-foreground transition-transform",
              expanded && "rotate-180"
            )}
          />
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-3 ml-5">
          {alert.required_action && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 font-mono">
                Required Action
              </p>
              <p className="text-sm text-foreground">{alert.required_action}</p>
            </div>
          )}
          {alert.deadline && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 font-mono">
                Deadline
              </p>
              <p className="text-sm text-red-400 font-medium">{alert.deadline}</p>
            </div>
          )}
          {alert.source_url && (
            <a
              href={alert.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-foreground font-medium hover:text-muted-foreground transition-colors border border-border rounded-lg px-3 py-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {alert.source_title ?? "View source"} <ExternalLink size={12} />
            </a>
          )}

          {inferenceId && (
            <div
              className="flex items-center gap-3 pt-1"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-widest">
                Was this alert accurate?
              </p>
              {feedback === "done" ? (
                <span className="text-[11px] text-muted-foreground font-mono">
                  Thanks — Recall0 just got smarter.
                </span>
              ) : (
                <>
                  <button
                    disabled={feedback === "sending"}
                    onClick={() => submitFeedback(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors disabled:opacity-40"
                  >
                    <ThumbsUp size={11} /> Yes
                  </button>
                  <button
                    disabled={feedback === "sending"}
                    onClick={() => submitFeedback(false)}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-zinc-500 transition-colors disabled:opacity-40"
                  >
                    <ThumbsDown size={11} /> No
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
