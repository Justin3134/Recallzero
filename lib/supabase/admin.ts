import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Server-only privileged client (bypasses RLS). Never import in client components. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
