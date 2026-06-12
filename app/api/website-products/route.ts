import { NextRequest, NextResponse } from "next/server";
import { tavilySearch, tavilyExtract } from "@/lib/tavily";
import { extractProductsFromWebSearch } from "@/lib/ai";

export const maxDuration = 120;

function isUsableImage(url: unknown): url is string {
  return (
    typeof url === "string" &&
    /^https?:\/\//i.test(url) &&
    !/\.svg(\?|$)/i.test(url)
  );
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    // Extract the bare hostname for search queries (better signal than full URL).
    let hostname = normalizedUrl;
    try {
      hostname = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    } catch { /* fall back to raw url string */ }

    // Four parallel requests:
    //   1. Direct page extract  → actual HTML/text content of the URL
    //   2. Domain-scoped search → product listing pages indexed by Tavily
    //   3. Image search         → thumbnail pool for product cards
    //   4. Ingredient search    → product pages with nutrition/ingredient data
    const [extractSettled, textSettled, imageSettled, ingredientSettled] = await Promise.allSettled([
      tavilyExtract([normalizedUrl]),
      tavilySearch(`${hostname} products`, {
        maxResults: 8,
        timeRange: "year",
        includeDomains: [hostname],
      }),
      tavilySearch(`${hostname} products`, {
        maxResults: 6,
        includeImages: true,
        timeRange: "year",
      }),
      tavilySearch(`${hostname} ingredients nutrition facts`, {
        maxResults: 6,
        timeRange: "year",
        includeDomains: [hostname],
      }),
    ]);

    // Raw page content from the direct extract (most reliable signal).
    const extractText: string =
      extractSettled.status === "fulfilled"
        ? (
            (extractSettled.value?.results ?? []) as Array<{
              content?: string;
              raw_content?: string;
            }>
          )
            .map((r) => r.raw_content ?? r.content ?? "")
            .join("\n\n")
        : "";

    // Web search snippets as a fallback / supplement.
    const textResults =
      textSettled.status === "fulfilled"
        ? (textSettled.value?.results ?? []) as Array<{ title?: string; url?: string; content?: string; raw_content?: string }>
        : [];

    const ingredientResults =
      ingredientSettled.status === "fulfilled"
        ? (ingredientSettled.value?.results ?? []) as Array<{ title?: string; url?: string; content?: string; raw_content?: string }>
        : [];

    // Collect up to 3 product page URLs from search results for deep extraction.
    const productPageUrls = [
      ...textResults.map((r) => r.url).filter((u): u is string => !!u),
      ...ingredientResults.map((r) => r.url).filter((u): u is string => !!u),
    ]
      .filter((u) => u !== normalizedUrl)
      .slice(0, 3);

    const [productPagesSettled] = await Promise.allSettled([
      productPageUrls.length > 0 ? tavilyExtract(productPageUrls) : Promise.resolve(null),
    ]);

    const productPagesText: string =
      productPagesSettled.status === "fulfilled" && productPagesSettled.value
        ? (
            (productPagesSettled.value?.results ?? []) as Array<{
              content?: string;
              raw_content?: string;
            }>
          )
            .map((r) => r.raw_content ?? r.content ?? "")
            .join("\n\n---\n\n")
        : "";

    const searchText = [
      ...textResults,
      ...ingredientResults,
    ]
      .map((r) => `${r.title ?? ""}\n${r.raw_content ?? r.content ?? ""}`)
      .join("\n\n");

    // Combine: product sub-pages first (most likely to contain ingredient data
    // for Shopify/e-commerce brands), then the direct page extract, then search
    // snippets as a fallback supplement.
    const combinedText = [productPagesText, extractText, searchText]
      .filter((t) => t.trim().length > 0)
      .join("\n\n---\n\n");

    const extracted = combinedText.trim().length > 0
      ? await extractProductsFromWebSearch(normalizedUrl, combinedText)
      : null;

    const imagePool: string[] =
      imageSettled.status === "fulfilled"
        ? (
            ((imageSettled.value?.images ?? []) as Array<string | { url?: string }>)
              .map((i) => (typeof i === "string" ? i : i?.url))
              .filter(isUsableImage) as string[]
          )
        : [];

    const rawProducts = (extracted?.products ?? []).slice(0, 8);
    let poolIdx = 0;

    const products = rawProducts
      .map((p) => {
        let image: string | null = null;
        if (poolIdx < imagePool.length) {
          image = imagePool[poolIdx++];
        }
        return {
          name: (p.name ?? "").trim(),
          description: (p.description ?? "").trim(),
          image_url: image ?? null,
          ...(p.label_text?.trim() ? { label_text: p.label_text.trim() } : {}),
          ...(Array.isArray(p.certifications) && p.certifications.length
            ? { certifications: p.certifications }
            : {}),
          ...(p.packaging_language?.trim()
            ? { packaging_language: p.packaging_language.trim() }
            : {}),
        };
      })
      .filter((p) => p.name.length > 0);

    if (products.length === 0) {
      return NextResponse.json({
        products: [],
        description: extracted?.description ?? "",
        company_name: extracted?.company_name ?? "",
        message: "No products detected. Add them manually below.",
      });
    }

    return NextResponse.json({
      products,
      description: extracted?.description ?? "",
      company_name: extracted?.company_name ?? "",
    });
  } catch (err) {
    console.error("website-products error:", err);
    return NextResponse.json(
      { products: [], description: "", message: "Failed to analyze website." },
      { status: 200 }
    );
  }
}
