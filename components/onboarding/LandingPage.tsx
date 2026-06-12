"use client";

import { useState, useCallback } from "react";
import { CheckFlow } from "./CheckFlow";
import { DashboardButton } from "./DashboardButton";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Shield, Bell, CheckCircle2, UploadCloud, Zap } from "lucide-react";
import { useRecentChecks } from "@/hooks/useRecentChecks";
import type { SavedCheck } from "@/hooks/useRecentChecks";
import type { ComplianceAnalysis, ProductInput } from "@/types";

type Entry =
  | { mode: "url"; url: string }
  | { mode: "blank" }
  | { mode: "upload" }
  | { mode: "restore"; check: SavedCheck };

export function LandingPage() {
  const [url, setUrl] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [spot, setSpot] = useState({ x: 50, y: 38 });

  const { checks, saveCheck, removeCheck } = useRecentChecks();

  const onMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSpot({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    });
  }, []);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setEntry({ mode: "url", url: trimmed });
  }

  function handleAnalysisSaved(
    companyName: string,
    products: ProductInput[],
    analysis: ComplianceAnalysis
  ) {
    saveCheck(companyName, products, analysis);
  }

  if (entry) {
    return (
      <CheckFlow
        initialUrl={entry.mode === "url" ? entry.url : ""}
        startUpload={entry.mode === "upload"}
        restoredCheck={entry.mode === "restore" ? entry.check : undefined}
        onBack={() => setEntry(null)}
        onAnalysisSaved={handleAnalysisSaved}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col selection:bg-white/20">
      {/* Nav */}
      <nav className="h-14 flex items-center justify-between px-6 lg:px-10 shrink-0 z-20">
        <Logo className="text-[15px]" />
        <DashboardButton
          checks={checks}
          onSelect={(check) => setEntry({ mode: "restore", check })}
          onRemove={removeCheck}
        />
      </nav>

      {/* Hero */}
      <main
        onMouseMove={onMove}
        className="relative flex-1 flex flex-col items-center justify-center px-6 py-16 overflow-hidden"
      >
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-300"
          style={{
            background: `radial-gradient(600px circle at ${spot.x}% ${spot.y}%, rgba(34,197,94,0.045), transparent 60%)`,
          }}
        />
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_45%_at_50%_38%,rgba(255,255,255,0.022),transparent)]" />

        <div className="relative z-10 w-full max-w-xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 mb-10 text-[11px] font-mono text-white/30 border border-white/[0.07] rounded-full px-4 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            Global compliance check in under a minute
          </div>

          <h1 className="text-[clamp(2.6rem,7vw,4.8rem)] font-bold tracking-[-0.04em] leading-[0.96] mb-5">
            Where can you
            <br />
            <span className="text-white/25">sell it?</span>
          </h1>

          <p className="text-[15px] text-white/38 max-w-sm mx-auto mb-10 leading-relaxed">
            Enter your website or upload a product label. We check your products
            against regulations in every major market — and tell you exactly where
            you can sell.
          </p>

          {/* URL input */}
          <form onSubmit={handleSubmit} className="flex gap-2 max-w-lg mx-auto">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourcompany.com"
              className="bg-white/[0.05] border-white/[0.1] text-white placeholder:text-white/22 h-12 text-sm flex-1 focus-visible:ring-white/20 focus-visible:border-white/25"
              autoFocus
            />
            <Button
              type="submit"
              disabled={!url.trim()}
              className="bg-white hover:bg-white/90 text-black font-semibold h-12 px-6 text-sm rounded-lg shrink-0 group"
            >
              Check
              <ArrowRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
            </Button>
          </form>

          {/* Secondary entry points */}
          <div className="flex items-center justify-center gap-5 mt-5">
            <button
              onClick={() => setEntry({ mode: "blank" })}
              className="text-[13px] text-white/45 hover:text-white transition-colors"
            >
              Just get started
            </button>
            <span className="w-px h-3 bg-white/15" />
            <button
              onClick={() => setEntry({ mode: "upload" })}
              className="inline-flex items-center gap-1.5 text-[13px] text-white/45 hover:text-white transition-colors"
            >
              <UploadCloud size={13} /> Upload a label
            </button>
          </div>

          <p className="text-[11px] font-mono text-white/18 mt-6">No account required · Any industry</p>
        </div>
      </main>

      {/* How it works */}
      <section className="border-t border-white/[0.07]">
        <div className="max-w-2xl mx-auto px-6 py-14 grid grid-cols-1 sm:grid-cols-3 gap-8">
          {[
            { icon: Shield, t: "Check", d: "Enter your URL or a label. We detect your products and check them against current regulations." },
            { icon: CheckCircle2, t: "See the map", d: "A world map shows green, yellow, and red — exactly where you can and can't sell, and at which retailers." },
            { icon: Bell, t: "Monitor", d: "Save your report and get alerted whenever the regulations affecting you change." },
          ].map((s) => (
            <div key={s.t} className="text-center sm:text-left">
              <s.icon size={14} className="text-white/28 mb-3 mx-auto sm:mx-0" />
              <p className="text-[13px] font-semibold mb-1">{s.t}</p>
              <p className="text-[12px] text-white/28 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pioneer AI showcase */}
      <section className="border-t border-white/[0.07]">
        <div className="max-w-2xl mx-auto px-6 py-14 space-y-8">
          <div className="flex items-center gap-2">
            <Zap size={12} className="text-white/25" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-white/25">Powered by Pioneer AI</span>
          </div>

          {/* Pipeline: three steps */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.05] rounded-xl overflow-hidden border border-white/[0.07]">
            {/* Step 1 */}
            <div className="bg-black px-5 py-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/25">01 / Entity extraction</p>
              <p className="text-[12px] font-medium text-white/70 leading-snug">
                Pioneer GLiNER2 reads every regulatory article in ~200ms
              </p>
              <div className="flex flex-wrap gap-1">
                {[
                  "FDA",
                  "21 CFR 101",
                  "Jan 2025",
                  "$10k/violation",
                  "California",
                  "dietary supplements",
                ].map((label) => (
                  <span key={label} className="text-[8px] font-mono px-1.5 py-0.5 rounded border bg-white/[0.06] text-white/45 border-white/[0.1]">
                    {label}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-white/25 font-mono">8 entity types · $0.15 / 1M tokens</p>
            </div>

            {/* Step 2 */}
            <div className="bg-black px-5 py-5 space-y-3 border-t sm:border-t-0 sm:border-l border-white/[0.05]">
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/25">02 / LLM synthesis</p>
              <p className="text-[12px] font-medium text-white/70 leading-snug">
                Compact entity summary replaces raw text — ~60% fewer tokens to the LLM
              </p>
              <div className="space-y-1.5">
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full w-[100%] bg-white/10 rounded-full" />
                </div>
                <div className="flex justify-between text-[8px] font-mono text-white/20">
                  <span>Raw text</span><span>4 kB</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full w-[40%] bg-[#22c55e]/30 rounded-full" />
                </div>
                <div className="flex justify-between text-[8px] font-mono text-white/25">
                  <span>After GLiNER2</span><span className="text-[#22c55e]/60">~1.6 kB</span>
                </div>
              </div>
              <p className="text-[10px] text-white/25 font-mono">Pioneer OpenAI-compatible API</p>
            </div>

            {/* Step 3 */}
            <div className="bg-black px-5 py-5 space-y-3 border-t sm:border-t-0 sm:border-l border-white/[0.05]">
              <p className="text-[10px] font-mono uppercase tracking-widest text-white/25">03 / Adaptive loop</p>
              <p className="text-[12px] font-medium text-white/70 leading-snug">
                Thumbs up/down on every alert feeds Pioneer&apos;s retraining pipeline
              </p>
              <div className="space-y-2">
                {[
                  { label: "Base model deployed", done: true },
                  { label: "300 synthetic examples", done: true },
                  { label: "Fine-tuned on regulatory NER", done: false },
                  { label: "Auto-retrain at 100 corrections", done: false },
                ].map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.done ? "bg-white/40" : "bg-white/10"}`} />
                    <span className={`text-[9px] leading-none ${s.done ? "text-white/40" : "text-white/18"}`}>{s.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-white/25 font-mono">LoRA fine-tune · zero cost per retrain</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.07]">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Logo className="text-[13px] text-white/35" />
          <span className="text-[10px] font-mono text-white/18 tracking-[0.2em] uppercase">Zero recalls.</span>
        </div>
      </footer>
    </div>
  );
}
