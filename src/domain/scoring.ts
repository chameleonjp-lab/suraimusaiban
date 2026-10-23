import { AXES, CASE_ORDER, SCORES } from "./content";
import type {
  Answers,
  AxisValues,
  CaseId,
  Draft,
  IndividualResult,
  Score,
  VerdictId,
} from "./types";

const caseIds = new Set<string>(CASE_ORDER);
const scores = new Set<number>(SCORES);

/** Unanswered cases are absent; zero and unknown keys are never valid answers. */
export function validateDraft(input: unknown): Draft {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("回答は出来事ごとのオブジェクトで指定してください。");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("回答に継承された値は使えません。");
  }
  const draft: Draft = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !caseIds.has(key)) {
      throw new TypeError("定義されていない出来事が含まれています。");
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    const value: unknown = descriptor.value;
    if (
      !("value" in descriptor) ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      !scores.has(value)
    ) {
      throw new TypeError("回答は0を除く−5から＋5の整数で指定してください。");
    }
    draft[key as CaseId] = value as Score;
  }
  return draft;
}

/** Validate at every trust boundary, including scoreAnswers itself. */
export function validateAnswers(input: unknown): Answers {
  const draft = validateDraft(input);
  if (
    Object.keys(draft).length !== CASE_ORDER.length ||
    CASE_ORDER.some((id) => !Object.hasOwn(draft, id))
  ) {
    throw new TypeError("20件すべての回答が必要です。");
  }
  return Object.freeze(draft) as Answers;
}

/** Classify the exact rational average without converting it to a rounded decimal. */
export function selectVerdict(
  scoreSum: bigint,
  count: bigint,
): VerdictId | null {
  if (typeof scoreSum !== "bigint" || typeof count !== "bigint") {
    throw new TypeError("集計は整数で指定してください。");
  }
  if (count < 0n || scoreSum < -100n * count || scoreSum > 100n * count) {
    throw new RangeError("集計が有効な点数の範囲外です。");
  }
  if (count === 0n) return null;
  if (scoreSum < -80n * count) return "N5";
  if (scoreSum < -60n * count) return "N4";
  if (scoreSum < -40n * count) return "N3";
  if (scoreSum < -20n * count) return "N2";
  if (scoreSum < 0n) return "N1";
  if (scoreSum === 0n) return "Z";
  if (scoreSum <= 20n * count) return "P1";
  if (scoreSum <= 40n * count) return "P2";
  if (scoreSum <= 60n * count) return "P3";
  if (scoreSum <= 80n * count) return "P4";
  return "P5";
}

export function scoreAnswers(input: Answers): IndividualResult {
  const answers = validateAnswers(input);
  let total = 0;
  let negativeTotal = 0;
  let positiveTotal = 0;
  const cumulative = CASE_ORDER.map((id) => {
    const score = answers[id];
    total += score;
    if (score < 0) negativeTotal += score;
    else positiveTotal += score;
    return total;
  });
  const axes = Object.fromEntries(
    AXES.map((axis) => {
      const h = answers[axis.h];
      const k = answers[axis.k];
      const value =
        axis.id === 4
          ? 50 - 5 * (h + k)
          : axis.id === 10
            ? 50 + 5 * (h + k)
            : 50 + 5 * (k - h);
      return [axis.id, value];
    }),
  ) as AxisValues;
  return {
    total,
    negativeTotal,
    positiveTotal,
    verdict: selectVerdict(BigInt(total), 1n)!,
    axes,
    cumulative,
  };
}
