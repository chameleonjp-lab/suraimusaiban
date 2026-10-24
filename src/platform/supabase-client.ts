import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function isBackendConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}
export function getSubmissionConfig(): {
  endpoint: string;
  publicKey: string;
} | null {
  if (!isBackendConfigured()) return null;
  const key: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key.startsWith("sb_secret_"))
    throw new Error("公開用キーを設定してください。");
  if (key.split(".").length === 3) {
    try {
      if (
        JSON.parse(
          atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        ).role === "service_role"
      )
        throw new Error("SECRET_KEY");
    } catch (error) {
      if (error instanceof Error && error.message === "SECRET_KEY")
        throw new Error("公開用キーを設定してください。");
    }
  }
  return {
    endpoint: `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/slime-trial-submit`,
    publicKey: key,
  };
}
export function getSupabaseClient(): SupabaseClient | null {
  const config = getSubmissionConfig();
  if (!config) return null;
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL, config.publicKey, {
      // Bypass Auth construction and implicit getSession calls for public reads.
      accessToken: async () => null,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
