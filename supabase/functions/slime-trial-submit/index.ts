import { createSubmitHandler } from "./handler.ts";

// Supabase injects key dictionaries for current project keys; legacy projects
// use the individual environment values. No environment value enters a reply.
function dictionaryKeys(name: string): string[] {
  try {
    const value: unknown = JSON.parse(Deno.env.get(name) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    return Object.values(value).filter((key): key is string => typeof key === "string" && key.length > 0);
  } catch { return []; }
}
const serviceKey = dictionaryKeys("SUPABASE_SECRET_KEYS")[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKeys = [...dictionaryKeys("SUPABASE_PUBLISHABLE_KEYS"), Deno.env.get("SUPABASE_ANON_KEY") ?? ""].filter(Boolean);

// Deploy with verify_jwt=false: visitors send this project's public API key,
// and the handler performs its own strict Origin/key/payload checks. It never
// creates a Supabase Auth user or verifies a visitor JWT.
Deno.serve(createSubmitHandler({supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "", serviceKey, publicKeys}));
