import { NextRequest, NextResponse } from "next/server";
import { enrichProductLabel } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { productName, companyName } = await req.json();
    if (!productName) {
      return NextResponse.json({ error: "productName is required" }, { status: 400 });
    }

    const result = await enrichProductLabel(productName, companyName ?? undefined);
    return NextResponse.json({
      label_text: result?.label_text ?? null,
      certifications: result?.certifications ?? [],
      packaging_language: result?.packaging_language ?? null,
      source_url: result?.source_url ?? null,
      message: result?.label_text ? undefined : "Ingredient data not found on the product pages.",
    });
  } catch (err) {
    console.error("fetch-product-label error:", err);
    return NextResponse.json({ label_text: null, message: "Failed to fetch label data." }, { status: 200 });
  }
}
