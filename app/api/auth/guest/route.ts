import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Creates a throwaway guest account so onboarding works without a sign-up form. */
export async function POST() {
  try {
    const id = crypto.randomUUID();
    const email = `guest-${id}@recall0.local`;
    const password = crypto.randomUUID();

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Could not start session" }, { status: 500 });
    }

    return NextResponse.json({ email, password });
  } catch {
    return NextResponse.json({ error: "Could not start session" }, { status: 500 });
  }
}
