import { expect, it } from "vitest";
import { CASE_ORDER, AXES, SCORES, VERDICTS } from "../../src/domain/content";
import {
  parseSnapshot,
  createSubmitter,
  VoteError,
} from "../../src/features/vote/vote-api";
import type { Answers, Snapshot, SubmitRequest } from "../../src/domain/types";
const zero = (): Snapshot => ({
  version: "v1",
  revision: "0",
  updatedAt: "2026-10-23T00:00:00Z",
  count: "0",
  scoreSum: "0",
  caseCounts: Object.fromEntries(
    CASE_ORDER.map((id) => [
      id,
      Object.fromEntries(SCORES.map((s) => [s, "0"])),
    ]),
  ) as Snapshot["caseCounts"],
  axisSums: Object.fromEntries(
    AXES.map((a) => [a.id, "0"]),
  ) as Snapshot["axisSums"],
  verdictCounts: Object.fromEntries(
    VERDICTS.map((v) => [v.id, "0"]),
  ) as Snapshot["verdictCounts"],
});
const request: SubmitRequest = {
  version: "v1",
  requestId: "66085383-7255-40df-9a2d-3f427f9962b0",
  expectedRevision: "0",
  answers: Object.fromEntries(CASE_ORDER.map((id) => [id, 1])) as Answers,
};
it("accepts zero votes without inventing a verdict", () => {
  expect(parseSnapshot(zero())).toEqual(zero());
});
it("rejects an incomplete distribution rather than displaying partial aggregate", () => {
  const data = zero();
  delete (data.caseCounts as any).H01;
  expect(() => parseSnapshot(data)).toThrow();
});
it("rejects precision-losing JSON numbers and distribution totals inconsistent with count", () => {
  expect(() => parseSnapshot({ ...zero(), count: 9007199254740993 })).toThrow();
  expect(() => parseSnapshot({ ...zero(), count: "1" })).toThrow();
});
it("lost_response_retries_once with the identical request", async () => {
  const sent: unknown[] = [];
  let n = 0;
  const response = {
    ballot: { version: "v1", answers: request.answers, revision: "1" },
    snapshot: zero(),
  };
  const submit = createSubmitter(
    async (_name, args) => {
      sent.push(args);
      if (n++ === 0) throw new TypeError("Failed to fetch");
      return { data: response, error: null };
    },
    async () => "a",
    (value) => value as any,
  );
  expect(await submit(request)).toEqual(response);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect((sent[0] as any).p_answers).toHaveLength(20);
});
it("does not replay pending requests under a replacement identity", async () => {
  let calls = 0,
    identityChecks = 0;
  const submit = createSubmitter(
    async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    },
    async () => (++identityChecks === 1 ? "a" : "b"),
    (value) => value as any,
  );
  await expect(submit(request)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(calls).toBe(1);
});
it("stale revision is never retried as transport error", async () => {
  let calls = 0;
  const submit = createSubmitter(
    async () => {
      calls++;
      return {
        data: null,
        error: { message: "STALE_REVISION", code: "P0001" },
      };
    },
    async () => "a",
    (value) => value as any,
  );
  await expect(submit(request)).rejects.toBeInstanceOf(VoteError);
  expect(calls).toBe(1);
});
it("rejects a replacement identity even before the first request is sent", async () => {
  let calls = 0;
  const submit = createSubmitter(
    async () => {
      calls++;
      return { data: null, error: null };
    },
    async () => "B",
    (value) => value as any,
    "A",
  );
  await expect(submit(request)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(calls).toBe(0);
});
