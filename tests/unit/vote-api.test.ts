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
it("retries lost responses with identical public-only bytes and builds a local result against pending aggregates", async () => {
  const sent: {url: string; init: RequestInit}[] = [];
  const submit = createSubmitter(async (url, init) => {
    sent.push({ url: String(url), init: init! });
    if (sent.length === 1) throw new TypeError("response lost");
    return Response.json({ accepted: true, duplicate: true, snapshot: zero() });
  }, "https://project.supabase.co/functions/v1/slime-trial-submit", "sb_publishable_public");
  const receipt = await submit(request);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0].init.headers).toEqual({ "Content-Type": "application/json", apikey: "sb_publishable_public" });
  expect(JSON.parse(sent[0].init.body as string)).toEqual({version: "v1", requestId: request.requestId, answers: CASE_ORDER.map(caseId => ({caseId,score:1}))});
  expect(receipt).toEqual({ ballot: {version: "v1", answers:request.answers}, snapshot:zero() });
});
it("keeps the original request for manual retry after both uncertain attempts", async () => {
  const bodies: string[] = [];
  const submit = createSubmitter(async (_url, init) => {
    bodies.push(init!.body as string);
    if (bodies.length <= 2) throw Error("offline");
    return Response.json({accepted:true,duplicate:true,snapshot:zero()});
  }, "/functions/v1/slime-trial-submit", "public");
  await expect(submit(request)).rejects.toMatchObject({code:"NETWORK_ERROR"});
  await submit(request);
  expect(new Set(bodies).size).toBe(1);
});
it("does not retry explicit rate limits or accept malformed gateway responses", async () => {
  let calls = 0;
  const submit = createSubmitter(async () => { calls++; return Response.json({error:"RATE_LIMITED"},{status:429}); }, "/gate", "public");
  await expect(submit(request)).rejects.toBeInstanceOf(VoteError);
  expect(calls).toBe(1);
  const invalid = createSubmitter(async () => Response.json({accepted:false,snapshot:zero()}), "/gate", "public");
  await expect(invalid(request)).rejects.toMatchObject({code:"INVALID_RESPONSE"});
});
it("never retries a request aborted by navigation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const submit = createSubmitter(async () => {
    calls++;
    controller.abort();
    throw new DOMException("Aborted", "AbortError");
  }, "/gate", "public");
  await expect(submit(request, controller.signal)).rejects.toMatchObject({name:"AbortError"});
  expect(calls).toBe(1);
});
