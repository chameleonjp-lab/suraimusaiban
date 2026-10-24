import { expect, it, vi } from "vitest";
import { startTrial, setAnswer, canSubmit } from "../../src/features/trial/state";
import { CASE_ORDER } from "../../src/domain/content";
it("starts a fresh trial without reading or writing browser storage", () => {
  const access = () => { throw Error("storage must not be used"); };
  vi.stubGlobal("localStorage", { getItem: access, setItem: access });
  const edited = setAnswer(startTrial(), "H01", -5);
  expect(edited.draft.H01).toBe(-5);
  expect(startTrial()).toEqual({ draft: {}, currentIndex: 0, version: "v1" });
  expect(edited).not.toHaveProperty("participantId");
  vi.unstubAllGlobals();
});
it("requires all twenty answers", () => {
  let state = startTrial();
  for (const id of CASE_ORDER.slice(0, 19)) state = setAnswer(state, id, -1);
  expect(canSubmit(state)).toBe(false);
  expect(canSubmit(setAnswer(state, CASE_ORDER[19], 1))).toBe(true);
});
