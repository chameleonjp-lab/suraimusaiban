import { describe, expect, it } from "vitest";
import { AXES, CASE_ORDER, SCORES } from "../../src/domain/content";
import {
  scoreAnswers,
  selectVerdict,
  validateAnswers,
  validateDraft,
} from "../../src/domain/scoring";
import type { Answers, Score, VerdictId } from "../../src/domain/types";
import fixtures from "../fixtures/scoring.json";

const allScores = (score: Score): Answers =>
  Object.fromEntries(CASE_ORDER.map((id) => [id, score])) as Answers;
const pairedScores = (h: Score, k: Score): Answers =>
  Object.fromEntries(
    CASE_ORDER.map((id) => [id, id.startsWith("H") ? h : k]),
  ) as Answers;

describe("individual scoring", () => {
  it("scores the documented extremes and cancellation without hiding either side", () => {
    expect(scoreAnswers(allScores(-5))).toMatchObject({
      total: -100,
      negativeTotal: -100,
      positiveTotal: 0,
      verdict: "N5",
    });
    expect(scoreAnswers(allScores(5))).toMatchObject({
      total: 100,
      negativeTotal: 0,
      positiveTotal: 100,
      verdict: "P5",
    });
    expect(scoreAnswers(pairedScores(-5, 5))).toMatchObject({
      total: 0,
      negativeTotal: -50,
      positiveTotal: 50,
      verdict: "Z",
    });
  });

  it("calculates cumulative totals in presentation order rather than object insertion order", () => {
    const answers = Object.fromEntries(
      [...CASE_ORDER].reverse().map((id) => [id, id.startsWith("H") ? -5 : 5]),
    ) as Answers;
    expect(scoreAnswers(answers).cumulative).toEqual([
      -5, 0, -5, 0, -5, 0, -5, 0, -5, 0, -5, 0, -5, 0, -5, 0, -5, 0, -5, 0,
    ]);
  });

  it("gives the documented axis example 85", () => {
    expect(scoreAnswers({ ...allScores(1), H01: -4, K01: 3 }).axes[1]).toBe(85);
  });

  it("applies each of the three axis definitions to all 100 answer pairs independently", () => {
    for (const h of SCORES)
      for (const k of SCORES) {
        const result = scoreAnswers(pairedScores(h, k));
        for (const axis of AXES) {
          const expected =
            axis.id === 4
              ? 50 - 5 * (h + k)
              : axis.id === 10
                ? 50 + 5 * (h + k)
                : 50 + 5 * (k - h);
          expect(result.axes[axis.id]).toBe(expected);
          expect(result.axes[axis.id]).toBeGreaterThanOrEqual(0);
          expect(result.axes[axis.id]).toBeLessThanOrEqual(100);
          const changed = {
            ...pairedScores(h, k),
            [axis.h]: h === -5 ? 5 : -5,
          };
          const changedResult = scoreAnswers(changed);
          for (const other of AXES.filter((a) => a.id !== axis.id))
            expect(changedResult.axes[other.id]).toBe(result.axes[other.id]);
        }
      }
  });
});

