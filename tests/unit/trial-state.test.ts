import { describe, expect, it, beforeEach, vi } from 'vitest';
import { startTrial, setAnswer, canSubmit } from '../../src/features/trial/state';
import { CASE_ORDER } from '../../src/domain/content';
import { saveDraft } from '../../src/platform/draft-storage';
import type { Answers } from '../../src/domain/types';

const stored = new Map<string,string>();
beforeEach(() => { stored.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string,value: string) => stored.set(key,value), clear: () => stored.clear() }); });
describe('trial state', () => {
  it('nineteen_answers_cannot_submit', () => {
    let state = startTrial({ id: 'nineteen', persistent: true }, null);
    for (const id of CASE_ORDER.slice(0, 19)) state = setAnswer(state, id, -1);
    expect(canSubmit(state)).toBe(false);
    state = setAnswer(state, CASE_ORDER[19], 1);
    expect(canSubmit(state)).toBe(true);
  });
  it('edit_preserves_expected_revision', () => {
    const answers = Object.fromEntries(CASE_ORDER.map(id => [id, 1])) as Answers;
    let state = startTrial({ id: 'edit', persistent: true }, { answers, revision: '3', version: 'v1' });
    state = setAnswer(state, CASE_ORDER[0], -5);
    saveDraft(state);
    const resumed = startTrial({ id: 'edit', persistent: true }, { answers, revision: '9', version: 'v1' });
    expect(resumed.expectedRevision).toBe('3');
    expect(resumed.draft[CASE_ORDER[0]]).toBe(-5);
  });
});
