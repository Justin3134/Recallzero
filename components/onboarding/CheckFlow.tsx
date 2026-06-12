"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import { IndustryPicker } from "./IndustryPicker";
import { ComplianceDashboard } from "@/components/dashboard/ComplianceDashboard";
import { INDUSTRIES } from "@/lib/industries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ComplianceAnalysis, ProductInput } from "@/types";
import type { SavedCheck } from "@/hooks/useRecentChecks";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Loader2,
  Check,
  Plus,
  UploadCloud,
  Package,
  Shield,
  X,
} from "lucide-react";

/** Infer a category label from a website description string. */
function inferCategory(description: string): string {
  const t = description.toLowerCase();
  if (/food|beverage|snack|protein|bar|drink|supplement|nutrition|ingredient|meal|recipe|eat|cpg/.test(t))
    return "Food & Beverage";
  if (/pharma|drug|medication|medical|biotech|clinical|therapy|health|wellness/.test(t))
    return "Pharma & Biotech";
  if (/payment|lending|finance|crypto|bank|loan|fintech|insurance/.test(t))
    return "Fintech & Lending";
  if (/construction|building|real estate|property|development|contractor/.test(t))
    return "Construction & Real Estate";
  if (/staffing|payroll|employment|hr|human resource|hiring/.test(t))
    return "HR & Employment";
  return "general consumer products";
}

const CHECK_STAGES = [
  "Researching market requirements...",
  "Checking each country...",
  "Assessing US state rules...",
  "Reviewing retailer standards...",
  "Scanning enforcement & news...",
  "Compiling your dashboard...",
];

type Phase = "setup" | "checking" | "dashboard";

function ProductThumb({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/[0.06] to-white/[0.01]">
        <Package size={18} className="text-white/20" />
      </div>
    );
  }
  return (
    <Image src={src} alt={name} fill sizes="80px" className="object-cover" onError={() => setFailed(true)} unoptimized />
  );
}

