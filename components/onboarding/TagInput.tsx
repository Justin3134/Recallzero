"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function TagInput({
  value,
  onChange,
  placeholder,
  suggested,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggested?: string[];
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setDraft("");
  }

  function addSuggested(tag: string) {
    if (!value.includes(tag)) {
      onChange([...value, tag]);
    }
  }

  const unusedSuggestions = (suggested ?? []).filter((s) => !value.includes(s));

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-background px-2.5 py-2 flex flex-wrap gap-1.5 focus-within:border-zinc-600 transition-all">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-foreground text-background text-xs px-2.5 py-1 rounded-md font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-background/60 hover:text-background transition-colors ml-0.5"
              aria-label={`Remove ${tag}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={value.length === 0 ? placeholder : "Add more..."}
          className={cn(
            "flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground py-0.5 px-1"
          )}
        />
      </div>
      {unusedSuggestions.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground font-medium shrink-0">Detected:</span>
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addSuggested(s)}
              className="text-[11px] bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] px-2 py-0.5 rounded-md hover:bg-[#22c55e]/15 transition-colors font-medium"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
