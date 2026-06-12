"use client";

import { defineComponent, createLibrary } from "@openuidev/react-lang";
import {
  openuiChatLibrary,
  openuiChatComponentGroups,
  openuiChatAdditionalRules,
  openuiChatExamples,
} from "@openuidev/react-ui/genui-lib";
import type { PromptOptions } from "@openuidev/react-lang";
import { z } from "zod/v4";

const RISK_COLORS = {
  low: { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.3)", text: "#22c55e" },
  medium: { bg: "rgba(234,179,8,0.1)", border: "rgba(234,179,8,0.3)", text: "#eab308" },
  high: { bg: "rgba(249,115,22,0.1)", border: "rgba(249,115,22,0.3)", text: "#f97316" },
  critical: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", text: "#ef4444" },
} as const;

const STATUS_COLORS = {
  allowed: { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.3)", text: "#22c55e", label: "CLEAR" },
  review: { bg: "rgba(234,179,8,0.1)", border: "rgba(234,179,8,0.3)", text: "#eab308", label: "REVIEW" },
  prohibited: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", text: "#ef4444", label: "BLOCKED" },
} as const;

const RegOverview = defineComponent({
  name: "RegOverview",
  description:
    "Regulatory jurisdiction banner. Use as the first child of Card to establish context — shows the regulation title, jurisdiction, risk level, and a short summary.",
  props: z.object({
    title: z.string().describe("Regulation or topic title"),
    jurisdiction: z.string().describe("Jurisdiction name, e.g. 'European Union', 'United States – FDA'"),
    risk_level: z
      .enum(["low", "medium", "high", "critical"])
      .describe("Compliance risk level"),
    summary: z.string().describe("1–2 sentence plain-language overview"),
  }),
  component: ({ props }) => {
    const c = RISK_COLORS[props.risk_level] ?? RISK_COLORS.medium;
    return (
      <div
        style={{
          padding: "12px 16px",
          borderRadius: "8px",
          border: `1px solid ${c.border}`,
          backgroundColor: c.bg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "6px",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--openui-text-default, #fff)",
              lineHeight: 1.3,
            }}
          >
            {props.title}
          </span>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: c.text,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {props.risk_level} risk
          </span>
        </div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--openui-text-subtle, rgba(255,255,255,0.5))",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: "8px",
          }}
        >
          {props.jurisdiction}
        </div>
        <p
          style={{
            fontSize: "13px",
            color: "var(--openui-text-default, rgba(255,255,255,0.85))",
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          {props.summary}
        </p>
      </div>
    );
  },
});

const SourceCard = defineComponent({
  name: "SourceCard",
  description:
    "A clickable regulatory source citation with title, URL, and optional date. Use inside a sources SectionBlock.",
  props: z.object({
    title: z.string().describe("Source title or agency name"),
    url: z.string().describe("Full URL to the official source"),
    date: z.string().optional().describe("Publication or last-updated date (e.g. '2024-03-15')"),
  }),
  component: ({ props }) => (
    <a
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 10px",
        borderRadius: "6px",
        border: "1px solid var(--openui-stroke-default, rgba(255,255,255,0.12))",
        backgroundColor: "var(--openui-bg-subtle, rgba(255,255,255,0.05))",
        textDecoration: "none",
        color: "var(--openui-text-default, #fff)",
        fontSize: "12px",
        marginRight: "6px",
        marginBottom: "6px",
        cursor: "pointer",
        transition: "background-color 0.1s",
      }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
        <path
          d="M2 2h3.5m4.5 0v3.5M9 3l-6 6M3.5 10H2a1 1 0 01-1-1V3a1 1 0 011-1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{props.title}</span>
      {props.date && (
        <span
          style={{
            color: "var(--openui-text-subtle, rgba(255,255,255,0.4))",
            fontSize: "11px",
            borderLeft: "1px solid rgba(255,255,255,0.15)",
            paddingLeft: "6px",
          }}
        >
          {props.date}
        </span>
      )}
    </a>
  ),
});