export function CheckFlow({
  initialUrl,
  startUpload,
  restoredCheck,
  onBack,
  onAnalysisSaved,
}: {
  initialUrl?: string;
  startUpload?: boolean;
  restoredCheck?: SavedCheck;
  onBack: () => void;
  onAnalysisSaved?: (companyName: string, products: ProductInput[], analysis: ComplianceAnalysis) => void;
}) {
  const [step, setStep] = useState(0); // 0 = category, 1 = products, 2 = retailers, 3 = claims
  const [phase, setPhase] = useState<Phase>(restoredCheck ? "dashboard" : "setup");
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string | null>(null);
  const [website, setWebsite] = useState(initialUrl ?? "");
  const [companyName, setCompanyName] = useState(restoredCheck?.companyName ?? "");

  // Step 2: target retailers
  const [targetRetailers, setTargetRetailers] = useState<string[]>([]);
  // Step 3: label claims, certifications + market scope
  const [labelClaims, setLabelClaims] = useState<string[]>([]);
  const [batchCertifications, setBatchCertifications] = useState<string[]>([]);
  const [marketScope, setMarketScope] = useState<string>("global");

  const [detected, setDetected] = useState<ProductInput[]>([]);
  const [selected, setSelected] = useState<ProductInput[]>(restoredCheck?.products ?? []);
  const [customName, setCustomName] = useState("");

  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hasDetected, setHasDetected] = useState(false);

  const [stageIdx, setStageIdx] = useState(0);
  const [analysis, setAnalysis] = useState<ComplianceAnalysis | null>(restoredCheck?.analysis ?? null);

  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const autoRunFired = useRef(false);

  useEffect(() => () => { if (stageTimer.current) clearInterval(stageTimer.current); }, []);

  // categoryLabel is used by the manual runCheck() path (step 1)
  const categoryLabel = INDUSTRIES.find((i) => i.id === category)?.label ?? "general consumer products";

  // ── AUTO-RUN when a URL is provided from the landing page ─────────────
  useEffect(() => {
    if (initialUrl && !autoRunFired.current) {
      autoRunFired.current = true;
      autoRunFromUrl(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  async function autoRunFromUrl(url: string) {
    setError(null);
    setPhase("checking");
    setStageIdx(0);
    stageTimer.current = setInterval(
      () => setStageIdx((i) => Math.min(i + 1, CHECK_STAGES.length - 1)),
      7000
    );

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      // Step 1: detect products + company name from the website
      const wpRes = await fetch("/api/website-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const wpData = await wpRes.json();

      const rawProducts: ProductInput[] = (wpData.products ?? []).map(
        (p: { name: string; description?: string; image_url?: string | null; label_text?: string }) => ({
          name: p.name,
          description: p.description ?? "",
          image_url: p.image_url ?? null,
          ...(p.label_text?.trim() ? { label_text: p.label_text } : {}),
        })
      );

      const detectedCompany =
        wpData.company_name ||
        (() => { try { return new URL(normalizedUrl).hostname.replace(/^www\./, ""); } catch { return url; } })();

      // If nothing was detected, fall through to the manual setup steps
      if (rawProducts.length === 0) {
        if (stageTimer.current) clearInterval(stageTimer.current);
        setWebsite(url);
        setCompanyName(detectedCompany);
        setDetectMsg(wpData.message ?? "No products detected. Add them manually below.");
        setHasDetected(true);
        setPhase("setup");
        setStep(1);
        return;
      }

      const products = rawProducts.slice(0, 8);
      const detectedCategory = inferCategory(wpData.description ?? "");

      // Step 2: run compliance check
      const checkRes = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: detectedCompany,
          category: detectedCategory,
          products,
        }),
      });
      const checkData = await checkRes.json();
      if (stageTimer.current) clearInterval(stageTimer.current);
      if (!checkRes.ok) throw new Error(checkData.error ?? "Check failed");

      setCompanyName(detectedCompany);
      setSelected(products);
      setAnalysis(checkData as ComplianceAnalysis);
      setPhase("dashboard");
      onAnalysisSaved?.(detectedCompany, products, checkData as ComplianceAnalysis);
    } catch (err) {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setError(err instanceof Error ? err.message : "Compliance check failed. Please try again.");
      setWebsite(url);
      setPhase("setup");
      setStep(0);
    }
  }

  const isSelected = useCallback(
    (name: string) => selected.some((p) => p.name.toLowerCase() === name.toLowerCase()),
    [selected]
  );

  const detectProducts = useCallback(async () => {
    const url = website.trim();
    if (!url) return;
    setDetecting(true);
    setDetectMsg(null);
    setHasDetected(true);
    try {
      const res = await fetch("/api/website-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.company_name && !companyName) setCompanyName(data.company_name);
      const products: ProductInput[] = (data.products ?? []).map(
        (p: { name: string; description?: string; image_url?: string | null; label_text?: string }) => ({
          name: p.name,
          description: p.description ?? "",
          image_url: p.image_url ?? null,
          ...(p.label_text?.trim() ? { label_text: p.label_text } : {}),
        })
      );
      setDetected(products);
      if (products.length > 0) {
        setSelected((prev) => (prev.length === 0 ? products.slice(0, 3) : prev));
        setDetectMsg(`Found ${products.length} product${products.length === 1 ? "" : "s"}.`);
      } else {
        setDetectMsg(data.message ?? "No products detected. Add them manually below.");
      }
    } catch {
      setDetectMsg("Could not reach the website. Add products manually.");
    } finally {
      setDetecting(false);
    }
  }, [website, companyName]);

  // Auto-detect once when arriving at the products step with a prefilled URL.
  useEffect(() => {
    if (step === 1 && website.trim() && !hasDetected && !detecting) {
      detectProducts();
    }
  }, [step, website, hasDetected, detecting, detectProducts]);

  // If the user chose the upload entry, jump them toward the upload affordance.
  useEffect(() => {
    if (startUpload && step === 1) {
      uploadRef.current?.focus?.();
    }
  }, [startUpload, step]);

  function toggleProduct(p: ProductInput) {
    setSelected((prev) =>
      prev.some((x) => x.name.toLowerCase() === p.name.toLowerCase())
        ? prev.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase())
        : [...prev, p]
    );
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    const product: ProductInput = { name, description: "", image_url: null };
    setDetected((prev) => (prev.some((x) => x.name.toLowerCase() === name.toLowerCase()) ? prev : [...prev, product]));
    setSelected((prev) => (prev.some((x) => x.name.toLowerCase() === name.toLowerCase()) ? prev : [...prev, product]));
    setCustomName("");
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-product", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not read that file.");
        return;
      }
      const product: ProductInput = data.product;
      setDetected((prev) => [product, ...prev]);
      setSelected((prev) => [product, ...prev]);
      setDetectMsg(`Added "${product.name}" from your file.`);
    } catch {
      setError("Could not read that file. Try another.");
    } finally {
      setUploading(false);
    }
  }

  async function runCheck() {
    if (!companyName.trim() || selected.length === 0) return;
    setError(null);
    setPhase("checking");
    setStageIdx(0);
    stageTimer.current = setInterval(
      () => setStageIdx((i) => Math.min(i + 1, CHECK_STAGES.length - 1)),
      7000
    );
    try {
      // Merge batch certifications into each selected product
      const productsWithMeta = batchCertifications.length > 0
        ? selected.map((p) => ({
            ...p,
            certifications: [
              ...new Set([...(p.certifications ?? []), ...batchCertifications]),
            ],
          }))
        : selected;
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          category: categoryLabel,
          products: productsWithMeta,
          target_retailers: targetRetailers.length > 0 ? targetRetailers : undefined,
          label_claims: labelClaims.length > 0 ? labelClaims : undefined,
          market_scope: marketScope !== "global" ? marketScope : undefined,
        }),
      });
      const data = await res.json();
      if (stageTimer.current) clearInterval(stageTimer.current);
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setAnalysis(data as ComplianceAnalysis);
      setPhase("dashboard");
      onAnalysisSaved?.(companyName.trim(), productsWithMeta, data as ComplianceAnalysis);
    } catch (err) {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setError(err instanceof Error ? err.message : "Compliance check failed. Please try again.");
      setPhase("setup");
    }
  }

  // ── DASHBOARD ──────────────────────────────────────────────────────────
  if (phase === "dashboard" && analysis) {
    return (
      <ComplianceDashboard
        analysis={analysis}
        companyName={companyName}
        products={selected}
        category={categoryLabel}
        onBack={onBack}
      />
    );
  }

  // ── CHECKING ───────────────────────────────────────────────────────────
  if (phase === "checking") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="relative w-16 h-16 mx-auto mb-8">
            <span
              className="absolute inset-0 rounded-full border border-[#22c55e]/25 animate-[spin_3s_linear_infinite]"
              style={{ background: "conic-gradient(from 0deg, rgba(34,197,94,0.35), transparent 80deg)" }}
            />
            <span className="relative w-16 h-16 rounded-full flex items-center justify-center">
              <Shield size={22} className="text-[#22c55e]/60" />
            </span>
          </div>
          <h2 className="text-base font-semibold text-white mb-2">Checking global compliance</h2>
          <p className="text-sm text-white/40 font-mono">{CHECK_STAGES[stageIdx]}</p>
          <div className="flex justify-center gap-1.5 mt-6">
            {CHECK_STAGES.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-px w-6 rounded-full transition-colors duration-500",
                  i < stageIdx ? "bg-[#22c55e]/50" : i === stageIdx ? "bg-white/60" : "bg-white/10"
                )}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── SETUP ──────────────────────────────────────────────────────────────
  const canRunCheck = companyName.trim().length > 0 && selected.length > 0;

  const STEPS = ["Category", "Products", "Retailers", "Claims"];
  const TOTAL_STEPS = STEPS.length;

  function goBack() {
    if (step === 0) onBack();
    else setStep((s) => s - 1);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="border-b border-white/[0.07]">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={goBack}
            className="text-white/35 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <Logo className="text-[15px]" />
          <span className="ml-auto text-xs font-mono text-white/30">{step + 1} / {TOTAL_STEPS}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* progress */}
        <div className="flex gap-1.5 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 space-y-1.5">
              <div
                className={cn(
                  "h-1 rounded-full transition-colors",
                  i < step ? "bg-[#22c55e]" : i === step ? "bg-white" : "bg-white/10"
                )}
              />
              <p className={cn("text-[10px] font-mono", i === step ? "text-white font-semibold" : "text-white/30")}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* Step 0: Category */}
        {step === 0 && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1.5">What are you selling?</h1>
            <p className="text-white/40 text-sm mb-8">Pick the category that best fits your products.</p>
            <IndustryPicker value={category} onChange={setCategory} />
            <div className="flex justify-end mt-8 pt-6 border-t border-white/[0.07]">
              <Button
                onClick={() => setStep(1)}
                disabled={!category}
                className="bg-white hover:bg-white/90 text-black font-semibold"
              >
                Continue <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Products */}
        {step === 1 && (
          <div className="space-y-7">
            <div>
              <h1 className="text-2xl font-bold tracking-tight mb-1.5">Which products to check?</h1>
              <p className="text-white/40 text-sm">
                Add your website to auto-detect products, upload a label/photo, or add them by hand.
              </p>
            </div>

            {/* Website detect */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe size={14} className="text-[#22c55e]" />
                <Label className="text-sm font-semibold">Company website</Label>
              </div>
              <div className="flex gap-2">
                <Input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="yourcompany.com"
                  className="bg-white/[0.04] border-white/[0.1] text-white placeholder:text-white/20 h-9 text-sm flex-1"
                  onKeyDown={(e) => e.key === "Enter" && detectProducts()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={detectProducts}
                  disabled={!website.trim() || detecting}
                  className="shrink-0 h-9 border-white/[0.1] text-white/70 hover:text-white hover:border-white/30 bg-transparent"
                >
                  {detecting ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
                  {detecting ? "Scanning..." : "Detect"}
                </Button>
              </div>
              {detectMsg && (
                <p className={cn("text-xs mt-2.5 font-medium", detected.length > 0 ? "text-[#22c55e]" : "text-white/40")}>
                  {detectMsg}
                </p>
              )}
            </div>

            {/* Company name */}
            <div className="space-y-1.5">
              <Label className="text-sm text-white/60">Company name</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Corp"
                className="bg-white/[0.04] border-white/[0.1] text-white placeholder:text-white/20 h-10"
              />
            </div>

            {/* Product cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-white/60">
                  Products <span className="text-red-400">*</span>
                </Label>
                <span className="text-[11px] font-mono text-white/30">{selected.length} selected</span>
              </div>

              {detecting && detected.length === 0 ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[76px] rounded-xl border border-white/[0.06] bg-white/[0.02] animate-pulse" />
                  ))}
                </div>
              ) : detected.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  {detected.map((p, i) => {
                    const on = isSelected(p.name);
                    return (
                      <button
                        key={`${p.name}-${i}`}
                        type="button"
                        onClick={() => toggleProduct(p)}
                        className={cn(
                          "relative flex gap-3 p-2.5 rounded-xl border text-left transition-all",
                          on
                            ? "border-white bg-white/[0.06]"
                            : "border-white/[0.08] bg-white/[0.02] hover:border-white/25"
                        )}
                      >
                        <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-white/[0.06]">
                          <ProductThumb src={p.image_url} name={p.name} />
                        </div>
                        <div className="min-w-0 flex-1 pr-5">
                          <p className="text-sm font-medium text-white/90 truncate">{p.name}</p>
                          {p.description && (
                            <p className="text-[11px] text-white/35 mt-0.5 leading-snug line-clamp-2">{p.description}</p>
                          )}
                          {p.label_text && (
                            <p className="text-[10px] font-mono text-[#22c55e]/70 mt-1">label scanned</p>
                          )}
                        </div>
                        <span
                          className={cn(
                            "absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center transition-all",
                            on ? "bg-white text-black" : "border border-white/20"
                          )}
                        >
                          {on && <Check size={10} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-white/25 py-2">
                  No products yet. Detect from a website, upload a label, or add manually below.
                </p>
              )}

              {/* Add row: manual + upload */}
              <div className="flex gap-2">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustom(); }
                  }}
                  placeholder="Add a product by name and press Enter"
                  className="bg-white/[0.04] border-white/[0.1] text-white placeholder:text-white/20 h-9 text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCustom}
                  disabled={!customName.trim()}
                  className="h-9 border-white/[0.1] text-white/60 hover:text-white hover:border-white/30 bg-transparent shrink-0"
                >
                  <Plus size={14} /> Add
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uploadRef.current?.click()}
                  disabled={uploading}
                  className="h-9 border-white/[0.1] text-white/60 hover:text-white hover:border-white/30 bg-transparent shrink-0"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                  Label
                </Button>
                <input
                  ref={uploadRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.csv,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            {/* Selected chips */}
            {selected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selected.map((p) => (
                  <span
                    key={p.name}
                    className="inline-flex items-center gap-1.5 text-xs bg-white/[0.06] border border-white/[0.1] rounded-full pl-3 pr-1.5 py-1 text-white/80"
                  >
                    {p.name}
                    <button
                      onClick={() => toggleProduct(p)}
                      className="w-4 h-4 rounded-full hover:bg-white/15 flex items-center justify-center"
                      aria-label={`Remove ${p.name}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!canRunCheck}
                className="bg-white hover:bg-white/90 text-black font-semibold"
              >
                Continue <ArrowRight size={15} />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Target retailers */}
        {step === 2 && (
          <RetailersStep
            selected={targetRetailers}
            onChange={setTargetRetailers}
            onContinue={() => setStep(3)}
          />
        )}

        {/* Step 3: Claims & market scope */}
        {step === 3 && (
          <ClaimsStep
            claims={labelClaims}
            onClaimsChange={setLabelClaims}
            certifications={batchCertifications}
            onCertificationsChange={setBatchCertifications}
            marketScope={marketScope}
            onScopeChange={setMarketScope}
            onRun={runCheck}
            canRun={canRunCheck}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 2: Target retailers ─────────────────────────────────────────────────

const RETAILERS = [
  { id: "whole_foods", label: "Whole Foods", emoji: "🌿" },
  { id: "walmart", label: "Walmart", emoji: "🛒" },
  { id: "target", label: "Target", emoji: "🎯" },
  { id: "costco", label: "Costco", emoji: "📦" },
  { id: "amazon", label: "Amazon", emoji: "🛍️" },
  { id: "sprouts", label: "Sprouts", emoji: "🥦" },
  { id: "kroger", label: "Kroger", emoji: "🏪" },
  { id: "cvs", label: "CVS", emoji: "💊" },
  { id: "gnc", label: "GNC", emoji: "💪" },
  { id: "vitamin_shoppe", label: "Vitamin Shoppe", emoji: "🧴" },
  { id: "heb", label: "H-E-B", emoji: "🛒" },
  { id: "wegmans", label: "Wegmans", emoji: "🧺" },
];

function RetailersStep({
  selected,
  onChange,
  onContinue,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  onContinue: () => void;
}) {
  function toggle(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1.5">Target retail channels</h1>
        <p className="text-white/40 text-sm">
          Select the retailers you want to sell through. We&apos;ll check their specific compliance
          requirements and policies. <span className="text-white/25">(optional — skip to check all)</span>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {RETAILERS.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id)}
              className={cn(
                "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-left text-sm font-medium transition-all",
                on
                  ? "border-white bg-white/[0.08] text-white"
                  : "border-white/[0.08] bg-white/[0.02] text-white/55 hover:text-white/85 hover:border-white/20"
              )}
            >
              <span className="text-base leading-none">{r.emoji}</span>
              <span className="truncate">{r.label}</span>
              {on && (
                <Check size={12} className="ml-auto shrink-0 text-[#22c55e]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-white/[0.07]">
        <button
          type="button"
          onClick={onContinue}
          className="text-sm text-white/40 hover:text-white/70 transition-colors"
        >
          Skip this step
        </button>
        <Button
          onClick={onContinue}
          className="bg-white hover:bg-white/90 text-black font-semibold"
        >
          Continue <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Claims & market scope ────────────────────────────────────────────

const CLAIM_OPTIONS = [
  { id: "high_protein", label: "High Protein" },
  { id: "organic", label: "Organic" },
  { id: "non_gmo", label: "Non-GMO" },
  { id: "gluten_free", label: "Gluten Free" },
  { id: "keto", label: "Keto" },
  { id: "zero_sugar", label: "Zero Sugar" },
  { id: "low_calorie", label: "Low Calorie" },
  { id: "vegan", label: "Vegan" },
  { id: "dairy_free", label: "Dairy Free" },
  { id: "natural", label: "Natural" },
  { id: "no_artificial", label: "No Artificial Ingredients" },
  { id: "sport_performance", label: "Sport Performance" },
];

const SCOPE_OPTIONS = [
  { id: "us_only", label: "United States only", detail: "Check federal + state rules" },
  { id: "us_eu", label: "US + European Union", detail: "Adds EU food law, novel foods" },
  { id: "global", label: "Global", detail: "All major markets worldwide" },
];

const CERTIFICATION_OPTIONS = [
  { id: "non_gmo", label: "Non-GMO Project Verified" },
  { id: "usda_organic", label: "USDA Organic" },
  { id: "kosher", label: "Kosher" },
  { id: "halal", label: "Halal" },
  { id: "gluten_free_cert", label: "Gluten-Free Certified" },
  { id: "sqf_gfsi", label: "SQF / GFSI" },
  { id: "b_corp", label: "B Corp" },
  { id: "rainforest_alliance", label: "Rainforest Alliance" },
  { id: "not_sure", label: "Not Sure" },
];

function ClaimsStep({
  claims,
  onClaimsChange,
  certifications,
  onCertificationsChange,
  marketScope,
  onScopeChange,
  onRun,
  canRun,
  error,
}: {
  claims: string[];
  onClaimsChange: (v: string[]) => void;
  certifications: string[];
  onCertificationsChange: (v: string[]) => void;
  marketScope: string;
  onScopeChange: (v: string) => void;
  onRun: () => void;
  canRun: boolean;
  error: string | null;
}) {
  function toggleClaim(id: string) {
    onClaimsChange(
      claims.includes(id) ? claims.filter((x) => x !== id) : [...claims, id]
    );
  }

  function toggleCert(label: string) {
    if (label === "Not Sure") {
      // Selecting "Not Sure" is mutually exclusive with real certs
      onCertificationsChange(certifications.includes("Not Sure") ? [] : ["Not Sure"]);
    } else {
      // Selecting a real cert removes "Not Sure" if present
      const without = certifications.filter((x) => x !== "Not Sure");
      onCertificationsChange(
        without.includes(label)
          ? without.filter((x) => x !== label)
          : [...without, label]
      );
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1.5">Label claims &amp; market scope</h1>
        <p className="text-white/40 text-sm">
          Tell us what claims appear on your label and how far you want to sell.
          <span className="text-white/25"> (optional — both can be skipped)</span>
        </p>
      </div>

      {/* Claims */}
      <div>
        <p className="text-sm font-semibold text-white/70 mb-3">
          What claims are on your label?
        </p>
        <div className="flex flex-wrap gap-2">
          {CLAIM_OPTIONS.map((c) => {
            const on = claims.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleClaim(c.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all",
                  on
                    ? "border-white bg-white/[0.1] text-white"
                    : "border-white/[0.1] text-white/45 hover:text-white/75 hover:border-white/25"
                )}
              >
                {on && <span className="mr-1 text-[#22c55e]">✓</span>}
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Certifications */}
      <div>
        <p className="text-sm font-semibold text-white/70 mb-1">
          Does your product hold any certifications?
        </p>
        <p className="text-[11px] text-white/30 mb-3">
          These are checked against retailer requirements and international market rules.
        </p>
        <div className="flex flex-wrap gap-2">
          {CERTIFICATION_OPTIONS.map((c) => {
            const on = certifications.includes(c.label);
            const isNotSure = c.id === "not_sure";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCert(c.label)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all",
                  isNotSure
                    ? on
                      ? "border-white/40 bg-white/[0.07] text-white/70"
                      : "border-dashed border-white/[0.15] text-white/30 hover:text-white/55 hover:border-white/30"
                    : on
                      ? "border-green-400/60 bg-green-400/10 text-green-300"
                      : "border-white/[0.1] text-white/45 hover:text-white/75 hover:border-white/25"
                )}
              >
                {on && !isNotSure && <span className="mr-1 text-[#22c55e]">✓</span>}
                {on && isNotSure && <span className="mr-1 text-white/50">?</span>}
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Market scope */}
      <div>
        <p className="text-sm font-semibold text-white/70 mb-3">
          Where are you planning to sell?
        </p>
        <div className="space-y-2">
          {SCOPE_OPTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onScopeChange(s.id)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                marketScope === s.id
                  ? "border-white bg-white/[0.06] text-white"
                  : "border-white/[0.08] bg-white/[0.02] text-white/55 hover:text-white/80 hover:border-white/20"
              )}
            >
              <div>
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-[11px] text-white/30 mt-0.5">{s.detail}</p>
              </div>
              <div
                className={cn(
                  "w-4 h-4 rounded-full border-2 shrink-0 transition-all",
                  marketScope === s.id
                    ? "border-white bg-white"
                    : "border-white/25"
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
          {error}
        </p>
      )}

      <Button
        onClick={onRun}
        disabled={!canRun}
        className="w-full bg-white hover:bg-white/90 text-black font-semibold h-11 rounded-xl"
      >
        <Shield size={15} /> Run compliance check
      </Button>
    </div>
  );
}
