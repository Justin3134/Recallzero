import { NextRequest, NextResponse } from "next/server";
import { parseFile } from "@/lib/parser";
import { extractProductFromLabel } from "@/lib/ai";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = await parseFile(buffer, file.type, file.name);
    } catch {
      return NextResponse.json(
        { error: "Unsupported or unreadable file. Use PDF, PNG, JPG, DOCX, CSV, or TXT." },
        { status: 400 }
      );
    }

    if (!parsed.text || parsed.text.trim().length < 10) {
      return NextResponse.json(
        { error: "Could not read text from this file. Try a clearer photo or a different file." },
        { status: 400 }
      );
    }

    const labelText = parsed.text.trim();
    const fallbackName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60);

    // Derive a clean product name from the label text (best effort).
    const derived = await extractProductFromLabel(labelText, fallbackName);

    return NextResponse.json({
      product: {
        name: derived.name || fallbackName || "Uploaded product",
        description: derived.description ?? "",
        image_url: null,
        label_text: labelText.slice(0, 6000),
      },
    });
  } catch (err) {
    console.error("extract-product error:", err);
    return NextResponse.json({ error: "Failed to read product file" }, { status: 500 });
  }
}
