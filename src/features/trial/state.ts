import { CASE_ORDER } from "../../domain/content";
import type {
  Answers,
  Ballot,
  CaseId,
  ContentVersion,
  DecimalInteger,
  Draft,
  Participant,
  Score,
} from "../../domain/types";
import { loadDraft } from "../../platform/draft-storage";
export type TrialState = {
  draft: Draft;
  currentIndex: number;
  expectedRevision: DecimalInteger;
  participantId: string;
  version: ContentVersion;
};
export function startTrial(
  participant: Participant,
  ballot: Ballot | null,
): TrialState {
  const version = "v1";
  return (
    loadDraft(participant.id, version) ?? {
      draft: ballot?.version === version ? { ...ballot.answers } : {},
      currentIndex: 0,
      expectedRevision: ballot?.version === version ? ballot.revision : "0",
      participantId: participant.id,
      version,
    }
  );
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
