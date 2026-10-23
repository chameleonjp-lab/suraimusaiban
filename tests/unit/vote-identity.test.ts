import { expect, it, vi } from "vitest";
import { CASE_ORDER } from "../../src/domain/content";
import type { Answers, SubmitRequest } from "../../src/domain/types";

const transport = vi.hoisted(() => ({
  owner: "A",
  headers: [] as string[],
  submissions: [] as string[],
}));
vi.mock("../../src/platform/supabase-client", () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: transport.owner },
            access_token: `token-${transport.owner}`,
          },
        },
        error: null,
      }),
    },
    rpc: () => {
      // A different tab replaces the SDK session after preflight, before fetch.
      transport.owner = "B";
      let authorization = "Bearer token-B";
      const query = {
        setHeader(name: string, value: string) {
          if (name === "Authorization") authorization = value;
          transport.headers.push(value);
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          transport.submissions.push(authorization);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
import { submitBallot } from "../../src/features/vote/vote-api";

it("pins the original JWT when SDK auth changes between preflight and fetch", async () => {
  const request: SubmitRequest = {
    version: "v1",
    requestId: "66085383-7255-40df-9a2d-3f427f9962b0",
    expectedRevision: "0",
    answers: Object.fromEntries(CASE_ORDER.map((id) => [id, 1])) as Answers,
  };
  await expect(submitBallot(request, "A")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(transport.submissions).toEqual(["Bearer token-A"]);
});
