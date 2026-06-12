import { NextRequest, NextResponse } from "next/server";
import { runRetailerAnalysis } from "@/lib/compliance";
import type { ProductInput } from "@/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { category, products } = body as {
      category: string;
      products: ProductInput[];
    };

    if (!products?.length) {
      return NextResponse.json({ error: "Missing products" }, { status: 400 });
    }

    const retailer_verdicts = await runRetailerAnalysis({
      category: category || "general consumer products",
      products,
    });

    return NextResponse.json({ retailer_verdicts });
  } catch (err) {
    console.error("Retailer check failed:", err);
    return NextResponse.json({ error: "Retailer check failed" }, { status: 500 });
  }
}
