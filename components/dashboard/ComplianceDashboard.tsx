"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Logo } from "@/components/Logo";
import { WorldMap } from "./WorldMap";
import { cn } from "@/lib/utils";
import { severityConfig } from "@/lib/severity";
import { MARKET_BY_ISO3 } from "@/lib/markets";
import type {
  Allergens,
  ComplianceAnalysis,
  CountryVerdict,
  MarketStatus,
  NutritionFacts,
  OverallStatus,
  ProductFinding,
  ProductInput,
  RetailerVerdict,
  Severity,
  StateVerdict,
} from "@/types";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Store,
  Globe,
  Package,
  MapPin,
  Flag,
  ListChecks,
  Plus,
  UploadCloud,
  Loader2,
  X,
  Check,
  Clock,
  AlertCircle,
  Info,
  FlaskConical,
  RefreshCw,
  BookmarkPlus,
  Radio,
  ChevronDown,
} from "lucide-react";

// ── Status / overall meta ─────────────────────────────────────────────────────

const STATUS_META: Record<
  MarketStatus,
  { label: string; color: string; chip: string; Icon: typeof CheckCircle2 }
> = {
  allowed: { label: "Can sell", color: "#22c55e", chip: "bg-green-500/10 border-green-500/20", Icon: CheckCircle2 },
  review: { label: "Needs review", color: "#eab308", chip: "bg-yellow-500/10 border-yellow-500/20", Icon: AlertTriangle },
  prohibited: { label: "Cannot sell", color: "#ef4444", chip: "bg-red-500/10 border-red-500/20", Icon: XCircle },
};

const OVERALL_META: Record<OverallStatus, { label: string; color: string }> = {
  clear: { label: "CLEAR TO SELL", color: "#22c55e" },
  review: { label: "NEEDS REVIEW", color: "#eab308" },
  blocked: { label: "BLOCKED IN MARKETS", color: "#ef4444" },
};

import { ResearchPanel } from "./ResearchPanel";
import { USStateMap } from "./USStateMap";
import { LiveMonitorPanel } from "./LiveMonitorPanel";
import { StateRecallHotspots } from "./StateRecallHotspots";

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = "products" | "markets" | "retailers" | "todo" | "research" | "live";

const TABS: { id: Tab; label: string; Icon: typeof Globe; badge?: boolean }[] = [
  { id: "products", label: "Products", Icon: Package },
  { id: "markets", label: "Markets", Icon: Globe },
  { id: "retailers", label: "Retailers", Icon: Store },
  { id: "todo", label: "Todo", Icon: ListChecks },
  { id: "research", label: "Reg Research", Icon: FlaskConical },
  { id: "live", label: "Live", Icon: Radio, badge: true },
];

// ── Ingredient parsing ────────────────────────────────────────────────────────

interface ParsedIngredient {
  name: string;
  flagged: boolean;
  findingIndex: number | null;
}

function tokenizeIngredients(text: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[") {
      depth++;
      current += char;
    } else if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
      current += char;
    } else if (char === "," && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function parseIngredients(
  labelText: string | undefined,
  findings: ProductFinding[]
): ParsedIngredient[] {
  if (!labelText) return [];

  // Find ALL occurrences of "Ingredients" as a standalone section header
  // (start of line, optionally preceded by whitespace), not embedded in phrases
  // like "Nutrition & Ingredients". Use the LAST standalone match so we skip
  // any marketing headers and land on the actual ingredient list section.
  const matches = [...labelText.matchAll(/(?:^|\n)[ \t]*ingredients[ \t]*[\n:]/gi)];
  if (!matches.length) return [];

  // Prefer the last match since the actual ingredient section comes after headers
  const lastMatch = matches[matches.length - 1];
  const matchStart = lastMatch.index ?? 0;
  // Skip past the matched "Ingredients\n" or "Ingredients:" prefix
  const start = matchStart + lastMatch[0].length;
  const rest = labelText.slice(start);

  // Stop at double newline, "Contains", or "May Contain" section header
  const endMatch = rest.match(/\n\n|(?:^|\n)[ \t]*(?:may\s+contain|contains)[ \t]*[\n:]/im);
  const ingredientText = endMatch ? rest.slice(0, endMatch.index) : rest;
  const tokens = tokenizeIngredients(ingredientText.trim().replace(/\.\s*$/, ""));

  return tokens
    .map((name): ParsedIngredient => {
      const trimmed = name.trim();
      const core = trimmed.split(/[([]/)[0].trim().toLowerCase();
      const fi = findings.findIndex((f) => {
        const haystack = `${f.issue} ${f.action} ${f.regulation}`.toLowerCase();
        return core.length > 2 && haystack.includes(core);
      });
      return { name: trimmed, flagged: fi >= 0, findingIndex: fi >= 0 ? fi : null };
    })
    .filter((i) => i.name.length > 0);
}

// ── Nutrition & allergen parsing ──────────────────────────────────────────────

/**
 * Detects the "widget format" where a numeric value appears on one line and its
 * nutrient label on the next line (common in product page marketing widgets):
 *
 *   20g          →  Protein: 20g
 *   PROTEIN
 *   150          →  Calories: 150
 *   CALORIES
 *   0g           →  Total Sugars: 0g
 *   TOTAL SUGARS
 *
 * Returns the normalised text so standard label regexes can parse it reliably.
 */
function normalizeWidgetFormat(text: string): string {
  // Map of all the label variants we recognise in the widget format
  const WIDGET_LABELS: Array<{ pattern: RegExp; canonical: string }> = [
    { pattern: /^calories?$/i, canonical: "Calories" },
    { pattern: /^protein$/i, canonical: "Protein" },
    { pattern: /^total\s+sugars?$/i, canonical: "Total Sugars" },
    { pattern: /^sugars?$/i, canonical: "Total Sugars" },
    { pattern: /^carbs?$|^total\s+carbs?$|^total\s+carbohydrates?$|^carbohydrates?$/i, canonical: "Total Carbohydrates" },
    { pattern: /^fats?$|^total\s+fats?$/i, canonical: "Total Fat" },
    { pattern: /^sodium$/i, canonical: "Sodium" },
    { pattern: /^fiber$|^dietary\s+fiber$/i, canonical: "Dietary Fiber" },
  ];

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Check if this line looks like a numeric value (e.g. "20g", "150", "3.5g", "0")
    const valueMatch = line.match(/^(\d+(?:\.\d+)?)\s*(g|mg|mcg|%|kcal|cal)?$/i);

    if (valueMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const labelHit = WIDGET_LABELS.find((l) => l.pattern.test(nextLine));

      if (labelHit) {
        // Rewrite as "Label: Xunit" so normal regexes can match it
        const unit = valueMatch[2] ?? "";
        out.push(`${labelHit.canonical}: ${valueMatch[1]}${unit}`);
        i += 2; // consume both the value line and the label line
        continue;
      }
    }

    out.push(lines[i]);
    i++;
  }

  return out.join("\n");
}

function parseNutritionFacts(product: ProductInput): NutritionFacts | null {
  if (product.nutrition_facts && Object.keys(product.nutrition_facts).length > 0) {
    return product.nutrition_facts;
  }
  const rawText = product.label_text;
  if (!rawText) return null;

  // Normalise widget/marketing format before running regexes
  const text = normalizeWidgetFormat(rawText);

  const facts: NutritionFacts = {};

  const calMatch =
    text.match(/calories\s*[:\s]\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:calories|kcal)/i);
  if (calMatch) facts.calories = calMatch[1];

  const protMatch =
    text.match(/protein\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*g\s+protein/i);
  if (protMatch) facts.protein = `${protMatch[1]}g`;

  const sugarMatch =
    text.match(/total\s+sugars?\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i) ||
    text.match(/sugars?\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i);
  if (sugarMatch) facts.total_sugars = `${sugarMatch[1]}g`;

  const carbMatch =
    text.match(/total\s+carbohydrates?\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i) ||
    text.match(/carbohydrates?\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i) ||
    text.match(/total\s+carbs?\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i);
  if (carbMatch) facts.carbs = `${carbMatch[1]}g`;

  const fatMatch =
    text.match(/total\s+fat\s*[:\s]\s*(\d+(?:\.\d+)?)\s*g/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*g\s+(?:total\s+)?fat/i);
  if (fatMatch) facts.fats = `${fatMatch[1]}g`;

  return Object.keys(facts).length > 0 ? facts : null;
}

// ── Full nutrition panel (all micronutrients + % DV) ─────────────────────────

interface NutritionRow {
  name: string;
  value: string;
  dv?: string;
  level: number; // 0=top-level, 1=sub (Saturated Fat etc), 2=sub-sub (Added Sugars)
}

interface FullNutritionPanel {
  serving_size?: string;
  servings_per_container?: string;
  calories?: string;
  rows: NutritionRow[];
}

/**
 * Parses the full nutrition facts section out of label_text, including every
 * micronutrient row, % DV, serving size, and servings per container.
 * Returns null when the label_text doesn't contain structured nutrition data.
 */
function parseFullNutritionPanel(labelText: string): FullNutritionPanel | null {
  if (!labelText?.trim()) return null;

  // Extract only up to the "Ingredients" header
  const ingIdx = labelText.search(/(?:^|\n)\s*ingredients?\s*[\n\r:]/i);
  const section = ingIdx > 0 ? labelText.slice(0, ingIdx) : labelText.slice(0, 2000);

  const panel: FullNutritionPanel = { rows: [] };

  const servingM = section.match(/serving size[:\s]+([^\n]+)/i);
  if (servingM) panel.serving_size = servingM[1].trim();

  const servingsM = section.match(/servings?\s+per\s+container[:\s]+([^\n]+)/i);
  if (servingsM) panel.servings_per_container = servingsM[1].trim();

  const calM = section.match(/(?:^|\n)\s*calories\s*[:\s]+(\d+)/im);
  if (calM) panel.calories = calM[1];

  const SKIP = /^(serving size|servings? per container|amount per serving|nutrition facts|calories|per serving)\b/i;

  for (const raw of section.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || SKIP.test(trimmed)) continue;

    // Indent level: 2 spaces = level 1, 4+ spaces = level 2
    const spaces = raw.search(/\S/);
    const level = spaces < 0 ? 0 : Math.min(2, Math.floor(spaces / 2));

    // Pattern A: "Name: value[unit]  [N%]"
    const mA = trimmed.match(/^([^:]+):\s*(<?\d[\d.,]*\s*(?:g|mg|mcg)?)\s*(\d+\s*%)?/i);
    if (mA) {
      panel.rows.push({
        name: mA[1].trim(),
        value: mA[2].trim(),
        dv: mA[3]?.replace(/\s+/, ""),
        level,
      });
      continue;
    }

    // Pattern B: "Name value[unit]  [N%]" (no colon) — e.g. "Trans Fat 0g"
    const mB = trimmed.match(/^([A-Za-z][A-Za-z\s()]+?)\s+(<?\d[\d.,]*\s*(?:g|mg|mcg)?)\s*(\d+\s*%)?$/i);
    if (mB) {
      panel.rows.push({
        name: mB[1].trim(),
        value: mB[2].trim(),
        dv: mB[3]?.replace(/\s+/, ""),
        level,
      });
      continue;
    }

    // Pattern C: "Includes Xg Added Sugars  Y%" (number embedded in name)
    const mC = trimmed.match(/^(includes?\s+<?\d[\d.]*\s*(?:g|mg)?\s+\w[^%\d]*)(\d+%)?/i);
    if (mC) {
      panel.rows.push({ name: mC[1].trim(), value: "", dv: mC[2]?.trim(), level: 2 });
    }
  }

  // Only return when we have real micronutrient data beyond just macros
  const microRows = panel.rows.filter((r) =>
    /saturated|cholesterol|sodium|dietary|fiber|added|sugar alcohol|vitamin|calcium|iron|potassium|trans fat/i.test(r.name)
  );
  return panel.calories && microRows.length >= 2 ? panel : null;
}

