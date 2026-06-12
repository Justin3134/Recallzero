import { NextRequest, NextResponse } from "next/server";
import { submitPioneerFeedback } from "@/lib/pioneer";

export async function POST(req: NextRequest) {
  try {
    const { inferenceId, correct, correctedOutput } = await req.json();

    if (!inferenceId || typeof inferenceId !== "string") {
      return NextResponse.json({ error: "inferenceId is required" }, { status: 400 });
    }
    if (typeof correct !== "boolean") {
      return NextResponse.json({ error: "correct must be a boolean" }, { status: 400 });
    }

    await submitPioneerFeedback(
      inferenceId,
      correct,
      correctedOutput ?? undefined
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Pioneer feedback route failed:", err);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}
