import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { scoreAnswers, validateAnswers } from "../../src/domain/scoring";
import {
  answers,
  participant,
  reset,
  snapshot,
  sql,
  submit,
  wire,
} from "./helpers";
describe("atomic submission", () => {
  beforeEach(reset);
  it("first vote, replacement, other voter, retry and unchanged request preserve exact counts", async () => {
    const a = await participant(),
      b = await participant(),
      id = randomUUID();
    const first = await submit(a.client, answers(), "0", id);
    expect(first.error).toBeNull();
    expect(first.data.snapshot.count).toBe("1");
    expect(first.data.snapshot.scoreSum).toBe("100");
    const retry = await submit(a.client, answers(), "0", id);
    expect(retry.data).toEqual(first.data);
    const same = await submit(a.client, answers(), "1");
    expect(same.error).toBeNull();
    expect(same.data.snapshot.revision).toBe("1");
    expect(same.data.ballot.revision).toBe("1");
    const replaced = await submit(a.client, answers(-5), "1");
    expect(replaced.error).toBeNull();
    expect(replaced.data.snapshot.count).toBe("1");
    expect(replaced.data.snapshot.scoreSum).toBe("-100");
    const other = await submit(b.client);
    expect(other.error).toBeNull();
    expect(other.data.snapshot.count).toBe("2");
    expect(other.data.snapshot.scoreSum).toBe("0");
    expect(other.data.snapshot.verdictCounts.N5).toBe("1");
    expect(other.data.snapshot.verdictCounts.P5).toBe("1");
  });
  it("same request ID with different content is rejected, old receipt after a newer vote conflicts", async () => {
    const a = await participant(),
      id = randomUUID();
    await submit(a.client, answers(), "0", id);
    expect(
      (await submit(a.client, answers(-5), "1", id)).error?.message,
    ).toContain("REQUEST_ID_REUSED");
    await submit(a.client, answers(-5), "1");
    expect(
      (await submit(a.client, answers(), "0", id)).error?.message,
    ).toContain("STALE_REVISION");
  });
  it("a retry returns the current snapshot when its ballot is unchanged", async () => {
    const a = await participant(),
      b = await participant(),
      id = randomUUID();
    await submit(a.client, answers(), "0", id);
    await submit(b.client);
    const retry = await submit(a.client, answers(), "0", id);
    expect(retry.data.snapshot.count).toBe("2");
    expect(retry.data.ballot.revision).toBe("1");
  });
  it("rejects missing, extra, duplicate, unknown, zero, fractional, string and null scores", async () => {
    const a = await participant(),
      good = wire(answers());
    const invalid = [
      good.slice(1),
      [...good, good[0]],
      [...good.slice(1), good[1]],
      good.map((v, i) => (i ? v : { ...v, caseId: "X01" })),
      ...[0, 1.5, 6, -6, "5", null].map((score) =>
        good.map((v, i) => (i ? v : { ...v, score })),
      ),
    ];
    for (const p_answers of invalid) {
      const r = await a.client.rpc("submit_ballot", {
        p_version: "v1",
        p_answers,
        p_request_id: randomUUID(),
        p_expected_revision: "0",
      });
      expect(r.error?.message).toContain("INVALID_ANSWERS");
    }
    expect(
      (await submit(a.client, answers(), "0", randomUUID(), "v2")).error
        ?.message,
    ).toContain("VERSION_CHANGED");
    expect((await snapshot()).count).toBe("0");
  });
  it("limits ten new operations in rolling 60 seconds and never charges retries", async () => {
    const a = await participant(),
      id = randomUUID();
    expect((await submit(a.client, answers(), "0", id)).error).toBeNull();
    for (let i = 0; i < 15; i++)
      expect((await submit(a.client, answers(), "0", id)).error).toBeNull();
    for (let i = 1; i < 10; i++)
      expect((await submit(a.client, answers(), "1")).error).toBeNull();
    expect((await submit(a.client, answers(), "1")).error?.message).toContain(
      "RATE_LIMITED",
    );
    expect((await submit(a.client, answers(), "0", id)).error).toBeNull();
    const c = await sql();
    try {
      await c.query(
        "update private.submit_limits set operations=array_fill(now()-interval '61 seconds', array[10]) where participant_id=$1",
        [a.id],
      );
    } finally {
      await c.end();
    }
    expect((await submit(a.client, answers(), "1")).error).toBeNull();
  });
  it("matches TypeScript on all 100 H/K pairs and all ten axes", async () => {
    const c = await sql();
    try {
      for (const h of [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5])
        for (const k of [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]) {
          const values = Object.fromEntries(
            Object.keys(answers()).map((id) => [
              id,
              id.startsWith("H") ? h : k,
            ]),
          );
          const expected = scoreAnswers(validateAnswers(values));
          const {
            rows: [{ result }],
          } = await c.query(
            "select private.score_ballot($1::jsonb) as result",
            [JSON.stringify(values)],
          );
          expect(result.total).toBe(expected.total);
          expect(result.axes).toEqual(expected.axes);
          expect(result.verdict).toBe(expected.verdict);
        }
    } finally {
      await c.end();
    }
  });
  it("matches the shared scoring fixtures on score, all ten axes and verdict", async () => {
    const fixtures = JSON.parse(
      readFileSync("tests/fixtures/scoring.json", "utf8"),
    );
    for (const fixture of fixtures.valid) {
      await reset();
      const a = await participant();
      const r = await submit(a.client, fixture.answers);
      expect(r.error).toBeNull();
      const expected = fixture.expected;
      expect(r.data.snapshot.scoreSum).toBe(String(expected.total));
      expect(r.data.snapshot.axisSums).toEqual(
        Object.fromEntries(
          Object.entries(expected.axes).map(([k, v]) => [k, String(v)]),
        ),
      );
      expect(r.data.snapshot.verdictCounts[expected.verdict]).toBe("1");
    }
  });
});