describe("strict answer validation", () => {
  it("accepts and copies exactly twenty known IDs with legal integer answers", () => {
    const answers = allScores(-5);
    expect(validateAnswers(answers)).toEqual(answers);
    expect(validateAnswers(answers)).not.toBe(answers);
  });

  it("rejects incomplete, extra, unknown and inherited answers", () => {
    const { H01: _, ...nineteen } = allScores(1);
    const invalid = [
      nineteen,
      { ...allScores(1), extra: 1 },
      { ...nineteen, X01: 1 },
      Object.create(allScores(1)),
      [],
      null,
      undefined,
      "answers",
    ];
    for (const input of invalid) expect(() => validateAnswers(input)).toThrow();
  });

  it("rejects zero, out of range, fractional, nonnumeric and nonfinite values even through scoring", () => {
    for (const value of [
      0,
      -6,
      6,
      1.5,
      "1",
      null,
      undefined,
      true,
      NaN,
      Infinity,
      -Infinity,
    ]) {
      const input = { ...allScores(1), H01: value };
      expect(() => validateAnswers(input)).toThrow();
      expect(() => scoreAnswers(input as Answers)).toThrow();
    }
  });

  it("rejects symbol keys and non-enumerable unknown keys", () => {
    expect(() =>
      validateAnswers({ ...allScores(1), [Symbol("extra")]: 1 }),
    ).toThrow();
    expect(() =>
      validateAnswers(
        Object.defineProperty({ ...allScores(1) }, "extra", { value: 1 }),
      ),
    ).toThrow();
  });

  it("validates a partial draft while keeping unanswered cases absent", () => {
    expect(validateDraft({})).toEqual({});
    expect(validateDraft({ H01: -3, K10: 4 })).toEqual({ H01: -3, K10: 4 });
    for (const input of [
      { H01: 0 },
      { H01: undefined },
      { H01: "2" },
      { X01: 1 },
      [],
      null,
    ])
      expect(() => validateDraft(input)).toThrow();
  });
});

describe("exact rational verdict selection", () => {
  it.each<[bigint, bigint, VerdictId | null]>([
    [0n, 0n, null],
    [0n, 2n, "Z"],
    [1n, 1000000n, "P1"],
    [-1n, 1000000n, "N1"],
    [-80n, 1n, "N4"],
    [80n, 1n, "P4"],
    [-80001n, 1000n, "N5"],
    [80001n, 1000n, "P5"],
    [-100n, 1n, "N5"],
    [100n, 1n, "P5"],
  ])("classifies %s / %s as %s", (sum, count, want) =>
    expect(selectVerdict(sum, count)).toBe(want),
  );

  it.each<[number, VerdictId, VerdictId, VerdictId]>([
    [-80, "N5", "N4", "N4"],
    [-60, "N4", "N3", "N3"],
    [-40, "N3", "N2", "N2"],
    [-20, "N2", "N1", "N1"],
    [0, "N1", "Z", "P1"],
    [20, "P1", "P1", "P2"],
    [40, "P2", "P2", "P3"],
    [60, "P3", "P3", "P4"],
    [80, "P4", "P4", "P5"],
  ])(
    "covers both sides of the %s boundary at arbitrary precision",
    (boundary, before, at, after) => {
      const count = 10n ** 30n;
      const sum = BigInt(boundary) * count;
      expect(selectVerdict(sum - 1n, count)).toBe(before);
      expect(selectVerdict(sum, count)).toBe(at);
      expect(selectVerdict(sum + 1n, count)).toBe(after);
    },
  );

  it("rejects aggregates outside the possible score range", () => {
    for (const [sum, count] of [
      [0n, -1n],
      [1n, 0n],
      [101n, 1n],
      [-101n, 1n],
    ])
      expect(() => selectVerdict(sum, count)).toThrow();
  });

  it("rejects numeric inputs that would silently discard precision", () => {
    expect(() => selectVerdict(0 as unknown as bigint, 1n)).toThrow();
    expect(() => selectVerdict(0n, 1 as unknown as bigint)).toThrow();
  });
});

describe("shared database parity fixtures", () => {
  it("matches every complete expected output", () => {
    for (const fixture of fixtures.valid)
      expect(scoreAnswers(validateAnswers(fixture.answers))).toEqual(
        fixture.expected,
      );
  });

  it("rejects every invalid fixture", () => {
    for (const fixture of fixtures.invalid)
      expect(() => validateAnswers(fixture.answers)).toThrow();
  });

  it("matches every exact aggregate boundary fixture", () => {
    for (const fixture of fixtures.boundaries)
      expect(
        selectVerdict(BigInt(fixture.scoreSum), BigInt(fixture.count)),
      ).toBe(fixture.verdict);
  });
});
