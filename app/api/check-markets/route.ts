import { NextRequest, NextResponse } from "next/server";
import { runMarketAnalysis } from "@/lib/compliance";
import type { ProductInput } from "@/types";

export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, products, market_scope } = body as {
      category: string;
      products: ProductInput[];
      market_scope?: string;
    };

    if (!products?.length) {
      return NextResponse.json({ error: "Missing products" }, { status: 400 });
    }

    const result = await runMarketAnalysis({
      category: category || "general consumer products",
      products,
      market_scope,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Market check failed:", err);
    return NextResponse.json({ error: "Market check failed" }, { status: 500 });
  }
}