function parseAllergens(product: ProductInput): Allergens | null {
  if (product.allergens && (product.allergens.contains?.length || product.allergens.may_contain?.length)) {
    return product.allergens;
  }
  const text = product.label_text;
  if (!text) return null;

  const allergens: Allergens = {};

  const containsMatch = text.match(/(?:^|\n)\s*contains[:\s]+([^\n]+)/im);
  if (containsMatch) {
    allergens.contains = containsMatch[1]
      .split(/[,;]/)
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
  }

  const mayMatch = text.match(/may\s+contain[:\s]+([^\n]+)/im);
  if (mayMatch) {
    allergens.may_contain = mayMatch[1]
      .split(/[,;]/)
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
  }

  return allergens.contains || allergens.may_contain ? allergens : null;
}

// ── ProductImage ──────────────────────────────────────────────────────────────

function ProductImage({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/[0.06] to-white/[0.01]">
        <Package size={22} className="text-white/20" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={name}
      fill
      sizes="120px"
      className="object-cover"
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}

// ── ComplianceDashboard ───────────────────────────────────────────────────────

export function ComplianceDashboard({
  analysis: initialAnalysis,
  companyName,
  products: initialProducts,
  category: categoryProp,
  onBack,
}: {
  analysis: ComplianceAnalysis;
  companyName: string;
  products: ProductInput[];
  category?: string;
  onBack: () => void;
}) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [products, setProducts] = useState(initialProducts);

  // Add-product modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductDesc, setNewProductDesc] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [uploadingLabel, setUploadingLabel] = useState(false);
  const [pendingLabelProduct, setPendingLabelProduct] = useState<ProductInput | null>(null);
  const addUploadRef = useRef<HTMLInputElement>(null);

  const [selectedIso3, setSelectedIso3] = useState<string | null>(null);
  const [selectedStateCode, setSelectedStateCode] = useState<string | null>(null);
  const mapPanelRef = useRef<HTMLDivElement>(null);
  const [mapPanelHeight, setMapPanelHeight] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("products");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [inspectedProduct, setInspectedProduct] = useState<string | null>(
    products[0]?.name ?? null
  );
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});
  const [retailerVerdicts, setRetailerVerdicts] = useState(analysis.retailer_verdicts);
  const [reloadingRetailers, setReloadingRetailers] = useState(false);
  const [recheckingProduct, setRecheckingProduct] = useState<string | null>(null);
  // Stores { productName, message } for the last failed re-check
  const [recheckFailed, setRecheckFailed] = useState<{ productName: string; message: string } | null>(null);

  // Per-product data cache: populated on first click of each product pill
  const [productDataCache, setProductDataCache] = useState<
    Record<string, {
      country_verdicts: CountryVerdict[];
      retailer_verdicts: RetailerVerdict[];
      state_verdicts: StateVerdict[];
    }>
  >({});
  const [loadingProductData, setLoadingProductData] = useState<string | null>(null);

  async function handleLabelUpload(file: File) {
    setUploadingLabel(true);
    setAddError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-product", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Could not read that file.");
        return;
      }
      const product: ProductInput = data.product;
      setPendingLabelProduct(product);
      setNewProductName(product.name);
      setNewProductDesc(product.description ?? "");
    } catch {
      setAddError("Could not read that file. Try another.");
    } finally {
      setUploadingLabel(false);
    }
  }

  async function addAndRunCheck() {
    const name = newProductName.trim();
    if (!name) return;
    setAddingProduct(true);
    setAddError(null);
    try {
      const newProduct: ProductInput = pendingLabelProduct?.name.toLowerCase() === name.toLowerCase()
        ? pendingLabelProduct
        : { name, description: newProductDesc.trim(), image_url: null };

      const allProducts = [...products, newProduct];

      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          category: categoryProp || "",
          products: allProducts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed");

      setAnalysis(data as ComplianceAnalysis);
      setProducts(allProducts);
      setRetailerVerdicts((data as ComplianceAnalysis).retailer_verdicts);
      setInspectedProduct(name);
      setActiveTab("products");
      setAddModalOpen(false);
      setNewProductName("");
      setNewProductDesc("");
      setPendingLabelProduct(null);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Compliance check failed.");
    } finally {
      setAddingProduct(false);
    }
  }

  async function reloadRetailers() {
    setReloadingRetailers(true);
    try {
      const res = await fetch("/api/check-retailers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: categoryProp || "", products }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.retailer_verdicts?.length) {
          setRetailerVerdicts(data.retailer_verdicts);
        }
      }
    } finally {
      setReloadingRetailers(false);
    }
  }

  /**
   * Fetches product-specific market and retailer data when a product pill is
   * selected. Results are cached so subsequent clicks are instant.
   */
  async function fetchProductData(productName: string) {
    const productInput = products.find((p) => p.name === productName);
    if (!productInput) return;

    setLoadingProductData(productName);
    try {
      const [marketsRes, retailersRes] = await Promise.all([
        fetch("/api/check-markets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: categoryProp || "", products: [productInput] }),
        }),
        fetch("/api/check-retailers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: categoryProp || "", products: [productInput] }),
        }),
      ]);

      const [marketsData, retailersData] = await Promise.all([
        marketsRes.ok ? marketsRes.json() : null,
        retailersRes.ok ? retailersRes.json() : null,
      ]);

      setProductDataCache((prev) => ({
        ...prev,
        [productName]: {
          country_verdicts: marketsData?.country_verdicts ?? analysis.country_verdicts,
          retailer_verdicts: retailersData?.retailer_verdicts ?? retailerVerdicts,
          state_verdicts: marketsData?.state_verdicts ?? analysis.state_verdicts,
        },
      }));
    } catch {
      // On failure leave the cache empty so aggregate data is shown
    } finally {
      setLoadingProductData((cur) => (cur === productName ? null : cur));
    }
  }

  /**
   * Called when a user saves a pasted label in ProductInspector.
   * Updates the label override AND re-runs the full compliance check so
   * findings, state verdicts, retailer verdicts, and action plan all reflect
   * the new ingredient data.
   */
  async function handleLabelRecheck(productName: string, labelText: string) {
    setLabelOverrides((prev) => ({ ...prev, [productName]: labelText }));
    setRecheckingProduct(productName);
    setRecheckFailed(null);
    try {
      const updatedProducts = products.map((p) =>
        p.name.toLowerCase() === productName.toLowerCase()
          ? { ...p, label_text: labelText }
          : p
      );
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          category: categoryProp ?? "",
          products: updatedProducts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Re-check failed");
      setAnalysis(data as ComplianceAnalysis);
      setProducts(updatedProducts);
      setRetailerVerdicts((data as ComplianceAnalysis).retailer_verdicts);
    } catch (err) {
      setRecheckFailed({
        productName,
        message: err instanceof Error ? err.message : "Re-check failed. Try again.",
      });
    } finally {
      setRecheckingProduct(null);
    }
  }

  // Auto-refresh if cached data is in the old single-reason format (missing new fields)
  useEffect(() => {
    const isLegacy = analysis.retailer_verdicts.every(
      (v) => !v.requirements?.length && !v.geographic_notes?.length
    );
    if (isLegacy) {
      reloadRetailers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab !== "markets") return;
    const el = mapPanelRef.current;
    if (!el) return;

    const sync = () => setMapPanelHeight(el.getBoundingClientRect().height);
    sync();

    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [activeTab, analysis.country_verdicts.length]);

  const overall = OVERALL_META[analysis.overall_status] ?? OVERALL_META.review;

  // When a product is selected, use the per-product cached data if available.
  // While the fetch is in flight, fall back to the aggregate data.
  const activeProductCache = selectedProduct ? productDataCache[selectedProduct] : null;

  const filteredCountryVerdicts = activeProductCache
    ? activeProductCache.country_verdicts
    : selectedProduct
    ? analysis.country_verdicts.filter(
        (v) => !v.products?.length || v.products.some((n) => n.toLowerCase() === selectedProduct.toLowerCase())
      )
    : analysis.country_verdicts;

  const filteredRetailerVerdicts = activeProductCache
    ? activeProductCache.retailer_verdicts
    : selectedProduct
    ? retailerVerdicts.filter(
        (v) => !v.products?.length || v.products.some((n) => n.toLowerCase() === selectedProduct.toLowerCase())
      )
    : retailerVerdicts;

  const filteredStateVerdicts = activeProductCache
    ? activeProductCache.state_verdicts
    : selectedProduct
    ? analysis.state_verdicts.filter(
        (v) => !v.products?.length || v.products.some((p) => p.toLowerCase() === selectedProduct.toLowerCase())
      )
    : analysis.state_verdicts;

  const isLoadingProductData = selectedProduct !== null && loadingProductData === selectedProduct;

  const counts = filteredCountryVerdicts.reduce(
    (acc, v) => {
      acc[v.status] += 1;
      return acc;
    },
    { allowed: 0, review: 0, prohibited: 0 } as Record<MarketStatus, number>
  );

  const selected = selectedIso3
    ? filteredCountryVerdicts.find(
        (v) => v.iso3.toUpperCase() === selectedIso3.toUpperCase()
      )
    : null;

  const productFindingsAll = analysis.product_findings;

  function handleProductPill(name: string | null) {
    setSelectedProduct(name);
    if (name !== null) {
      setInspectedProduct(name);
      // Kick off per-product fetch if we don't have cached data yet
      if (!productDataCache[name] && loadingProductData !== name) {
        fetchProductData(name);
      }
    }
  }

  // Top 3 action plan items for sidebar quick peek
  const topActions = analysis.action_plan.slice(0, 3);

  const todoCount =
    analysis.action_plan.length +
    analysis.product_findings.filter(
      (f) => f.severity === "critical" || f.severity === "high"
    ).length +
    retailerVerdicts.reduce((sum, r) => sum + (r.action_steps?.length ?? 0), 0);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-black text-white">
      {/* ── Sticky header ── */}
      <div className="shrink-0 z-20 bg-black/95 backdrop-blur border-b border-white/[0.07]">
        {/* Top bar */}
        <div className="px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-white/35 hover:text-white transition-colors text-sm shrink-0"
            >
              <ArrowLeft size={14} />
            </button>
            <Logo className="text-[15px]" />
            <span className="text-white/20 text-sm">/</span>
            <span className="text-sm font-medium text-white/80 truncate">{companyName}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
              style={{ color: overall.color, backgroundColor: `${overall.color}1f` }}
            >
              {overall.label}
            </span>
            <span className="text-sm font-bold tabular-nums" style={{ color: overall.color }}>
              {analysis.overall_score}
              <span className="text-[10px] text-white/30 font-mono ml-0.5">risk</span>
            </span>
            <button
              onClick={() => {
                setNewProductName("");
                setNewProductDesc("");
                setPendingLabelProduct(null);
                setAddError(null);
                setAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-white/70 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] hover:border-white/[0.2] transition-all"
            >
              <Plus size={12} /> Add product
            </button>
          </div>
        </div>

        {/* Product selector */}
        <div className="px-6 py-2.5 border-t border-white/[0.05] flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[10px] font-mono text-white/25 uppercase tracking-wider shrink-0 mr-1">
            Product
          </span>
          <button
            onClick={() => handleProductPill(null)}
            className={cn(
              "shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full border transition-colors",
              selectedProduct === null
                ? "border-white/25 text-white bg-white/[0.08]"
                : "border-white/[0.08] text-white/45 hover:text-white/80 hover:border-white/15"
            )}
          >
            All products
          </button>
          {products.map((p) => {
            const findings = productFindingsAll.filter(
              (f) => f.product.toLowerCase() === p.name.toLowerCase()
            );
            const isSelected = selectedProduct === p.name;
            return (
              <button
                key={p.name}
                onClick={() => handleProductPill(isSelected ? null : p.name)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full border transition-colors",
                  isSelected
                    ? "border-white/25 text-white bg-white/[0.08]"
                    : "border-white/[0.08] text-white/45 hover:text-white/80 hover:border-white/15"
                )}
              >
                {p.image_url ? (
                  <span className="relative w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      fill
                      sizes="14px"
                      className="object-cover"
                      unoptimized
                    />
                  </span>
                ) : (
                  <Package size={11} className="shrink-0 opacity-50" />
                )}
                {p.name}
                {findings.length > 0 && (
                  <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{
                      backgroundColor: `${severityColor(
                        findings.reduce(
                          (acc, f) => Math.min(acc, severityConfig(f.severity).rank),
                          3
                        )
                      )}30`,
                      color: severityColor(
                        findings.reduce(
                          (acc, f) => Math.min(acc, severityConfig(f.severity).rank),
                          3
                        )
                      ),
                    }}
                  >
                    {findings.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body: Sidebar + Main ── */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <nav className="w-52 shrink-0 border-r border-white/[0.07] flex flex-col bg-black">
          <div className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors text-left",
                  activeTab === tab.id
                    ? "bg-white/[0.08] text-white"
                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
                )}
              >
                <tab.Icon size={14} className="shrink-0" />
                {tab.label}
                {tab.id === "todo" && todoCount > 0 && (
                  <span className="ml-auto text-[10px] font-mono text-white/30 tabular-nums">
                    {todoCount}
                  </span>
                )}
                {tab.badge && tab.id !== "todo" && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Quick actions peek */}
          {topActions.length > 0 && (
            <div className="shrink-0 border-t border-white/[0.07] p-3">
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-2.5 px-1">
                Top Actions
              </p>
              <div className="space-y-1.5">
                {topActions.map((step, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveTab("todo")}
                    className="w-full flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left group"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400/60 mt-1.5 shrink-0" />
                    <p className="text-[11px] text-white/45 group-hover:text-white/70 leading-snug line-clamp-2 transition-colors">
                      {step.action}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Main content */}
        <main
          className={cn(
            "flex-1 min-h-0",
            activeTab === "research" ? "overflow-hidden" : "overflow-y-auto"
          )}
        >
          {/* ── REG RESEARCH TAB — always mounted so streaming survives tab switches ── */}
          <div className={cn("h-full min-h-0", activeTab !== "research" && "hidden")}>
            <ResearchPanel
              companyName={companyName}
              markets={analysis.country_verdicts
                .filter((v) => v.status === "allowed")
                .map((v) => v.iso3)}
            />
          </div>

          {/* ── LIVE TAB — always mounted so scanning never stops on tab switch ── */}
          <div className={cn("max-w-5xl mx-auto px-6 py-8", activeTab !== "live" && "hidden")}>
            <LiveMonitorPanel
              companyName={companyName}
              industry="food"
              products={products.map((p) => p.name)}
            />
          </div>

          <div className={cn("max-w-5xl mx-auto px-6 py-8", (activeTab === "research" || activeTab === "live") && "hidden")}>
            {/* ── PRODUCTS TAB ── */}
            {activeTab === "products" && (
              <div className="space-y-6">
                <ProductInspector
                  products={products}
                  findings={analysis.product_findings}
                  inspectedProduct={inspectedProduct}
                  onInspect={setInspectedProduct}
                  companyName={companyName}
                  labelOverrides={labelOverrides}
                  onLabelOverride={(name, text) =>
                    setLabelOverrides((prev) => ({ ...prev, [name]: text }))
                  }
                  onLabelRecheck={handleLabelRecheck}
                  recheckingProduct={recheckingProduct}
                  recheckFailed={recheckFailed}
                  onAddProduct={() => {
                    setNewProductName("");
                    setNewProductDesc("");
                    setPendingLabelProduct(null);
                    setAddError(null);
                    setAddModalOpen(true);
                  }}
                  onProductMetaUpdate={(name, meta) => {
                    setProducts((prev) =>
                      prev.map((p) => (p.name === name ? { ...p, ...meta } : p))
                    );
                  }}
                />
              </div>
            )}

            {/* ── MARKETS TAB ── */}
            {activeTab === "markets" && (
              <div className="space-y-8">
                {isLoadingProductData && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-white/[0.07] bg-white/[0.02] text-white/45 text-xs">
                    <Loader2 size={13} className="animate-spin shrink-0" />
                    Fetching {selectedProduct}-specific market data…
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <StatCard color="#22c55e" value={counts.allowed} label="Markets clear" />
                  <StatCard color="#eab308" value={counts.review} label="Need review" />
                  <StatCard color="#ef4444" value={counts.prohibited} label="Blocked" />
                </div>

                <div>
                  <SectionTitle Icon={Globe} title="Global market map" />
                  <div className="grid lg:grid-cols-5 gap-6 items-start">
                    <div
                      ref={mapPanelRef}
                      className="lg:col-span-3 rounded-2xl border border-white/[0.07] bg-white/[0.015] p-4"
                    >
                      <div className="flex items-center justify-end mb-3 px-1">
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          <Legend color="#22c55e" label={`${counts.allowed} allowed`} />
                          <Legend color="#eab308" label={`${counts.review} review`} />
                          <Legend color="#ef4444" label={`${counts.prohibited} blocked`} />
                        </div>
                      </div>
                      <WorldMap
                        verdicts={filteredCountryVerdicts}
                        selectedIso3={selectedIso3}
                        onSelect={setSelectedIso3}
                      />
                    </div>

                    <div
                      className="lg:col-span-2 rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 flex flex-col min-h-0 overflow-hidden"
                      style={
                        mapPanelHeight != null
                          ? { height: mapPanelHeight, maxHeight: mapPanelHeight }
                          : undefined
                      }
                    >
                      {selected ? (
                        <CountryDetail
                          key={selected.iso3}
                          country={selected.country}
                          status={selected.status}
                          score={selected.score}
                          reasons={selected.reasons}
                          regulations={selected.key_regulations}
                        />
                      ) : (
                        <div className="h-full min-h-0 flex flex-col">
                          <p className="text-[11px] font-mono uppercase tracking-wider text-white/35 mb-4 shrink-0">
                            Market breakdown
                          </p>
                          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
                            {filteredCountryVerdicts
                              .slice()
                              .sort((a, b) => statusRank(a.status) - statusRank(b.status))
                              .map((v) => {
                                const meta = STATUS_META[v.status];
                                return (
                                  <button
                                    key={v.iso3}
                                    onClick={() => setSelectedIso3(v.iso3)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: meta.color }}
                                    />
                                    <span className="text-sm text-white/80 flex-1 truncate">
                                      {v.country}
                                    </span>
                                    <span
                                      className="text-[10px] font-mono"
                                      style={{ color: meta.color }}
                                    >
                                      {meta.label}
                                    </span>
                                  </button>
                                );
                              })}
                          </div>
                          <p className="text-[10px] text-white/25 mt-3 flex items-center gap-1.5 shrink-0">
                            <MapPin size={10} /> Select a country on the map for details
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[11px] font-mono uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                      <Flag size={12} /> US state requirements
                      {selectedProduct && (
                        <span className="ml-1 text-white/20">· {selectedProduct}</span>
                      )}
                    </h2>
                    {selectedProduct && (
                      <button
                        onClick={() => handleProductPill(null)}
                        className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                      >
                        Show all products
                      </button>
                    )}
                  </div>

                  {/* US state map + detail split — mirrors the world map layout */}
                  <div className="grid lg:grid-cols-5 gap-6 items-start mb-4">
                    <div className="lg:col-span-3 rounded-2xl border border-white/[0.07] bg-white/[0.015] p-4">
                      <div className="flex items-center justify-end mb-2 px-1">
                        <div className="flex items-center gap-3 text-[11px] font-mono">
                          <Legend color="#22c55e" label="allowed" />
                          <Legend color="#eab308" label="review" />
                          <Legend color="#ef4444" label="blocked" />
                        </div>
                      </div>
                      <USStateMap
                        verdicts={filteredStateVerdicts}
                        selectedCode={selectedStateCode}
                        onSelect={setSelectedStateCode}
                      />
                    </div>

                    <div className="lg:col-span-2 rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5 min-h-[200px]">
                      {selectedStateCode ? (
                        <StateDetail
                          verdict={filteredStateVerdicts.find(
                            (v) => v.code === selectedStateCode
                          ) ?? null}
                          onClose={() => setSelectedStateCode(null)}
                        />
                      ) : (
                        <div className="h-full flex flex-col">
                          <p className="text-[11px] font-mono uppercase tracking-wider text-white/35 mb-4">
                            State breakdown
                          </p>
                          <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 max-h-[400px]">
                            {filteredStateVerdicts
                              .slice()
                              .sort((a, b) => statusRank(a.status) - statusRank(b.status))
                              .map((s) => {
                                const meta = STATUS_META[s.status];
                                return (
                                  <button
                                    key={s.code}
                                    onClick={() => setSelectedStateCode(s.code)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
                                  >
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: meta.color }}
                                    />
                                    <span className="text-sm text-white/80 flex-1 truncate">
                                      {s.state}
                                    </span>
                                    <span className="text-[10px] font-mono text-white/30 shrink-0">
                                      {s.code}
                                    </span>
                                    <span
                                      className="text-[10px] font-mono shrink-0"
                                      style={{ color: meta.color }}
                                    >
                                      {meta.label}
                                    </span>
                                  </button>
                                );
                              })}
                          </div>
                          <p className="text-[10px] text-white/25 mt-3 flex items-center gap-1.5 shrink-0">
                            <MapPin size={10} /> Select a state on the map for details
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── ClickHouse: State-level enforcement hotspots ── */}
                  <StateRecallHotspots
                    products={products}
                    productType={
                      products[0]?.name?.toLowerCase().includes("drug") ||
                      products[0]?.name?.toLowerCase().includes("pharma")
                        ? "Drug"
                        : products[0]?.name?.toLowerCase().includes("device")
                        ? "Device"
                        : "Food"
                    }
                  />
                </div>
              </div>
            )}

            {/* ── RETAILERS TAB ── */}
            {activeTab === "retailers" && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[11px] font-mono uppercase tracking-wider text-white/35 flex items-center gap-1.5">
                    <Store size={12} /> Retail channels
                  </h2>
                  <button
                    onClick={reloadRetailers}
                    disabled={reloadingRetailers || isLoadingProductData}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-white/[0.10] bg-white/[0.04] text-white/50 hover:text-white/90 hover:border-white/20 hover:bg-white/[0.07] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RefreshCw size={11} className={reloadingRetailers ? "animate-spin" : ""} />
                    {reloadingRetailers ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {isLoadingProductData && (
                  <div className="flex items-center gap-2.5 px-4 py-3 mb-4 rounded-xl border border-white/[0.07] bg-white/[0.02] text-white/45 text-xs">
                    <Loader2 size={13} className="animate-spin shrink-0" />
                    Fetching {selectedProduct}-specific retailer data…
                  </div>
                )}
                {filteredRetailerVerdicts.length > 0 ? (
                  <div className="space-y-4">
                    {filteredRetailerVerdicts.map((r, i) => {
                      const meta = STATUS_META[r.status];
                      // Support both old shape (reason: string) and new shape (reasons: string[])
                      const reasons: string[] =
                        r.reasons?.length
                          ? r.reasons
                          : (r as unknown as { reason?: string }).reason
                          ? [(r as unknown as { reason: string }).reason]
                          : [];
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden"
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
                            <div className="flex items-center gap-2.5">
                              <meta.Icon size={16} style={{ color: meta.color }} className="shrink-0" />
                              <span className="text-sm font-semibold text-white/90">{r.retailer}</span>
                            </div>
                            <span
                              className={`text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border ${meta.chip}`}
                              style={{ color: meta.color }}
                            >
                              {meta.label}
                            </span>
                          </div>

                          {/* Body */}
                          <div className="px-4 py-3 space-y-4">
                            {/* Verdict reasons */}
                            {reasons.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5">
                                  Analysis
                                </p>
                                <ul className="space-y-1">
                                  {reasons.map((reason, j) => (
                                    <li key={j} className="flex items-start gap-2">
                                      <span className="mt-1.5 w-1 h-1 rounded-full bg-white/25 shrink-0" />
                                      <span className="text-xs text-white/60 leading-relaxed">{reason}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Requirements */}
                            {r.requirements?.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 flex items-center gap-1.5">
                                  <ListChecks size={10} className="text-white/25" />
                                  Requirements
                                </p>
                                <ul className="space-y-1">
                                  {r.requirements.map((req, j) => (
                                    <li key={j} className="flex items-start gap-2">
                                      <Check size={10} className="mt-1 text-yellow-400/60 shrink-0" />
                                      <span className="text-xs text-white/55 leading-relaxed">{req}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Geographic notes */}
                            {r.geographic_notes?.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5 flex items-center gap-1.5">
                                  <MapPin size={10} className="text-white/25" />
                                  State &amp; country notes
                                </p>
                                <ul className="space-y-1">
                                  {r.geographic_notes.map((note, j) => (
                                    <li key={j} className="flex items-start gap-2">
                                      <MapPin size={10} className="mt-1 text-blue-400/50 shrink-0" />
                                      <span className="text-xs text-white/55 leading-relaxed">{note}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Action steps — navigate to Todo tab */}
                            {r.action_steps?.length > 0 && (
                              <div className="pt-0.5">
                                <button
                                  onClick={() => setActiveTab("todo")}
                                  className="group flex items-center gap-2 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/40 hover:text-white/80 hover:border-white/[0.18] hover:bg-white/[0.06] transition-all"
                                >
                                  <ListChecks size={11} className="text-white/30 group-hover:text-white/60 transition-colors" />
                                  <span>
                                    {r.action_steps.length} action step{r.action_steps.length !== 1 ? "s" : ""} — view in Todo
                                  </span>
                                  <ArrowRight size={10} className="text-white/25 group-hover:text-white/50 transition-colors" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-white/30">No retailer data available.</p>
                )}
              </div>
            )}

            {/* ── TODO TAB ── */}
            {activeTab === "todo" && (
              <TodoTab analysis={analysis} products={products} retailerVerdicts={retailerVerdicts} selectedProduct={selectedProduct} />
            )}

          </div>
        </main>
      </div>

      {/* ── Add Product Modal ── */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !addingProduct && setAddModalOpen(false)}
          />
          <div className="relative w-full max-w-md bg-[#0e0e10] border border-white/[0.1] rounded-2xl shadow-2xl shadow-black/80 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
              <div>
                <p className="text-[14px] font-semibold text-white">Add a product</p>
                <p className="text-[11px] text-white/35 mt-0.5">
                  We&apos;ll validate compliance for all countries &amp; US states
                </p>
              </div>
              <button
                onClick={() => !addingProduct && setAddModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] flex items-center justify-center text-white/40 hover:text-white transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">
              {/* Upload label option */}
              <div>
                <p className="text-[11px] text-white/40 mb-2">Upload a product label to auto-fill</p>
                <button
                  type="button"
                  onClick={() => addUploadRef.current?.click()}
                  disabled={uploadingLabel || addingProduct}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed text-[12px] font-medium transition-all",
                    pendingLabelProduct
                      ? "border-[#22c55e]/40 text-[#22c55e]/70 bg-[#22c55e]/[0.04]"
                      : "border-white/[0.12] text-white/40 hover:text-white/70 hover:border-white/25 bg-white/[0.02] hover:bg-white/[0.04]",
                    (uploadingLabel || addingProduct) && "opacity-40 cursor-not-allowed"
                  )}
                >
                  {uploadingLabel ? (
                    <><Loader2 size={13} className="animate-spin" /> Reading label…</>
                  ) : pendingLabelProduct ? (
                    <><Check size={13} /> Label read — {pendingLabelProduct.name}</>
                  ) : (
                    <><UploadCloud size={13} /> Upload label / photo / PDF</>
                  )}
                </button>
                <input
                  ref={addUploadRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.csv,.txt,.md"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLabelUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/[0.07]" />
                <span className="text-[10px] font-mono text-white/25">or type manually</span>
                <div className="flex-1 h-px bg-white/[0.07]" />
              </div>

              {/* Product name */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-white/45">Product name *</label>
                <input
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !addingProduct && newProductName.trim() && addAndRunCheck()}
                  placeholder="e.g. Chocolate Protein Bar 60g"
                  disabled={addingProduct}
                  className="w-full h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition-colors disabled:opacity-50"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-white/45">Ingredients / description <span className="text-white/25">(optional)</span></label>
                <textarea
                  value={newProductDesc}
                  onChange={(e) => setNewProductDesc(e.target.value)}
                  placeholder="List key ingredients or claims — helps us validate more accurately"
                  disabled={addingProduct}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-[13px] placeholder:text-white/20 focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition-colors resize-none disabled:opacity-50"
                />
              </div>

              {addError && (
                <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {addError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2.5 px-5 pb-5">
              <button
                onClick={() => setAddModalOpen(false)}
                disabled={addingProduct}
                className="flex-1 h-10 rounded-xl border border-white/[0.1] text-white/50 hover:text-white text-sm font-medium transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={addAndRunCheck}
                disabled={!newProductName.trim() || addingProduct}
                className="flex-1 h-10 rounded-xl bg-white hover:bg-white/90 text-black text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {addingProduct ? (
                  <><Loader2 size={13} className="animate-spin" /> Checking…</>
                ) : (
                  <>Run compliance check</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ProductInspector ──────────────────────────────────────────────────────────

function ProductInspector({
  products,
  findings,
  inspectedProduct,
  onInspect,
  companyName,
  labelOverrides,
  onLabelOverride,
  onLabelRecheck,
  recheckingProduct,
  recheckFailed,
  onAddProduct,
  onProductMetaUpdate,
}: {
  products: ProductInput[];
  findings: ProductFinding[];
  inspectedProduct: string | null;
  onInspect: (name: string) => void;
  companyName?: string;
  labelOverrides: Record<string, string>;
  onLabelOverride: (name: string, text: string) => void;
  onLabelRecheck: (name: string, text: string) => Promise<void>;
  recheckingProduct: string | null;
  recheckFailed: { productName: string; message: string } | null;
  onAddProduct?: () => void;
  onProductMetaUpdate?: (name: string, meta: Partial<Pick<ProductInput, "certifications" | "packaging_language" | "label_source_url">>) => void;
}) {
  const inspected =
    products.find((p) => p.name === inspectedProduct) ?? products[0] ?? null;

  const [fetchingLabel, setFetchingLabel] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [fetchSourceUrl, setFetchSourceUrl] = useState<string | null>(inspected?.label_source_url ?? null);
  const [pasteValue, setPasteValue] = useState("");
  const [showFullNutrition, setShowFullNutrition] = useState(true);

  // When the inspected product changes: reset panel state, and auto-fetch if
  // there is no label data yet so the user never has to click "Auto-fetch".
  useEffect(() => {
    setFetchError(null);
    setPasteMode(false);
    setFetchSourceUrl(inspected?.label_source_url ?? null);
    setShowFullNutrition(true);
    if (!inspected) return;
    const hasLabel = !!(labelOverrides[inspected.name] ?? inspected.label_text);
    if (!hasLabel) {
      void handleAutoFetch();
    }
    // handleAutoFetch is a hoisted function declaration stable across renders;
    // we intentionally only re-run when the product name changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspected?.name]);

  if (!inspected) return null;

  // Merge label override into the inspected product
  const effectiveLabelText = labelOverrides[inspected.name] ?? inspected.label_text;

  const productFindings = findings.filter(
    (f) => f.product.toLowerCase() === inspected.name.toLowerCase()
  );

  const ingredients = parseIngredients(effectiveLabelText, productFindings);
  const hasIngredients = ingredients.length > 0;
  const flaggedCount = ingredients.filter((i) => i.flagged).length;
  const nutrition = parseNutritionFacts({ ...inspected, label_text: effectiveLabelText });
  const allergens = parseAllergens({ ...inspected, label_text: effectiveLabelText });
  const fullPanel = parseFullNutritionPanel(effectiveLabelText ?? "");

  async function handleAutoFetch() {
    setFetchingLabel(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/fetch-product-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: inspected!.name, companyName }),
      });
      const data = await res.json();
      if (data.label_text) {
        onLabelOverride(inspected!.name, data.label_text);
        // Persist certifications, packaging language, and source URL if returned
        if (onProductMetaUpdate) {
          const meta: Partial<Pick<ProductInput, "certifications" | "packaging_language" | "label_source_url">> = {};
          if (Array.isArray(data.certifications) && data.certifications.length) {
            meta.certifications = data.certifications as string[];
          }
          if (data.packaging_language) {
            meta.packaging_language = data.packaging_language as string;
          }
          if (data.source_url) {
            meta.label_source_url = data.source_url as string;
          }
          if (Object.keys(meta).length) onProductMetaUpdate(inspected!.name, meta);
        }
        if (data.source_url) setFetchSourceUrl(data.source_url as string);
        setPasteMode(false);
      } else {
        setFetchError(data.message ?? "No ingredient data found. Try pasting it manually.");
        setPasteMode(true);
      }
    } catch {
      setFetchError("Fetch failed. Try pasting the ingredients manually.");
      setPasteMode(true);
    } finally {
      setFetchingLabel(false);
    }
  }

  function handlePasteSave() {
    if (!pasteValue.trim() || !inspected) return;
    const text = pasteValue.trim();
    setPasteMode(false);
    setPasteValue("");
    // Fire-and-forget: onLabelRecheck stores the override AND re-runs compliance
    onLabelRecheck(inspected.name, text);
  }

  return (
    <div>
      <SectionTitle Icon={Package} title={`Products checked (${products.length})`} />

      {/* Product selector cards */}
      <div className="flex flex-wrap gap-2.5 mb-6">
        {products.map((p) => {
          const pFindings = findings.filter(
            (f) => f.product.toLowerCase() === p.name.toLowerCase()
          );
          const pHasLabel = !!(labelOverrides[p.name] ?? p.label_text);
          const isActive =
            inspectedProduct === p.name ||
            (!inspectedProduct && p === products[0]);
          const worst = pFindings.reduce(
            (acc, f) => Math.min(acc, severityConfig(f.severity).rank),
            3
          );
          return (
            <button
              key={p.name}
              onClick={() => onInspect(p.name)}
              className={cn(
                "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-colors text-left",
                isActive
                  ? "border-white/20 bg-white/[0.06] text-white"
                  : "border-white/[0.07] bg-white/[0.02] text-white/50 hover:text-white/75 hover:border-white/15"
              )}
            >
              {p.image_url ? (
                <span className="relative w-7 h-7 rounded-lg overflow-hidden shrink-0 border border-white/[0.08]">
                  <Image
                    src={p.image_url}
                    alt={p.name}
                    fill
                    sizes="28px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
              ) : (
                <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0">
                  <Package size={13} className="text-white/25" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-semibold truncate max-w-[160px]">{p.name}</p>
                {!pHasLabel ? (
                  <p className="text-[10px] font-mono mt-0.5 text-white/25">No label data</p>
                ) : pFindings.length > 0 ? (
                  <p className="text-[10px] font-mono mt-0.5" style={{ color: severityColor(worst) }}>
                    {pFindings.length} finding{pFindings.length !== 1 ? "s" : ""}
                  </p>
                ) : (
                  <p className="text-[10px] font-mono mt-0.5 text-green-400">No issues</p>
                )}
              </div>
            </button>
          );
        })}

        {/* Add product "+" box */}
        {onAddProduct && (
          <button
            onClick={onAddProduct}
            className="flex items-center justify-center w-[42px] h-[42px] rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] text-white/30 hover:text-white/70 hover:border-white/30 hover:bg-white/[0.05] transition-all shrink-0"
            title="Add product"
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {/* Detail panel */}
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] overflow-hidden">
        {/* Product header */}
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 border border-white/[0.08]">
            <ProductImage src={inspected.image_url} name={inspected.name} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white/90 truncate">{inspected.name}</p>
            {inspected.description && (
              <p className="text-[11px] text-white/40 mt-0.5 truncate">{inspected.description}</p>
            )}
          </div>
          {!effectiveLabelText ? (
            <span className="text-[10px] font-mono text-white/25 shrink-0">No label</span>
          ) : productFindings.length > 0 ? (
            <span
              className="text-[10px] font-mono shrink-0"
              style={{
                color: severityColor(
                  productFindings.reduce(
                    (acc, f) => Math.min(acc, severityConfig(f.severity).rank),
                    3
                  )
                ),
              }}
            >
              {productFindings.length} finding{productFindings.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-green-400 shrink-0">Clear</span>
          )}
        </div>

        {/* Two-column: ingredients | findings */}
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/[0.07]">
          {/* Left: Nutrition & Ingredients */}
          <div className="p-5 space-y-4 max-h-[520px] overflow-y-auto scrollbar-none">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 flex items-center gap-1.5">
                <Info size={10} />
                Nutrition &amp; Ingredients
                {flaggedCount > 0 && (
                  <span className="ml-1 text-orange-400/70">· {flaggedCount} flagged</span>
                )}
              </p>
              {/* Edit/fetch controls */}
              {!pasteMode && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleAutoFetch}
                    disabled={fetchingLabel}
                    className="text-[9px] font-mono uppercase tracking-wider text-white/35 hover:text-white/70 border border-white/[0.08] hover:border-white/20 rounded-md px-2 py-0.5 transition-colors disabled:opacity-40"
                  >
                    {fetchingLabel ? "Fetching…" : "Auto-fetch"}
                  </button>
                  <button
                    onClick={() => { setPasteMode(true); setPasteValue(effectiveLabelText ?? ""); }}
                    className="text-[9px] font-mono uppercase tracking-wider text-white/35 hover:text-white/70 border border-white/[0.08] hover:border-white/20 rounded-md px-2 py-0.5 transition-colors"
                  >
                    Paste
                  </button>
                </div>
              )}
            </div>

            {/* Paste mode */}
            {pasteMode && (
              <div className="space-y-2">
                <p className="text-[10px] text-white/40">
                  Paste the ingredient list, nutrition facts, and allergen info from the product label or website:
                </p>
                <textarea
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  placeholder={`Calories 150\nProtein 20g\nTotal Carbohydrates 18g\nTotal Fat 3.5g\nTotal Sugars 0g\n\nIngredients\nWhey protein isolate, maltitol...\n\nContains\nMilk, Egg, Soy\n\nMay Contain\nTree Nuts`}
                  rows={10}
                  className="w-full bg-white/[0.03] border border-white/[0.1] rounded-lg p-3 text-[11px] text-white/70 placeholder-white/20 focus:outline-none focus:border-white/25 resize-none font-mono leading-relaxed"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handlePasteSave}
                    disabled={!pasteValue.trim()}
                    className="text-[10px] font-mono px-3 py-1 rounded-lg bg-white/[0.08] border border-white/15 text-white/80 hover:bg-white/[0.12] transition-colors disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setPasteMode(false); setFetchError(null); }}
                    className="text-[10px] font-mono px-3 py-1 rounded-lg border border-white/[0.07] text-white/40 hover:text-white/60 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {fetchError && (
                  <p className="text-[10px] text-orange-400/70">{fetchError}</p>
                )}
              </div>
            )}

            {/* Normal display */}
            {!pasteMode && (
              <>
                {fetchError && (
                  <p className="text-[10px] text-orange-400/70">{fetchError}</p>
                )}

                {/* Source URL — shown after auto-fetch so users can verify accuracy */}
                {fetchSourceUrl && (
                  <p className="text-[9px] text-white/30 flex items-center gap-1 truncate">
                    <span className="shrink-0">Source:</span>
                    <a
                      href={fetchSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/40 hover:text-white/70 underline underline-offset-2 decoration-white/20 truncate transition-colors"
                      title={fetchSourceUrl}
                    >
                      {fetchSourceUrl.replace(/^https?:\/\//, "").slice(0, 60)}
                      {fetchSourceUrl.replace(/^https?:\/\//, "").length > 60 ? "…" : ""}
                    </a>
                    <span className="shrink-0 ml-1 text-orange-400/60">· verify before submitting</span>
                  </p>
                )}

                {/* Nutrition macros strip */}
                {nutrition && (
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { value: nutrition.protein, label: "Protein" },
                      { value: nutrition.calories, label: "Calories" },
                      { value: nutrition.total_sugars, label: "Sugars" },
                      { value: nutrition.carbs, label: "Carbs" },
                      { value: nutrition.fats, label: "Fats" },
                    ]
                      .filter((m) => m.value)
                      .map((m) => (
                        <div
                          key={m.label}
                          className="flex flex-col items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] py-2 px-1"
                        >
                          <span className="text-[13px] font-bold text-white/90 leading-none">
                            {m.value}
                          </span>
                          <span className="text-[8px] font-mono uppercase tracking-wide text-white/35 mt-1 text-center leading-tight">
                            {m.label}
                          </span>
                        </div>
                      ))}
                  </div>
                )}

                {/* Full Nutrition Facts panel */}
                {fullPanel && (
                  <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                    <button
                      onClick={() => setShowFullNutrition((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <div>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/20">
                          Full Nutrition Facts
                        </p>
                        {(fullPanel.serving_size || fullPanel.servings_per_container) && (
                          <p className="text-[10px] text-white/40 mt-0.5">
                            {[
                              fullPanel.serving_size && `Serving: ${fullPanel.serving_size}`,
                              fullPanel.servings_per_container && `${fullPanel.servings_per_container} servings`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 text-white/25 transition-transform shrink-0",
                          showFullNutrition && "rotate-180"
                        )}
                      />
                    </button>

                    {showFullNutrition && (
                      <div className="border-t border-white/[0.07] px-3 py-2">
                        {/* Calories row */}
                        {fullPanel.calories && (
                          <div className="flex items-baseline justify-between py-1.5 border-b-2 border-white/[0.12] mb-1">
                            <span className="text-[13px] font-bold text-white/90">Calories</span>
                            <span className="text-[18px] font-bold text-white/90">{fullPanel.calories}</span>
                          </div>
                        )}
                        {/* % DV header */}
                        <div className="flex justify-end pb-0.5">
                          <span className="text-[8px] font-mono text-white/20 uppercase tracking-wider">
                            % Daily Value*
                          </span>
                        </div>
                        {/* All nutrient rows */}
                        {fullPanel.rows.map((row, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex items-baseline justify-between py-[3px] border-b border-white/[0.04]",
                              row.level === 1 && "pl-4",
                              row.level === 2 && "pl-8"
                            )}
                          >
                            <span
                              className={cn(
                                "text-[11px] leading-snug",
                                row.level === 0
                                  ? "font-semibold text-white/80"
                                  : "font-normal text-white/50"
                              )}
                            >
                              {row.name}
                              {row.value && (
                                <span className="font-normal text-white/40"> {row.value}</span>
                              )}
                            </span>
                            {row.dv ? (
                              <span className="text-[10px] font-mono text-white/35 ml-2 shrink-0">
                                {row.dv}
                              </span>
                            ) : (
                              <span />
                            )}
                          </div>
                        ))}
                        <p className="text-[8px] text-white/18 pt-2 leading-relaxed">
                          * % Daily Value based on a 2,000 calorie daily diet.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Ingredient list */}
                {hasIngredients ? (
                  <div className="space-y-1">
                    <p className="text-[9px] font-mono uppercase tracking-widest text-white/20 mb-2">
                      Ingredients
                    </p>
                    {ingredients.map((ing, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{
                            backgroundColor: ing.flagged ? "#f97316" : "rgba(255,255,255,0.18)",
                          }}
                        />
                        <p
                          className={cn(
                            "text-[12px] leading-relaxed",
                            ing.flagged ? "text-orange-300/90 font-medium" : "text-white/55"
                          )}
                        >
                          {ing.name}
                          {ing.flagged && (
                            <span className="ml-1.5 text-[9px] font-mono text-orange-400/60 uppercase tracking-wider">
                              flagged
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : effectiveLabelText ? (
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-white/20 mb-2">
                      Label
                    </p>
                    <p className="text-[12px] text-white/50 leading-relaxed whitespace-pre-wrap">
                      {effectiveLabelText.slice(0, 800)}
                    </p>
                  </div>
                ) : (
                  <div className="py-4 text-center space-y-2">
                    <p className="text-[11px] text-white/30">No ingredient data available.</p>
                    <p className="text-[10px] text-white/20">
                      Use <span className="text-white/40">Auto-fetch</span> to pull from the web, or{" "}
                      <span className="text-white/40">Paste</span> it manually.
                    </p>
                  </div>
                )}

                {/* Allergens */}
                {allergens && (
                  <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                    {allergens.contains && allergens.contains.length > 0 && (
                      <div>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-1.5">
                          Contains
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {allergens.contains.map((a) => (
                            <span
                              key={a}
                              className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-orange-400/25 bg-orange-400/5 text-orange-300/80"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {allergens.may_contain && allergens.may_contain.length > 0 && (
                      <div>
                        <p className="text-[9px] font-mono uppercase tracking-widest text-white/25 mb-1.5">
                          May Contain
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {allergens.may_contain.map((a) => (
                            <span
                              key={a}
                              className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-white/[0.1] bg-white/[0.03] text-white/45"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Packaging & Certifications */}
                {(inspected.certifications?.length || inspected.packaging_language || inspected.packaging_notes) && (
                  <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                    <p className="text-[9px] font-mono uppercase tracking-widest text-white/25">
                      Packaging &amp; Certifications
                    </p>
                    {inspected.certifications && inspected.certifications.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {inspected.certifications.map((cert) => (
                          <span
                            key={cert}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-green-400/25 bg-green-400/5 text-green-300/80"
                          >
                            {cert}
                          </span>
                        ))}
                      </div>
                    )}
                    {inspected.packaging_language && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-white/25 uppercase tracking-wider">Label language:</span>
                        <span className="text-[10px] text-white/55">{inspected.packaging_language}</span>
                      </div>
                    )}
                    {inspected.packaging_notes && (
                      <p className="text-[10px] text-white/45 leading-relaxed">{inspected.packaging_notes}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right: Compliance findings */}
          <div className="p-5 max-h-[520px] overflow-y-auto scrollbar-none">
            <p className="text-[9px] font-mono uppercase tracking-widest text-white/30 mb-3 flex items-center gap-1.5">
              <AlertCircle size={10} />
              {recheckingProduct === inspected.name ? "Re-checking…" : "Compliance findings"}
              {recheckingProduct === inspected.name && (
                <Loader2 size={9} className="animate-spin text-white/40 ml-1" />
              )}
            </p>

            {recheckingProduct === inspected.name ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Loader2 size={14} className="animate-spin text-white/40 shrink-0" />
                  <p className="text-[12px] text-white/50">
                    Re-checking compliance with new ingredient data…
                  </p>
                </div>
                <p className="text-[10px] text-white/25">This usually takes 20–40 seconds.</p>
              </div>
            ) : recheckFailed?.productName === inspected.name ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 space-y-1">
                  <p className="text-[11px] text-red-400 font-medium">Re-check failed</p>
                  <p className="text-[10px] text-red-400/70">{recheckFailed.message}</p>
                </div>
                {productFindings.length > 0 && (
                  <p className="text-[10px] text-white/25">Showing previous findings below.</p>
                )}
                {productFindings.length > 0 && (
                  <div className="space-y-3.5">
                    {productFindings.map((f, i) => {
                      const sev = severityConfig(f.severity);
                      return (
                        <div key={i} className="flex gap-2.5 opacity-50">
                          <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: sev.color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-white/85 font-medium leading-snug">{f.issue}</p>
                            <p className="text-[10px] font-mono text-white/30 mt-0.5">{f.regulation}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : !effectiveLabelText ? (
              <div className="flex flex-col gap-2.5 mt-1">
                <p className="text-[11px] text-white/30 leading-relaxed">
                  No label data available. Compliance findings are generated only from real ingredient, nutrition, and packaging information.
                </p>
                <p className="text-[10px] text-white/20 leading-relaxed">
                  Use <span className="text-white/40">Auto-fetch</span> or <span className="text-white/40">Paste</span> on the left to add your product label, then save to run a fact-based compliance check.
                </p>
              </div>
            ) : productFindings.length > 0 ? (
              <div className="space-y-3.5">
                {productFindings.map((f, i) => {
                  const sev = severityConfig(f.severity);
                  return (
                    <div key={i} className="flex gap-2.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                        style={{ backgroundColor: sev.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12px] text-white/85 font-medium leading-snug">
                            {f.issue}
                          </p>
                          <span
                            className="text-[9px] font-mono shrink-0 mt-0.5"
                            style={{ color: sev.color }}
                          >
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-white/30 mt-0.5">{f.regulation}</p>
                        <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{f.action}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <CheckCircle2 size={14} className="text-green-400 shrink-0" />
                <p className="text-[12px] text-white/50">
                  No compliance issues found for this product.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Todo helpers ──────────────────────────────────────────────────────────────

function deriveSteps(action: string, regulation: string): string[] {
  const lower = (action + " " + regulation).toLowerCase();
  if (lower.includes("label") || lower.includes("packag"))
    return [
      "Review current label design against all applicable requirements",
      "List missing or non-compliant elements (language, font size, required fields)",
      "Brief your design or packaging team on required changes",
      "Have a regulatory consultant review the revised label draft",
      "Update print files and order compliant packaging",
    ];
  if (lower.includes("register") || lower.includes("notif") || lower.includes("licens"))
    return [
      "Identify the correct regulatory authority and application portal",
      "Gather required documents: formulation, safety data, Certificates of Analysis",
      "Complete the official registration or notification form",
      "Submit with required fees and supporting documents",
      "Track application status and respond promptly to any queries",
    ];
  if (lower.includes("reformulat") || lower.includes("remov") || lower.includes("replac") || lower.includes("ingredient"))
    return [
      "Identify the specific ingredient(s) flagged by the regulation",
      "Research approved alternative ingredients with your supplier",
      "Update product formula with your co-manufacturer",
      "Run stability and shelf-life testing on the new formulation",
      "Update the ingredient declaration and nutrition facts on your label",
    ];
  if (lower.includes("certif") || lower.includes("approv") || lower.includes("accredit"))
    return [
      "Identify the specific certification body or accreditation program",
      "Review their requirements checklist and gather required documentation",
      "Prepare product samples, paperwork, and application fees",
      "Submit application and schedule any required audits or inspections",
      "Display certification mark on label per requirements once granted",
    ];
  if (lower.includes("test") || lower.includes("analys") || lower.includes("lab"))
    return [
      "Identify an accredited testing laboratory for this regulation",
      "Prepare and ship product samples per the lab's requirements",
      "Receive and review the test report against regulatory limits",
      "Address any out-of-spec findings with your formulation team",
      "Retain test records as part of your compliance documentation",
    ];
  if (lower.includes("translat") || lower.includes("french") || lower.includes("bilingual") || lower.includes("language"))
    return [
      "Identify all required languages for this market",
      "Hire a certified translator familiar with food label terminology",
      "Translate all required elements (name, ingredients, allergen warnings)",
      "Have a native-speaking reviewer check for accuracy and readability",
      "Update label files and verify character spacing in final artwork",
    ];
  if (lower.includes("import") || lower.includes("custom") || lower.includes("border") || lower.includes("entry"))
    return [
      "Obtain a copy of the relevant import and customs regulations",
      "Identify a licensed customs broker in the destination country",
      "Prepare all required documents (Certificate of Origin, CoA, health cert)",
      "Verify your HS tariff code and applicable duty rates",
      "Submit any pre-shipment documentation to relevant authorities",
    ];
  if (lower.includes("restrict") || lower.includes("prohibit") || lower.includes("ban") || lower.includes("block"))
    return [
      "Confirm the specific ingredient or claim triggering the restriction",
      "Consult your legal or regulatory counsel on the market's rules",
      "Evaluate whether product modification would achieve compliance",
      "Assess if the market opportunity justifies reformulation investment",
      "Document the decision and monitor for future regulatory changes",
    ];
  return [
    "Review the specific regulatory requirement in detail",
    "Identify the responsible internal owner or external consultant",
    "Define clear deliverables and a realistic timeline",
    "Implement the required changes and document all actions taken",
    "Conduct an internal review before market entry or relaunch",
  ];
}

function getRegulationLink(regulation: string): { label: string; url: string } | null {
  if (!regulation) return null;
  const r = regulation.toLowerCase();
  if (r.includes("21 cfr") || r.includes("fda"))
    return { label: "FDA eCFR", url: `https://www.ecfr.gov/search/#query=${encodeURIComponent(regulation)}` };
  if ((r.includes("eu") || r.includes("european")) && (r.includes("regulation") || r.includes("directive") || r.includes("no.")))
    return { label: "EUR-Lex", url: `https://eur-lex.europa.eu/search.html?query=${encodeURIComponent(regulation)}&scope=EURLEX` };
  if (r.includes("health canada") || r.includes("cfia"))
    return { label: "Health Canada", url: "https://www.canada.ca/en/health-canada/services/food-nutrition.html" };
  if (r.includes("fsanz"))
    return { label: "FSANZ", url: "https://www.foodstandards.gov.au/food-standards-code" };
  if (r.includes("uk fsa") || r.includes("uk food"))
    return { label: "UK FSA", url: "https://www.food.gov.uk/business-guidance" };
  if (r.includes("anvisa"))
    return { label: "ANVISA", url: "https://www.gov.br/anvisa/en" };
  if (r.includes("mhlw"))
    return { label: "Japan MHLW", url: "https://www.mhlw.go.jp/english/topics/foodsafety/" };
  if (r.includes("china") || r.includes(" gb ") || r.includes("nhc"))
    return { label: "China Food Standards", url: "https://www.cirs-group.com/en/regulations/china-food-regulations" };
  return { label: "Search regulation", url: `https://www.google.com/search?q=${encodeURIComponent(regulation + " food compliance")}` };
}

// ── TodoTab ───────────────────────────────────────────────────────────────────

function TodoTab({
  analysis,
  products: _products,
  retailerVerdicts,
  selectedProduct,
}: {
  analysis: ComplianceAnalysis;
  products: ProductInput[];
  retailerVerdicts: RetailerVerdict[];
  selectedProduct?: string | null;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCountry = (iso3: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(iso3)) next.delete(iso3);
      else next.add(iso3);
      return next;
    });
  };

  const toggleState = (code: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // Section A: Immediate — critical/high product findings, filtered by selectedProduct
  const immediateItems = analysis.product_findings
    .filter((f) => {
      if (f.severity !== "critical" && f.severity !== "high") return false;
      if (selectedProduct) return f.product.toLowerCase() === selectedProduct.toLowerCase();
      return true;
    })
    .map((f, i) => ({
      id: `finding-${i}`,
      action: f.action,
      context: f.product,
      regulation: f.regulation,
      severity: f.severity as Severity,
      deadline: null as string | null,
    }));

  // Section B: Scheduled — action_plan sorted by deadline (portfolio-level, not filtered)
  const scheduledItems = [...analysis.action_plan]
    .sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    })
    .map((step, i) => ({
      id: `plan-${i}`,
      action: step.action,
      context: null as string | null,
      regulation: step.regulation,
      severity: null as Severity | null,
      deadline: step.deadline,
    }));

  // Section C: By Country — non-allowed markets, filtered by selectedProduct
  const countryGroups = analysis.country_verdicts.filter((v) => {
    if (v.status === "allowed") return false;
    if (selectedProduct && v.products?.length) {
      return v.products.some((n) => n.toLowerCase() === selectedProduct.toLowerCase());
    }
    return true;
  });

  // Section D: By State — non-allowed US states, filtered by selectedProduct
  const stateGroups = analysis.state_verdicts.filter((v) => {
    if (v.status === "allowed") return false;
    if (selectedProduct && v.products?.length) {
      return v.products.some((n) => n.toLowerCase() === selectedProduct.toLowerCase());
    }
    return true;
  });

  // Section E: Retailer actions — action_steps from retailer verdicts
  const retailerActionGroups = retailerVerdicts
    .filter((r) => r.action_steps?.length > 0)
    .map((r) => ({
      retailer: r.retailer,
      status: r.status,
      steps: r.action_steps.map((step, i) => ({
        id: `retailer-${r.retailer.replace(/\s+/g, "-").toLowerCase()}-${i}`,
        action: step,
      })),
    }));

  const retailerTotal = retailerActionGroups.reduce((sum, g) => sum + g.steps.length, 0);
  const total = immediateItems.length + scheduledItems.length + retailerTotal;
  const done = [...checked].filter(
    (id) => id.startsWith("finding-") || id.startsWith("plan-") || id.startsWith("retailer-")
  ).length;

  return (
    <div className="space-y-10">
      <SectionTitle Icon={ListChecks} title="Todo — what to do next" />

      {/* Progress bar */}
      {total > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 flex items-center gap-4 -mt-4">
          <div className="flex-1">
            <p className="text-[11px] text-white/40 mb-2">
              {done} of {total} actions completed
            </p>
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </div>
          </div>
          <span className="text-2xl font-bold tabular-nums text-white/20 shrink-0">
            {Math.round((done / total) * 100)}%
          </span>
        </div>
      )}

      {/* Section A: Immediate */}
      {immediateItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={12} className="text-orange-400" />
            <p className="text-[11px] font-mono uppercase tracking-wider text-white/35">
              Immediate actions
            </p>
            <span className="text-[10px] font-mono text-white/20">{immediateItems.length}</span>
          </div>
          <div className="space-y-2.5">
            {immediateItems.map((item) => (
              <TodoRow
                key={item.id}
                id={item.id}
                action={item.action}
                context={item.context}
                regulation={item.regulation}
                severity={item.severity}
                deadline={item.deadline}
                checked={checked.has(item.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section B: Scheduled */}
      {scheduledItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={12} className="text-white/35" />
            <p className="text-[11px] font-mono uppercase tracking-wider text-white/35">
              Scheduled actions
            </p>
            <span className="text-[10px] font-mono text-white/20">{scheduledItems.length}</span>
          </div>
          <div className="space-y-2.5">
            {scheduledItems.map((item) => (
              <TodoRow
                key={item.id}
                id={item.id}
                action={item.action}
                context={item.context}
                regulation={item.regulation}
                severity={item.severity}
                deadline={item.deadline}
                checked={checked.has(item.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section C: By Country — collapsible per country */}
      {countryGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Globe size={12} className="text-white/35" />
            <p className="text-[11px] font-mono uppercase tracking-wider text-white/35">
              By country
            </p>
            <span className="text-[10px] font-mono text-white/20">{countryGroups.length}</span>
          </div>
          <div className="space-y-2">
            {countryGroups.map((v) => {
              const meta = STATUS_META[v.status];
              const isOpen = expandedCountries.has(v.iso3);
              return (
                <div
                  key={v.iso3}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden"
                >
                  <button
                    onClick={() => toggleCountry(v.iso3)}
                    className="w-full flex items-center gap-2.5 p-3.5 hover:bg-white/[0.02] transition-colors text-left"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <p className="text-[13px] font-semibold text-white/80 flex-1">
                      {v.country}
                    </p>
                    <span className="text-[10px] font-mono" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] font-mono text-white/20 ml-1">
                      {v.reasons.length} item{v.reasons.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn(
                        "text-white/25 shrink-0 transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/[0.05] p-3 space-y-2">
                      {v.reasons.map((reason, ri) => (
                        <TodoRow
                          key={`${v.iso3}-${ri}`}
                          id={`country-${v.iso3}-${ri}`}
                          action={reason}
                          context={v.country}
                          regulation={v.key_regulations[0] ?? ""}
                          severity={null}
                          deadline={null}
                          checked={checked.has(`country-${v.iso3}-${ri}`)}
                          onToggle={toggle}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section D: By State — collapsible per state */}
      {stateGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <MapPin size={12} className="text-white/35" />
            <p className="text-[11px] font-mono uppercase tracking-wider text-white/35">
              By state
            </p>
            <span className="text-[10px] font-mono text-white/20">{stateGroups.length}</span>
          </div>
          <div className="space-y-2">
            {stateGroups.map((v) => {
              const meta = STATUS_META[v.status];
              const isOpen = expandedStates.has(v.code);
              return (
                <div
                  key={v.code}
                  className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden"
                >
                  <button
                    onClick={() => toggleState(v.code)}
                    className="w-full flex items-center gap-2.5 p-3.5 hover:bg-white/[0.02] transition-colors text-left"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <p className="text-[13px] font-semibold text-white/80 flex-1">
                      {v.state}
                    </p>
                    <span className="text-[10px] font-mono" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] font-mono text-white/20 ml-1">
                      {v.reasons.length} item{v.reasons.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronDown
                      size={13}
                      className={cn(
                        "text-white/25 shrink-0 transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/[0.05] p-3 space-y-2">
                      {v.reasons.map((reason, ri) => (
                        <TodoRow
                          key={`${v.code}-${ri}`}
                          id={`state-${v.code}-${ri}`}
                          action={reason}
                          context={v.state}
                          regulation={v.key_regulations[0] ?? ""}
                          severity={null}
                          deadline={null}
                          checked={checked.has(`state-${v.code}-${ri}`)}
                          onToggle={toggle}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section E: Retailer Actions */}
      {retailerActionGroups.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Store size={12} className="text-white/35" />
            <p className="text-[11px] font-mono uppercase tracking-wider text-white/35">
              Retailer actions
            </p>
            <span className="text-[10px] font-mono text-white/20">{retailerTotal}</span>
          </div>
          <div className="space-y-6">
            {retailerActionGroups.map((group) => {
              const meta = STATUS_META[group.status];
              return (
                <div key={group.retailer}>
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: meta.color }}
                    />
                    <p className="text-[13px] font-semibold text-white/80">{group.retailer}</p>
                    <span className="text-[10px] font-mono ml-0.5" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="space-y-2 pl-4">
                    {group.steps.map((item) => (
                      <TodoRow
                        key={item.id}
                        id={item.id}
                        action={item.action}
                        context={group.retailer}
                        regulation=""
                        severity={null}
                        deadline={null}
                        checked={checked.has(item.id)}
                        onToggle={toggle}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {immediateItems.length === 0 && scheduledItems.length === 0 && countryGroups.length === 0 && stateGroups.length === 0 && retailerActionGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 size={32} className="text-green-400 mb-3" />
          <p className="text-sm font-medium text-white/60">No action items found</p>
          <p className="text-[12px] text-white/30 mt-1">Your products appear to be compliant.</p>
        </div>
      )}
    </div>
  );
}

// ── TodoRow ───────────────────────────────────────────────────────────────────

function TodoRow({
  id,
  action,
  context,
  regulation,
  severity,
  deadline,
  checked,
  onToggle,
}: {
  id: string;
  action: string;
  context: string | null;
  regulation: string;
  severity: Severity | null;
  deadline: string | null;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sev = severity ? severityConfig(severity) : null;
  const steps = deriveSteps(action, regulation);
  const link = getRegulationLink(regulation);

  return (
    <div
      className={cn(
        "rounded-xl border transition-all",
        checked
          ? "border-white/[0.04] bg-transparent opacity-50"
          : "border-white/[0.07] bg-white/[0.02]"
      )}
    >
      {/* Main row */}
      <div className="flex gap-3 items-start p-4">
        <button
          onClick={() => onToggle(id)}
          className={cn(
            "w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-colors",
            checked
              ? "bg-green-500/20 border-green-500/40"
              : "border-white/20 hover:border-white/40"
          )}
        >
          {checked && <Check size={10} className="text-green-400" />}
        </button>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-[13px] leading-relaxed",
              checked ? "line-through text-white/35" : "text-white/80"
            )}
          >
            {action}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {context && (
              <span className="text-[10px] font-mono text-white/30">{context}</span>
            )}
            {regulation && (
              <span className="text-[10px] font-mono text-white/22">{regulation}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {sev && (
            <span className="text-[10px] font-mono" style={{ color: sev.color }}>
              {sev.label}
            </span>
          )}
          {deadline && (
            <span className="text-[10px] font-mono text-orange-400/65 flex items-center gap-1">
              <Clock size={9} />
              {deadline}
            </span>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-white/25 hover:text-white/60 transition-colors"
            title={expanded ? "Hide steps" : "Show steps"}
          >
            <ChevronDown
              size={13}
              className={cn(
                "transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          </button>
        </div>
      </div>

      {/* Expanded step-by-step detail */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-4 pb-4 pt-3">
          <div className="pl-7">
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/25 mb-2.5">
              How to complete
            </p>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-[10px] font-mono text-white/20 shrink-0 pt-px w-3.5 text-right">
                    {i + 1}.
                  </span>
                  <span className="text-[12px] text-white/50 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-[11px] text-blue-400/60 hover:text-blue-400 transition-colors"
              >
                <ExternalLink size={10} />
                {link.label}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionTitle({ Icon, title }: { Icon: typeof CheckCircle2; title: string }) {
  return (
    <h2 className="text-[11px] font-mono uppercase tracking-wider text-white/35 mb-4 flex items-center gap-1.5">
      <Icon size={12} /> {title}
    </h2>
  );
}

function StatCard({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-white/40 mt-0.5">{label}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-white/40">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function StatesGrid({
  verdicts,
  selectedProduct,
}: {
  verdicts: StateVerdict[];
  selectedProduct?: string | null;
}) {
  const filtered = selectedProduct
    ? verdicts.filter(
        (v) =>
          !v.products ||
          v.products.length === 0 ||
          v.products.some((p) => p.toLowerCase() === selectedProduct.toLowerCase())
      )
    : verdicts;

  if (!filtered.length) {
    return (
      <p className="text-sm text-white/30">
        {selectedProduct
          ? `No state-specific requirements found for ${selectedProduct}.`
          : "No state-level data available."}
      </p>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 gap-2.5">
      {filtered
        .slice()
        .sort((a, b) => statusRank(a.status) - statusRank(b.status))
        .map((s) => {
          const meta = STATUS_META[s.status];
          return (
            <div
              key={s.code}
              className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="text-sm font-medium text-white/85">{s.state}</span>
                  <span className="text-[10px] font-mono text-white/25">{s.code}</span>
                </div>
                <span className="text-[10px] font-mono shrink-0" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </div>
              {s.reasons.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {s.reasons.slice(0, 3).map((r, i) => (
                    <li key={i} className="text-[12px] text-white/55 leading-relaxed flex gap-1.5">
                      <span className="text-white/20">·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.key_regulations.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {s.key_regulations.slice(0, 4).map((r, i) => (
                    <span
                      key={i}
                      className="text-[10px] text-white/45 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function CountryDetail({
  country,
  status,
  score,
  reasons,
  regulations,
}: {
  country: string;
  status: MarketStatus;
  score: number;
  reasons: string[];
  regulations: string[];
}) {
  const meta = STATUS_META[status];
  const market = Object.values(MARKET_BY_ISO3).find((m) => m.name === country);
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <meta.Icon size={18} style={{ color: meta.color }} />
          <div>
            <p className="text-sm font-bold text-white">{country}</p>
            {market && <p className="text-[10px] font-mono text-white/30">{market.region}</p>}
          </div>
        </div>
        <span
          className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded border", meta.chip)}
          style={{ color: meta.color }}
        >
          {meta.label.toUpperCase()}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        {reasons.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-2">Why</p>
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={i} className="text-[13px] text-white/65 leading-relaxed flex gap-2">
                  <span className="text-white/20 mt-0.5">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {regulations.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-2">
              Key regulations
            </p>
            <div className="flex flex-wrap gap-1.5">
              {regulations.map((r, i) => (
                <span
                  key={i}
                  className="text-[11px] text-white/45 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 pt-4 border-t border-white/[0.05] mt-4">
        <div className="flex items-center justify-between text-[10px] font-mono text-white/30 mb-1.5">
          <span>MARKET RISK</span>
          <span style={{ color: meta.color }}>{score}/100</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${score}%`, backgroundColor: meta.color }}
          />
        </div>
      </div>
    </div>
  );
}

// ── StateDetail ───────────────────────────────────────────────────────────────

function StateDetail({
  verdict,
  onClose,
}: {
  verdict: StateVerdict | null;
  onClose: () => void;
}) {
  if (!verdict) {
    return (
      <div className="flex items-center justify-center h-full min-h-[120px]">
        <p className="text-[12px] text-white/30">No verdict data for this state.</p>
      </div>
    );
  }
  const meta = STATUS_META[verdict.status];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <meta.Icon size={16} style={{ color: meta.color }} />
          <div>
            <p className="text-sm font-bold text-white">{verdict.state}</p>
            <p className="text-[10px] font-mono text-white/30">{verdict.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn("text-[10px] font-mono font-bold px-2 py-0.5 rounded border", meta.chip)}
            style={{ color: meta.color }}
          >
            {meta.label.toUpperCase()}
          </span>
          <button
            onClick={onClose}
            className="text-white/25 hover:text-white/60 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {verdict.reasons.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-2">
            Requirements
          </p>
          <ul className="space-y-1.5">
            {verdict.reasons.map((r, i) => (
              <li key={i} className="text-[12px] text-white/65 leading-relaxed flex gap-2">
                <span className="text-white/20 mt-0.5 shrink-0">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.key_regulations.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-2">
            Key regulations
          </p>
          <div className="flex flex-wrap gap-1.5">
            {verdict.key_regulations.map((r, i) => (
              <span
                key={i}
                className="text-[11px] text-white/45 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {verdict.products && verdict.products.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/30 mb-2">
            Applies to
          </p>
          <div className="flex flex-wrap gap-1.5">
            {verdict.products.map((p, i) => (
              <span
                key={i}
                className="text-[11px] text-white/55 bg-white/[0.03] border border-white/[0.08] px-2 py-0.5 rounded flex items-center gap-1"
              >
                <Package size={9} className="text-white/30" />
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helper functions ──────────────────────────────────────────────────────────

function statusRank(s: MarketStatus): number {
  return s === "prohibited" ? 0 : s === "review" ? 1 : 2;
}

function severityColor(rank: number): string {
  return ["#ef4444", "#f97316", "#eab308", "#22c55e"][rank] ?? "#eab308";
}
