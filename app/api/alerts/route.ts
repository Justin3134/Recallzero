import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!company) return NextResponse.json({ alerts: [] });

  const { data: alerts } = await supabase
    .from("alerts")
    .select("*")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return NextResponse.json({ alerts: alerts ?? [] });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const ids: string[] = body.ids ?? [];
  const isRead: boolean = body.is_read ?? true;

  if (ids.length === 0 && body.all) {
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (company) {
      await supabase
        .from("alerts")
        .update({ is_read: isRead })
        .eq("company_id", company.id);
    }
  } else if (ids.length > 0) {
    await supabase.from("alerts").update({ is_read: isRead }).in("id", ids);
  }

  return NextResponse.json({ ok: true });
}
