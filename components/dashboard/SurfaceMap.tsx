"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";
import { ChevronDown, ExternalLink, Loader2, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/severity";
import type { Alert, SurfaceAgency } from "@/types";

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

const TREEMAP_FILLS = ["#27272a", "#3f3f46", "#52525b", "#71717a", "#18181b", "#1c1c1f"];

interface TreemapNode {
  name: string;
  size: number;
  fill: string;
  [key: string]: string | number;
}

function TreemapCell(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  fill?: string;
  onClick?: (name: string) => void;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", fill } = props;
  if (width < 4 || height < 4) return null;
  return (
    <g
      onClick={() => props.onClick?.(name)}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        fill={fill}
        fillOpacity={0.9}
        stroke="#09090b"
        strokeWidth={2}
      />
      {width > 70 && height > 28 && (
        <text
          x={x + 10}
          y={y + 20}
          fill="#f8fafc"
          fontSize={11}
          fontWeight={600}
          pointerEvents="none"
          fontFamily="Inter, sans-serif"
        >
          {name.length > Math.floor(width / 7) ? name.slice(0, Math.floor(width / 7)) + "…" : name}
        </text>
      )}
    </g>
  );
}

export function SurfaceMap({
  surface,
  alerts,
}: {
  surface: SurfaceAgency[];
  alerts: Alert[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const lastAlertByAgency = useMemo(() => {
    const map = new Map<string, Alert>();
    for (const a of alerts) {
      const key = a.agency.toLowerCase();
      if (!map.has(key)) map.set(key, a);
    }
    return map;
  }, [alerts]);

  const treemapData: TreemapNode[] = useMemo(
    () =>
      surface.map((s, i) => ({
        name: s.agency,
        size: Math.max(0.1, s.relevance_score) * 100,
        fill: TREEMAP_FILLS[i % TREEMAP_FILLS.length],
      })),
    [surface]
  );

  const rows = filter ? surface.filter((s) => s.agency === filter) : surface;

  async function scanAgency(agency: string) {
    setScanning(agency);
    setScanMessage(null);
    try {
      const res = await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agency }),
      });
      const data = await res.json();
      setScanMessage(
        res.ok
          ? `${agency}: ${data.count} new alert${data.count === 1 ? "" : "s"} found`
          : `Scan failed for ${agency}`
      );
      router.refresh();
    } catch {
      setScanMessage(`Scan failed for ${agency}`);
    } finally {
      setScanning(null);
    }
  }

  function matchAlert(agency: string): Alert | undefined {
    const key = agency.toLowerCase();
    for (const [k, v] of lastAlertByAgency) {
      if (k.includes(key.split(" ")[0]) || key.includes(k.split(" ")[0])) return v;
    }
    return undefined;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Regulatory exposure by agency</h3>
          {filter && (
            <button
              onClick={() => setFilter(null)}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-2.5 py-1 transition-colors"
            >
              Clear filter: {filter} ×
            </button>
          )}
        </div>
        <div className="h-56 rounded-lg overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              isAnimationActive={false}
              content={<TreemapCell onClick={(name) => setFilter(name)} />}
            >
              <Tooltip
                cursor={false}
                content={({ payload }) => {
                  const node = payload?.[0]?.payload as TreemapNode | undefined;
                  if (!node) return null;
                  return (
                    <div className="bg-[#18181b] border border-border shadow-md rounded-lg px-3 py-1.5 text-xs">
                      <span className="font-semibold text-foreground">{node.name}</span>
                      <span className="text-muted-foreground ml-2 font-mono">
                        {(node.size / 100).toFixed(2)} relevance
                      </span>
                    </div>
                  );
                }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>
      </div>

      {scanMessage && (
        <p className="text-xs font-mono text-foreground bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2">
          {scanMessage}
        </p>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left bg-[#0f0f0f]">
              <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-medium">
                Agency
              </th>
              <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-medium hidden sm:table-cell">
                Jurisdiction
              </th>
              <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-medium hidden md:table-cell">
                Relevance
              </th>
              <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-medium">
                Priority
              </th>
              <th className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground font-medium hidden lg:table-cell">
                Last Alert
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const isOpen = expanded === s.agency;
              const lastAlert = matchAlert(s.agency);
              const priorityColor = PRIORITY_COLOR[s.priority] ?? "#eab308";
              return (
                <FragmentRow
                  key={s.id ?? s.agency}
                  open={isOpen}
                  onToggle={() => setExpanded(isOpen ? null : s.agency)}
                  mainRow={
                    <>
                      <td className="px-4 py-3 font-semibold text-foreground">{s.agency}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-[10px] font-mono border border-border px-1.5 py-0.5 rounded text-muted-foreground bg-background">
                          {s.jurisdiction}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                            <div
                              className="h-full bg-foreground rounded-full"
                              style={{ width: `${s.relevance_score * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-muted-foreground">
                            {(s.relevance_score ?? 0).toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded-md uppercase font-semibold"
                          style={{
                            color: priorityColor,
                            backgroundColor: `${priorityColor}15`,
                          }}
                        >
                          {s.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground font-mono">
                        {lastAlert ? timeAgo(lastAlert.created_at) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronDown
                          size={15}
                          className={cn(
                            "inline text-muted-foreground transition-transform",
                            isOpen && "rotate-180"
                          )}
                        />
                      </td>
                    </>
                  }
                  detail={
                    <div className="px-4 py-4 space-y-3 bg-background border-t border-border">
                      {s.relevance && (
                        <p className="text-sm text-muted-foreground">{s.relevance}</p>
                      )}
                      {s.key_regulations?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                            Key regulations
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {s.key_regulations.map((r) => (
                              <span
                                key={r}
                                className="text-[11px] bg-secondary border border-border text-foreground px-2 py-0.5 rounded-md"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            scanAgency(s.agency);
                          }}
                          disabled={scanning !== null}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold bg-foreground hover:bg-foreground/80 disabled:opacity-50 text-background px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {scanning === s.agency ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Radar size={12} />
                          )}
                          Scan now
                        </button>
                        {s.watch_urls?.[0] && (
                          <a
                            href={s.watch_urls[0]}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Agency site <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  }
                />
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10">
            No agencies mapped yet. Complete onboarding to build your surface.
          </p>
        )}
      </div>
    </div>
  );
}

function FragmentRow({
  open,
  onToggle,
  mainRow,
  detail,
}: {
  open: boolean;
  onToggle: () => void;
  mainRow: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors"
      >
        {mainRow}
      </tr>
      {open && (
        <tr className="border-b border-border last:border-0">
          <td colSpan={6}>{detail}</td>
        </tr>
      )}
    </>
  );
}
