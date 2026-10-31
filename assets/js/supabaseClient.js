import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use the project's URL and publishable/anon key. Never put a service-role key here.
const SUPABASE_URL = "https://xnqdoxahgwmbmirsaukn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kgRwgMAbQUWtoux-A5B1OA_rOc8WAf7";
const configured = !SUPABASE_URL.includes("YOUR_PROJECT_ID")
  && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

export const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

export function createIsolatedAuthClient() {
  if (!configured) throw new Error("Supabase is not configured.");
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export const isSupabaseConfigured = configured;