const MarketStatusCard = defineComponent({
  name: "MarketStatusCard",
  description:
    "Shows a market's live compliance status from the user's scan data. ONLY use when citing the user's actual compliance scan results — never for general information.",
  props: z.object({
    country: z.string().describe("Country or market name"),
    status: z.enum(["allowed", "review", "prohibited"]).describe("Compliance verdict"),
    score: z.number().min(0).max(100).describe("Compliance score 0–100"),
    reason: z.string().describe("Primary reason for this status in one sentence"),
  }),
  component: ({ props }) => {
    const s = STATUS_COLORS[props.status] ?? STATUS_COLORS.review;
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: "8px",
          border: `1px solid ${s.border}`,
          backgroundColor: s.bg,
          display: "inline-flex",
          flexDirection: "column",
          gap: "4px",
          minWidth: "150px",
          margin: "4px",
          verticalAlign: "top",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--openui-text-default, #fff)" }}>
            {props.country}
          </span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: s.text }}>{s.label}</span>
        </div>
        <p
          style={{
            fontSize: "11px",
            color: "var(--openui-text-subtle, rgba(255,255,255,0.55))",
            lineHeight: 1.4,
            margin: 0,
          }}
        >
          {props.reason}
        </p>
        <div
          style={{
            height: "3px",
            borderRadius: "2px",
            backgroundColor: "rgba(255,255,255,0.08)",
            marginTop: "4px",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${props.score}%`,
              borderRadius: "2px",
              backgroundColor: s.text,
            }}
          />
        </div>
      </div>
    );
  },
});

export const researchLibrary = createLibrary({
  root: "Card",
  componentGroups: [
    ...openuiChatComponentGroups,
    {
      name: "Compliance",
      components: ["RegOverview", "SourceCard", "MarketStatusCard"],
      notes: [
        "- RegOverview: Use as the FIRST child of Card on every research response.",
        "- SourceCard: Use for each cited source. Group source cards in a SectionBlock(items, false) titled 'Sources'.",
        "- MarketStatusCard: ONLY use when referencing the user's own scan data — never for general info.",
        "- MarketStatusCards can be placed inside a SectionBlock for a clean grid display.",
      ],
    },
  ],
  components: [
    ...Object.values(openuiChatLibrary.components),
    RegOverview,
    SourceCard,
    MarketStatusCard,
  ],
});

const RESEARCH_EXAMPLE = `Example — Regulatory Research Response:

root = Card([overview, sections, sources, followups])
overview = RegOverview("EU Food Information to Consumers", "European Union", "high", "Regulation 1169/2011 mandates 14 mandatory label elements for all packaged food sold in the EU. Non-compliance can result in product withdrawal and significant fines.")
sections = SectionBlock([s1, s2, s3])
s1 = SectionItem("mandatory", "14 Mandatory Label Elements", [reqList])
reqList = ListBlock([r1, r2, r3, r4, r5])
r1 = ListItem("Name & description of food", "Must accurately describe the product.")
r2 = ListItem("Ingredient list with allergens highlighted", "Bold, italic, or underline required for the 14 major allergens.")
r3 = ListItem("Net quantity declaration", "Volume or weight in metric units.")
r4 = ListItem("Date of minimum durability or use-by date", "'Best before' or 'Use by' — format varies by product type.")
r5 = ListItem("Nutrition declaration", "Per 100g/ml: energy, fat, saturates, carbs, sugars, protein, salt.")
s2 = SectionItem("risks", "Key Compliance Risks", [riskNote])
riskNote = Callout("warning", "Upcoming Change", "EU is reviewing Regulation 1169/2011 — digital labelling and origin rules expected to tighten in 2026.")
s3 = SectionItem("enforcement", "Enforcement", [enfText])
enfText = TextContent("Member states enforce independently. UK has equivalent rules post-Brexit via UK Food Information Regulations 2014.", "default")
sources = SectionBlock([s_1, s_2, s_3], false)
s_1 = SourceCard("EUR-Lex — Regulation 1169/2011", "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32011R1169", "2011-10-25")
s_2 = SourceCard("EFSA — Nutrition & Labelling", "https://www.efsa.europa.eu/en/topics/topic/nutrition", "2024-01-15")
s_3 = SourceCard("EC — Food Safety Labelling", "https://food.ec.europa.eu/food-safety/labelling-and-nutrition_en", "2023-12-01")
followups = FollowUpBlock([fu1, fu2, fu3])
fu1 = FollowUpItem("How does UK labelling differ after Brexit?")
fu2 = FollowUpItem("Generate a compliance checklist for our EU products")
fu3 = FollowUpItem("What are the penalties for non-compliance?")`;

const MARKET_REPORT_EXAMPLE = `Example — User's Market Compliance Report:

root = Card([header, marketGrid, actions, followups])
header = CardHeader("Your Compliance Status — Top Markets", "Based on your most recent product scans")
marketGrid = SectionBlock([grid], false)
grid = SectionItem("markets", "Market Overview", [m1, m2, m3, m4])
m1 = MarketStatusCard("United States", "allowed", 87, "Products meet FDA labelling standards. Minor sodium disclosure update needed.")
m2 = MarketStatusCard("European Union", "review", 61, "Regulation 1169/2011 allergen declarations need updating on 3 products.")
m3 = MarketStatusCard("United Kingdom", "review", 58, "Post-Brexit QUID rules require ingredient percentage declarations.")
m4 = MarketStatusCard("Australia", "prohibited", 24, "TGA approval required for health claims made on 2 product labels.")
actions = SectionBlock([a1])
a1 = SectionItem("actions", "Priority Actions", [actionSteps])
actionSteps = Steps([step1, step2, step3])
step1 = StepsItem("Update EU allergen declarations on Products A, B, C — deadline Q2 2025")
step2 = StepsItem("Add QUID percentages for UK market — affects 4 SKUs")
step3 = StepsItem("Remove TGA-regulated health claims before entering Australian market")
followups = FollowUpBlock([fu1, fu2, fu3])
fu1 = FollowUpItem("Show me the detailed findings for the EU issues")
fu2 = FollowUpItem("What would full EU compliance cost us?")
fu3 = FollowUpItem("Compare our status to last quarter")`;

export const researchPromptOptions: PromptOptions = {
  preamble:
    "You are Reg Research — a regulatory compliance research assistant built into Recall0, a compliance management platform. You help product teams understand global regulations, check their compliance status, and plan remediation steps. You generate structured, interactive compliance briefs using OpenUI Lang. Be precise, cite real sources, and always make the information actionable.",
  additionalRules: [
    ...openuiChatAdditionalRules,
    "ALWAYS start every Card with a RegOverview as the first child — it establishes context.",
    "ALWAYS end every Card with a FollowUpBlock with exactly 3 relevant suggested questions.",
    "Use SourceCard for all cited sources. Group them in a SectionBlock([...sources], false) titled 'Sources'.",
    "Use MarketStatusCard ONLY when referencing the user's actual compliance data provided in context.",
    "Use SectionBlock to organise long responses into: Requirements, Risks & Deadlines, Enforcement, Sources.",
    "Use Callout(variant='warning') for upcoming regulatory deadlines or recent changes.",
    "Use Steps/StepsItem for compliance checklists — numbered, actionable steps.",
    "Use Table to compare multiple markets, regulations, or products side by side.",
    "Never invent regulatory citations. If unsure of a specific URL, use the agency's homepage.",
    "Do NOT include raw markdown URLs like [text](url) in TextContent — use SourceCard instead.",
    "Keep TextContent concise. Break complex rules into ListBlock items for scannability.",
    // Product-specific rules (active when PRODUCT SCAN DATA is in context)
    "When PRODUCT SCAN DATA is in context: always reference the user's actual ingredients and findings — never make up ingredient lists.",
    "For ingredient reformulation requests: use a Table(Current Ingredient | Status | Compliant Alternative) followed by a revised full ingredient declaration, then Steps for the action plan.",
    "For compliance checklist requests: pull directly from the product's actual findings and order steps by severity (critical first). Each step must name the regulation, the violation, and the exact fix.",
    "For chart/graph requests: use BarChart or HorizontalBarChart for compliance scores, PieChart for severity distribution. Always use real numbers from PRODUCT SCAN DATA.",
    "For market entry questions: state the user's current verdict (from PRODUCT SCAN DATA), then explain regulatory requirements, then show what specifically needs fixing with Steps.",
    "ALWAYS end ingredient reformulation responses with Callout(variant='warning') reminding the user to verify with a certified food safety consultant.",
  ],
  examples: [...openuiChatExamples, RESEARCH_EXAMPLE, MARKET_REPORT_EXAMPLE],
};
