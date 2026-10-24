import { afterEach, expect, it, vi } from "vitest";
import { getSubmissionConfig, getSupabaseClient } from "../../src/platform/supabase-client";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("keeps read-only SDK requests independent of Supabase Auth", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_public");
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json([]);
  });
  const client = getSupabaseClient()!;
  expect(() => client.auth.getSession).toThrow("accessToken");
  const {error} = await client.from("slime_trial_aggregate_snapshots").select("payload");
  expect(error).toBeNull();
  expect(urls).toEqual(["https://project.supabase.co/rest/v1/slime_trial_aggregate_snapshots?select=payload"]);
  expect(getSubmissionConfig()).toEqual({endpoint:"https://project.supabase.co/functions/v1/slime-trial-submit",publicKey:"sb_publishable_public"});
});
it("rejects secret keys in public configuration", () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_secret_private");
  expect(() => getSubmissionConfig()).toThrow("公開用キー");
});
