"use client";

import { useRef, useCallback, useMemo } from "react";
import { FullScreen } from "@openuidev/react-ui";
import type { Thread, Message, UserMessage } from "@openuidev/react-headless";
import { researchLibrary } from "@/lib/research-library";
import { useRecentChecks } from "@/hooks/useRecentChecks";
import type { ComplianceAnalysis, ProductInput } from "@/types";
import "@openuidev/react-ui/defaults.css";
import "@openuidev/react-ui/components.css";
import "./research-panel.css";

// ── localStorage persistence ───────────────────────────────────────────────────

const THREADS_KEY = "recall0:research_threads";
const MESSAGES_PREFIX = "recall0:research_messages:";
const MAX_THREADS = 20;
const MAX_MESSAGES_PER_THREAD = 200;

function readThreads(): Thread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    return raw ? (JSON.parse(raw) as Thread[]) : [];
  } catch {
    return [];
  }
}

function writeThreads(threads: Thread[]): void {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
  } catch {}
}

function readMessages(threadId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${MESSAGES_PREFIX}${threadId}`);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function writeMessages(threadId: string, messages: Message[]): void {
  try {
    localStorage.setItem(
      `${MESSAGES_PREFIX}${threadId}`,
      JSON.stringify(messages.slice(-MAX_MESSAGES_PER_THREAD))
    );
  } catch {}
}

function removeMessages(threadId: string): void {
  try {
    localStorage.removeItem(`${MESSAGES_PREFIX}${threadId}`);
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the ingredients section from a product label and build a concise
 * context string that includes findings mapped to specific ingredients.
 */
function formatProductContext(
  products: ProductInput[],
  analysis: ComplianceAnalysis
): string {
  const lines: string[] = [];

  const productNames = products.map((p) => p.name).join(", ");
  lines.push(`COMPLIANCE SCAN RESULTS — ${productNames}`);
  lines.push(
    `Overall status: ${analysis.overall_status.toUpperCase()} | Risk score: ${analysis.overall_score}/100`
  );
  if (analysis.summary) lines.push(`Summary: ${analysis.summary}`);

  lines.push(`\nPRODUCTS:`);
  products.slice(0, 6).forEach((p) => {
    const findings = analysis.product_findings.filter(
      (f) => f.product.toLowerCase() === p.name.toLowerCase()
    );

    lines.push(`\n${p.name}:`);
    if (p.description) lines.push(`  Description: ${p.description}`);

    if (p.label_text) {
      // Try to pull just the ingredients block
      const ingMatch = p.label_text.match(
        /ingredients[:\s]([\s\S]*?)(?:contains[:\s]|may contain[:\s]|\n\n|$)/i
      );
      if (ingMatch?.[1]?.trim()) {
        lines.push(`  Ingredients: ${ingMatch[1].trim().slice(0, 600)}`);
      } else {
        lines.push(`  Label: ${p.label_text.slice(0, 400)}`);
      }
    }

    if (findings.length) {
      lines.push(`  Compliance findings (${findings.length}):`);
      findings.slice(0, 8).forEach((f) => {
        lines.push(`    [${f.severity.toUpperCase()}] ${f.issue}`);
        lines.push(`      Regulation: ${f.regulation}`);
        lines.push(`      Required action: ${f.action}`);
      });
    } else {
      lines.push(`  Compliance: No issues found`);
    }
  });

  // Market summary
  const blocked = analysis.country_verdicts.filter((v) => v.status === "prohibited");
  const review = analysis.country_verdicts.filter((v) => v.status === "review");
  const allowed = analysis.country_verdicts.filter((v) => v.status === "allowed");

  lines.push(`\nMARKET STATUS:`);
  if (allowed.length)
    lines.push(
      `  Clear (${allowed.length}): ${allowed
        .slice(0, 8)
        .map((v) => v.country)
        .join(", ")}`
    );
  if (review.length)
    lines.push(
      `  Needs review (${review.length}): ${review
        .slice(0, 8)
        .map((v) => v.country)
        .join(", ")}`
    );
  if (blocked.length)
    lines.push(
      `  Blocked (${blocked.length}): ${blocked
        .slice(0, 8)
        .map((v) => v.country)
        .join(", ")}`
    );

  return lines.join("\n");
}

/**
 * Build product-specific conversation starters when product data is available,
 * or fall back to generic regulatory starters otherwise.
 */
function buildSuggestions(
  industry: string | undefined,
  products: ProductInput[],
  analysis: ComplianceAnalysis | null
): { displayText: string; prompt: string }[] {
  if (!products.length || !analysis) {
    const generic = [
      industry
        ? `EU labeling requirements for ${industry}`
        : "EU food & supplement labeling requirements",
      "Show me my compliance status across markets",
      "California Prop 65 — what applies to my products?",
      "Which regulations are changing in the next 6 months?",
    ];
    return generic.map((s) => ({ displayText: s, prompt: s }));
  }

  const first = products[0];
  const allNames = products.map((p) => p.name).join(", ");

  const blockedMarkets = analysis.country_verdicts
    .filter((v) => v.status === "prohibited")
    .map((v) => v.country);
  const reviewMarkets = analysis.country_verdicts
    .filter((v) => v.status === "review")
    .map((v) => v.country);
  const targetMarket = blockedMarkets[0] ?? reviewMarkets[0] ?? "China";

  const hasMultiple = products.length > 1;

  return [
    {
      displayText: `Rewrite ingredients for ${first.name} — ${targetMarket} compliant`,
      prompt: `My product ${first.name} is blocked or needs review in ${targetMarket}. Based on its current ingredient list and the compliance findings, write me a new compliant ingredient list that would pass ${targetMarket} regulations. Explain what to remove, replace, or add.`,
    },
    {
      displayText: `Compliance checklist — ${first.name} for EU market`,
      prompt: `Create a step-by-step compliance checklist for ${first.name} to meet EU food labeling and safety requirements. Include specific actions for each compliance finding and prioritize by urgency.`,
    },
    {
      displayText: `Show a comparison chart of ${hasMultiple ? "all my products" : first.name} across markets`,
      prompt: `Show me a visual comparison chart of compliance scores for ${allNames} across all markets. Highlight which markets are blocked and which need review.`,
    },
    {
      displayText: `What's blocking ${first.name} from ${targetMarket}? Full breakdown`,
      prompt: `Give me a full breakdown of why ${first.name} is blocked or needs review in ${targetMarket}. List every specific regulation that applies, what changes are needed in the ingredient list and labeling, and the estimated effort to fix each issue.`,
    },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ResearchPanel({
  companyName,
  industry,
  markets = [],
}: {
  companyName: string;
  industry?: string;
  markets?: string[];
}) {
  const { checks } = useRecentChecks();
  // Most recent saved compliance check — has products + full analysis
  const latestCheck = checks[0] ?? null;
  const products: ProductInput[] = latestCheck?.products ?? [];
  const analysis: ComplianceAnalysis | null = latestCheck?.analysis ?? null;

  // Seed from localStorage so threads survive navigation + browser-tab switches
  const threadsRef = useRef<Thread[]>(readThreads());

  const fetchThreadList = useCallback(async () => ({ threads: threadsRef.current }), []);

  const createThread = useCallback(async (_firstMessage: UserMessage): Promise<Thread> => {
    const thread: Thread = {
      id: crypto.randomUUID(),
      title: "New Research",
      createdAt: Date.now(),
    };
    threadsRef.current = [thread, ...threadsRef.current];
    writeThreads(threadsRef.current);
    return thread;
  }, []);

  const deleteThread = useCallback(async (id: string): Promise<void> => {
    threadsRef.current = threadsRef.current.filter((t) => t.id !== id);
    writeThreads(threadsRef.current);
    removeMessages(id);
  }, []);

  const updateThread = useCallback(async (thread: Thread): Promise<Thread> => {
    threadsRef.current = threadsRef.current.map((t) =>
      t.id === thread.id ? thread : t
    );
    writeThreads(threadsRef.current);
    return thread;
  }, []);

  // Restore messages from localStorage when switching threads
  const loadThread = useCallback(async (id: string): Promise<Message[]> => {
    return readMessages(id);
  }, []);

  const companyContext = [
    companyName,
    industry,
    markets.length ? `markets: ${markets.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Rich product + ingredient + findings context built from localStorage
  const productContext = useMemo<string | null>(() => {
    if (!products.length || !analysis) return null;
    return formatProductContext(products, analysis);
  }, [products, analysis]);

  const processMessage = useCallback(
    async (params: {
      threadId: string;
      messages: Message[];
      abortController: AbortController;
    }): Promise<Response> => {
      // Persist user messages immediately so they survive tab switches
      writeMessages(params.threadId, params.messages);

      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: params.abortController.signal,
        body: JSON.stringify({
          messages: params.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: "content" in m ? m.content : "",
          })),
          companyContext,
          // Pass product data so the API can inject it into the system prompt
          productContext: productContext ?? undefined,
        }),
      });

      if (!response.ok || !response.body) return response;

      // Tee the stream: one copy for OpenUI to render, one to persist the reply
      const [streamForUI, streamForSave] = response.body.tee();

      (async () => {
        let assistantContent = "";
        const reader = streamForSave.getReader();
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const event = JSON.parse(data) as { type: string; delta?: string };
                if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
                  assistantContent += event.delta;
                }
              } catch {}
            }
          }
        } catch {
          // Aborted — partial content is fine, don't overwrite a clean save
        } finally {
          reader.releaseLock();
          if (assistantContent) {
            const assistantMsg = {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: assistantContent,
              createdAt: Date.now(),
            };
            writeMessages(params.threadId, [...params.messages, assistantMsg]);
          }
        }
      })();

      return new Response(streamForUI, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    [companyContext, productContext]
  );

  const suggestions = useMemo(
    () => buildSuggestions(industry, products, analysis),
    [industry, products, analysis]
  );

  const welcomeDescription = products.length
    ? `${products.length} product${products.length > 1 ? "s" : ""} loaded — ask for reformulated ingredient lists, market-specific checklists, compliance charts, or regulatory deep-dives on any finding.`
    : "Ask about global regulations, your compliance status, or market requirements.";

  return (
    <div className="research-panel-shell">
      <FullScreen
        agentName="Reg Research"
        componentLibrary={researchLibrary}
        theme={{ mode: "dark" }}
        welcomeMessage={{
          title: "Regulatory Research",
          description: welcomeDescription,
        }}
        conversationStarters={{
          variant: "long",
          options: suggestions,
        }}
        processMessage={processMessage}
        fetchThreadList={fetchThreadList}
        createThread={createThread}
        deleteThread={deleteThread}
        updateThread={updateThread}
        loadThread={loadThread}
      />
    </div>
  );
}
