import { beforeEach, expect, it, vi } from 'vitest';
import { loadDraft, saveDraft } from '../../src/platform/draft-storage';
import type { TrialState } from '../../src/features/trial/state';
const values = new Map<string,string>();
beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => values.set(key,value), clear: () => values.clear() });
});
it('identity_scoped_draft', () => {
  const state: TrialState = { participantId: 'A', version: 'v1', expectedRevision: '2', currentIndex: 4, draft: { H01: -3 } };
  saveDraft(state);
  expect(loadDraft('A','v1')).toEqual(state);
  expect(loadDraft('B','v1')).toBeNull();
  expect(loadDraft('A','v2')).toBeNull();
});
it('storage refusal keeps a memory draft', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
  const state: TrialState = { participantId: 'refused', version: 'v1', expectedRevision: '0', currentIndex: 0, draft: { K01: 5 } };
  expect(() => saveDraft(state)).not.toThrow();
  expect(loadDraft('refused','v1')).toEqual(state);
});
it('malformed storage is not restored', () => {
  values.set('slime-trial:draft:v1:A', JSON.stringify({ participantId: 'A', version:'v1', expectedRevision: '1', currentIndex: 0, draft: { H01: 0 } }));
  expect(loadDraft('A','v1')).toBeNull();
});
it('quota refusal keeps the newer draft even when reads still work', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw Error('quota'); } });
  const state: TrialState = { participantId: 'quota', version: 'v1', expectedRevision: '7', currentIndex: 1, draft: { H01: -5 } };
  saveDraft(state);
  expect(loadDraft('quota','v1')).toEqual(state);
});
