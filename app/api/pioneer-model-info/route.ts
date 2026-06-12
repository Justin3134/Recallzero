import "server-only";
import { NextResponse } from "next/server";

const BASE_MODEL = "fastino/gliner2-base-v1";

export async function GET() {
  const modelId = process.env.PIONEER_GLINER_MODEL ?? BASE_MODEL;
  return NextResponse.json({
    modelId,
    isFineTuned: modelId !== BASE_MODEL,
    hasApiKey: !!process.env.PIONEER_API_KEY,
  });
}
