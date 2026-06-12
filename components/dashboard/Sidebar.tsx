"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { LayoutDashboard, FileSearch, FlaskConical, Settings, Radio } from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, badge: false },
  { href: "/scan", label: "Document Scan", icon: FileSearch, badge: false },
  { href: "/research", label: "Reg Research", icon: FlaskConical, badge: false },
  { href: "/live", label: "Live", icon: Radio, badge: true },
  { href: "/settings", label: "Settings", icon: Settings, badge: false },
];

export function Sidebar({ unreadCount: _ }: { unreadCount: number }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-col bg-black shrink-0 border-r border-[#1a1a1a]">
      <div className="px-5 h-14 flex items-center border-b border-[#1a1a1a]">
        <Link href="/" className="flex items-center">
          <Logo className="text-[15px]" />
        </Link>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-px">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors duration-100",
                active
                  ? "bg-white/[0.08] text-white"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
              )}
            >
              <Icon size={15} className={cn(active ? "text-white" : "text-zinc-600")} />
              {item.label}
              {item.badge && (
                <span className="ml-auto flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-[#1a1a1a]">
        <Link
          href="/onboarding"
          className="flex items-center gap-2 text-[11px] font-medium text-[#22c55e]/80 hover:text-[#22c55e] transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
          New compliance check
        </Link>
      </div>
    </aside>
  );
}
