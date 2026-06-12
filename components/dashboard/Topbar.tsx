"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Bell, LogOut, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function Topbar({
  companyName,
  userEmail,
  lastScanned,
  unreadCount,
}: {
  companyName: string;
  userEmail: string | null;
  lastScanned: string | null;
  unreadCount: number;
}) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);

  async function runScan() {
    if (scanning) return;
    setScanning(true);
    try {
      await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      router.refresh();
    } finally {
      setScanning(false);
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/onboarding");
    router.refresh();
  }

  const initials = (userEmail ?? "U")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="h-14 border-b border-[#1f1f23] bg-[#111113] flex items-center justify-between px-6 sticky top-0 z-20">
      <div className="flex items-center gap-5 min-w-0">
        <span className="font-medium text-sm text-white truncate">{companyName}</span>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] shrink-0" />
          <span className="font-mono">
            {scanning ? "Scanning..." : `Scanned ${timeAgo(lastScanned)}`}
          </span>
          <button
            onClick={runScan}
            disabled={scanning}
            title="Run live scan now"
            className="ml-1 text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-30"
          >
            <RefreshCw size={11} className={cn(scanning && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Link href="/alerts" className="relative text-zinc-500 hover:text-zinc-200 transition-colors">
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <div className="w-px h-4 bg-[#1f1f23]" />

        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white">
            {initials}
          </div>
          <span className="hidden sm:block text-xs text-zinc-500 truncate max-w-32">
            {userEmail}
          </span>
          <button
            onClick={logout}
            title="Log out"
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
