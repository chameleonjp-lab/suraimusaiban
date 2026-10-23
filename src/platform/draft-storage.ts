import type { TrialState } from '../features/trial/state';
import { CASE_ORDER } from '../domain/content';
const memory = new Map<string, TrialState>();
let available = true;
const keyFor = (id: string, version: string) => `slime-trial:draft:${encodeURIComponent(version)}:${encodeURIComponent(id)}`;
export const isDraftPersistent = () => available;
export function saveDraft(state: TrialState): void {
  const key = keyFor(state.participantId, state.version);
  memory.set(key, structuredClone(state));
  try { localStorage.setItem(key, JSON.stringify(state)); available = true; } catch { available = false; }
}
export function loadDraft(participantId: string, version: string): TrialState | null {
  const key = keyFor(participantId, version);
  if (memory.has(key)) return structuredClone(memory.get(key)!);
  let value: unknown;
  try { const raw = localStorage.getItem(key); value = raw ? JSON.parse(raw) : null; } catch { available = false; value = memory.get(key); }
  if (!value || typeof value !== 'object') return null;
  const state = value as TrialState;
  if (state.participantId !== participantId || state.version !== version || !/^\d+$/.test(state.expectedRevision) || !Number.isInteger(state.currentIndex) || state.currentIndex < 0 || state.currentIndex >= CASE_ORDER.length || !state.draft || typeof state.draft !== 'object' || Array.isArray(state.draft)) return null;
  if (Object.entries(state.draft).some(([id, score]) => !CASE_ORDER.includes(id as never) || !Number.isInteger(score) || !score || Math.abs(score) > 5)) return null;
  return structuredClone(state);
}
export function clearDraft(participantId: string, version: string): void {
  const key = keyFor(participantId, version); memory.delete(key);
  try { localStorage.removeItem(key); } catch { available = false; }
}
