import { CASE_ORDER } from "../../domain/content";
import type {
  Answers,
  CaseId,
  ContentVersion,
  Draft,
  Score,
} from "../../domain/types";
export type TrialState = {
  draft: Draft;
  currentIndex: number;
  version: ContentVersion;
};
export function startTrial(): TrialState {
  return { draft: {}, currentIndex: 0, version: "v1" };
}
export function setAnswer(
  state: TrialState,
  id: CaseId,
  value: Score,
): TrialState {
  if (
    !CASE_ORDER.includes(id) ||
    !Number.isInteger(value) ||
    Number(value) === 0 ||
    Math.abs(value) > 5
  )
    throw new Error("回答の値が不正です");
  return { ...state, draft: { ...state.draft, [id]: value } };
}
export function canSubmit(state: TrialState): boolean {
  return (
    Object.keys(state.draft).length === CASE_ORDER.length &&
    CASE_ORDER.every(
      (id) =>
        Number.isInteger(state.draft[id]) &&
        Number(state.draft[id]) !== 0 &&
        Math.abs(state.draft[id]!) <= 5,
    )
  );
}
export function completeAnswers(state: TrialState): Answers {
  if (!canSubmit(state)) throw new Error("未回答の審理があります");
  return { ...state.draft } as Answers;
}
