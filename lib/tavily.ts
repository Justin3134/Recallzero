import "server-only";

const TAVILY_BASE = "https://api.tavily.com";

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
  };
}

async function tavilyFetch(path: string, body: object, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${TAVILY_BASE}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Search: real-time news + updates from regulatory bodies. */
export async function tavilySearch(
  query: string,
  options?: {
    timeRange?: "day" | "week" | "month" | "year" | null;
    includeDomains?: string[];
    maxResults?: number;
    topic?: "news" | "general";
    includeImages?: boolean;
    includeImageDescriptions?: boolean;
  }
) {
  return tavilyFetch("/search", {
    query,
    search_depth: "advanced",
    max_results: options?.maxResults ?? 8,
    topic: options?.topic ?? "general",
    ...(options?.timeRange != null ? { time_range: options.timeRange } : {}),
    include_domains: options?.includeDomains ?? [],
    chunks_per_source: 3,
    ...(options?.includeImages ? { include_images: true } : {}),
    ...(options?.includeImageDescriptions ? { include_image_descriptions: true } : {}),
  });
}

/** Extract: pull structured content from specific regulatory pages. */
export async function tavilyExtract(urls: string[]) {
  return tavilyFetch("/extract", { urls }, 45000);
}

/** Crawl: deep crawl a regulatory agency's site. */
export async function tavilyCrawl(url: string, maxDepth = 1, instructions?: string) {
  return tavilyFetch(
    "/crawl",
    {
      url,
      max_depth: maxDepth,
      limit: 20,
      ...(instructions ? { instructions } : {}),
    },
    90000
  );
}

/** Research: multi-source synthesis on a regulatory topic. Returns a request that may need polling. */
export async function tavilyResearch(
  query: string,
  outputSchema?: object,
  model: "mini" | "pro" | "auto" = "mini"
) {
  const body: Record<string, unknown> = {
    input: query,
    model,
    stream: false,
  };
  if (outputSchema) body.output_schema = outputSchema;
  return tavilyFetch("/research", body, 120000);
}

/** Poll a research task until complete. */
export async function pollResearch(requestId: string) {
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${TAVILY_BASE}/research/${requestId}`, {
      headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    });
    const data = await res.json();
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error("Research task failed");
  }
  throw new Error("Research task timed out");
}
