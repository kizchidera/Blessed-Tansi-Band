import { createIsolatedAuthClient, isSupabaseConfigured, supabase } from "./supabaseClient.js";

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  if (!isSupabaseConfigured) throw new Error("Add your Supabase URL and publishable key to assets/js/supabaseClient.js first.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, fullName) {
  if (!isSupabaseConfigured) throw new Error("Add your Supabase URL and publishable key to assets/js/supabaseClient.js first.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
  if (error) throw error;
  return data;
}

export async function createAdminAccount(email, password, fullName) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Add your Supabase URL and publishable key to assets/js/supabaseClient.js first.");
  }

  const registrationClient = createIsolatedAuthClient();
  const { data, error } = await registrationClient.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  });
  if (error) throw error;
  if (!data.user) throw new Error("Supabase did not return the new account.");
  if (data.user.identities?.length === 0) {
    throw new Error("An account already exists for that email address.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .update({
      role: "admin",
      status: "approved",
      can_upload_minutes: true,
      can_verify_payments: true,
      can_view_financials: true,
      can_post_announcements: true
    })
    .eq("id", data.user.id)
    .select("id")
    .maybeSingle();

  if (profileError || !profile) {
    const reason = profileError?.message || "The new account profile was not found.";
    throw new Error(`The sign-in account was created, but admin access could not be assigned (${reason}). Review the account in Member access before retrying.`);
  }

  return { emailConfirmationRequired: !data.session };
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function watchAuthState(callback) {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => subscription.unsubscribe();
}

export async function getCurrentSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
