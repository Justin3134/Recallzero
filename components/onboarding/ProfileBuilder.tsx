"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { IndustryPicker } from "./IndustryPicker";
import { JurisdictionPicker } from "./JurisdictionPicker";
import { TagInput } from "./TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Radar, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const BUILD_STAGES = [
  "Identifying agencies...",
  "Mapping exposure...",
  "Scoring relevance...",
  "Running first scan...",
];

const STEPS = ["Industry", "Business Details", "Jurisdictions"];

export function ProfileBuilder() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [building, setBuilding] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [industry, setIndustry] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [suggestedProducts, setSuggestedProducts] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [claims, setClaims] = useState<string[]>([]);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);

  const [detectingProducts, setDetectingProducts] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState<string | null>(null);

  const needsIngredients = industry === "food" || industry === "pharma";

  useEffect(() => {
    return () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    };
  }, []);

  useEffect(() => {
    async function ensureSession() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) return;

      const res = await fetch("/api/auth/guest", { method: "POST" });
      if (!res.ok) return;

      const { email, password } = await res.json();
      await supabase.auth.signInWithPassword({ email, password });
    }
    ensureSession();
  }, []);

  const canNext =
    step === 0
      ? !!industry
      : step === 1
        ? name.trim().length > 1 && products.length > 0
        : jurisdictions.length > 0;

  async function detectProducts() {
    if (!website.trim()) return;
    setDetectingProducts(true);
    setDetectionMessage(null);
    try {
      const res = await fetch("/api/website-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: website.trim() }),
      });
      const data = await res.json();
      if (data.products?.length > 0) {
        setSuggestedProducts(data.products);
        if (!name && data.company_name) setName(data.company_name);
        if (!description && data.description) setDescription(data.description);
        setDetectionMessage(`Found ${data.products.length} product${data.products.length === 1 ? "" : "s"}. Click to add.`);
      } else {
        setDetectionMessage(data.message ?? "No products detected. Add them manually below.");
      }
    } catch {
      setDetectionMessage("Could not reach the website. Add products manually.");
    } finally {
      setDetectingProducts(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setBuilding(true);
    setStageIdx(0);
    stageTimer.current = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, BUILD_STAGES.length - 1));
    }, 5000);

    const profile = {
      name: name.trim(),
      description: description.trim(),
      industry,
      products,
      ingredients,
      claims,
      jurisdictions,
      website: website.trim() || null,
    };

    try {
      const surfaceRes = await fetch("/api/surface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyProfile: profile }),
      });
      if (!surfaceRes.ok) throw new Error("surface");

      setStageIdx(BUILD_STAGES.length - 1);

      await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => null);

      router.push("/");
      router.refresh();
    } catch {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setBuilding(false);
      setError("Something went wrong building your surface. Please try again.");
    }
  }

  if (building) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6">
        <div className="relative mb-10">
          <div className="w-24 h-24 rounded-full border-2 border-foreground/20 ring-pulse flex items-center justify-center">
            <Radar size={36} className="text-foreground animate-pulse" />
          </div>
        </div>
        <h1 className="text-xl font-bold mb-2 text-foreground">Building your regulatory surface</h1>
        <p className="text-muted-foreground text-sm font-mono h-5 transition-all">
          {BUILD_STAGES[stageIdx]}
        </p>
        <div className="mt-8 flex gap-1.5">
          {BUILD_STAGES.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 w-12 rounded-full transition-colors duration-500",
                i <= stageIdx ? "bg-foreground" : "bg-border"
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="regulatory-pulse" />

      {/* Header */}
      <div className="border-b border-border bg-[#111113]">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Logo className="text-[15px]" />
          <span className="text-xs font-mono text-muted-foreground">
            {step + 1} / 3
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Progress */}
        <div className="flex gap-1.5 mb-8">
          {STEPS.map((label, i) => (
            <div key={i} className="flex-1 space-y-1.5">
              <div
                className={cn(
                  "h-1 rounded-full transition-colors duration-300",
                  i < step ? "bg-[#22c55e]" : i === step ? "bg-foreground" : "bg-border"
                )}
              />
              <p className={cn(
                "text-[10px] font-mono",
                i === step ? "text-foreground font-semibold" : "text-muted-foreground"
              )}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Step 0: Industry */}
        {step === 0 && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1.5">
              What does your company do?
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              This determines which regulatory bodies we map and monitor for you.
            </p>
            <IndustryPicker value={industry} onChange={setIndustry} />
          </div>
        )}

        {/* Step 1: Business details */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1.5">
              Tell us about the business
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              The more specific you are, the more precise your regulatory alerts.
            </p>

            <div className="space-y-5">
              {/* Website URL with product detection */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Globe size={15} className="text-[#22c55e]" />
                  <Label className="text-sm font-semibold text-foreground">Company website</Label>
                  <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Optional</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  We&apos;ll scan your website to automatically detect your products and pre-fill the form.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourcompany.com"
                    className="bg-background border-border flex-1 h-9 text-sm"
                    onKeyDown={(e) => e.key === "Enter" && detectProducts()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={detectProducts}
                    disabled={!website.trim() || detectingProducts}
                    className="shrink-0 h-9 text-sm border-border hover:bg-white/5 text-foreground"
                  >
                    {detectingProducts ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Globe size={14} />
                    )}
                    {detectingProducts ? "Scanning..." : "Detect products"}
                  </Button>
                </div>
                {detectionMessage && (
                  <p className={cn(
                    "text-xs mt-2.5 font-medium",
                    suggestedProducts.length > 0 ? "text-[#22c55e]" : "text-muted-foreground"
                  )}>
                    {detectionMessage}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="company-name" className="text-sm font-medium">Company name</Label>
                <Input
                  id="company-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp"
                  className="bg-background border-border h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company-desc" className="text-sm font-medium">What do you do or sell?</Label>
                <Textarea
                  id="company-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="2-3 sentences. e.g. We offer buy-now-pay-later financing at checkout for online retailers..."
                  rows={3}
                  className="bg-background border-border resize-none text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Key products or services
                  <span className="text-red-400 ml-0.5">*</span>
                </Label>
                <TagInput
                  value={products}
                  onChange={setProducts}
                  placeholder="Type and press Enter — e.g. BNPL checkout loans"
                  suggested={suggestedProducts}
                />
              </div>

              {needsIngredients && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Key ingredients or compounds</Label>
                  <TagInput
                    value={ingredients}
                    onChange={setIngredients}
                    placeholder="e.g. ashwagandha, red dye 3, melatonin"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Marketing claims you make
                  <span className="text-muted-foreground text-xs ml-1.5 font-normal">(optional)</span>
                </Label>
                <TagInput
                  value={claims}
                  onChange={setClaims}
                  placeholder="e.g. 0% interest, clinically proven, all natural"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Jurisdictions */}
        {step === 2 && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1.5">
              Where do you operate?
            </h1>
            <p className="text-muted-foreground text-sm mb-8">
              We monitor every jurisdiction you select — federal, state, and international.
            </p>
            <JurisdictionPicker value={jurisdictions} onChange={setJurisdictions} />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 mt-6">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={15} /> Back
          </Button>
          {step < 2 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="bg-foreground hover:bg-foreground/90 text-background font-semibold"
            >
              Continue <ArrowRight size={15} />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canNext}
              className="bg-foreground hover:bg-foreground/90 text-background font-semibold"
            >
              <Radar size={15} /> Build my regulatory surface
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
