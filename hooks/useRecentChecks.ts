"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComplianceAnalysis, OverallStatus, ProductInput } from "@/types";

const STORAGE_KEY = "recall0:recent_checks";
const MAX_SAVED = 10;

export interface SavedCheck {
  id: string;
  companyName: string;
  date: string;
  overallStatus: OverallStatus;
  overallScore: number;
  products: ProductInput[];
  analysis: ComplianceAnalysis;
}

function readFromStorage(): SavedCheck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedCheck[];
  } catch {
    return [];
  }
}

function writeToStorage(checks: SavedCheck[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
  } catch {
    // quota exceeded or SSR — ignore
  }
}

export function useRecentChecks() {
  const [checks, setChecks] = useState<SavedCheck[]>([]);

  useEffect(() => {
    setChecks(readFromStorage());
  }, []);

  const saveCheck = useCallback(
    (
      companyName: string,
      products: ProductInput[],
      analysis: ComplianceAnalysis
    ) => {
      const entry: SavedCheck = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        companyName,
        date: new Date().toISOString(),
        overallStatus: analysis.overall_status,
        overallScore: analysis.overall_score,
        products,
        analysis,
      };

      setChecks((prev) => {
        // Deduplicate by company name — keep most recent
        const deduped = prev.filter(
          (c) => c.companyName.toLowerCase() !== companyName.toLowerCase()
        );
        const next = [entry, ...deduped].slice(0, MAX_SAVED);
        writeToStorage(next);
        return next;
      });
    },
    []
  );

  const removeCheck = useCallback((id: string) => {
    setChecks((prev) => {
      const next = prev.filter((c) => c.id !== id);
      writeToStorage(next);
      return next;
    });
  }, []);

  return { checks, saveCheck, removeCheck };
}
