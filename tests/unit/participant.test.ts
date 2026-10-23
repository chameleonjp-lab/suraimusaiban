import { describe, expect, it } from 'vitest';
import { createParticipantService } from '../../src/features/vote/participant';
import { resilientStorage } from '../../src/platform/supabase-client';

function auth({ userId = null as string | null, error = null as Error | null, valid = true } = {}) {
  let created = 0;
  return {
    get created() { return created; },
    async getSession() { return { data: { session: userId ? { user: { id: userId } } : null }, error }; },
    async getUser() { return { data: { user: valid && userId ? { id: userId } : null }, error: valid ? null : new Error('offline') }; },
    async signInAnonymously() { created++; return { data: { user: { id: 'new-person' } }, error: null }; },
  };
}
describe('anonymous participation', () => {
  it('reuses identity rather than creating a second ballot owner', async () => {
    const boundary = auth({ userId: 'original' });
    expect(await createParticipantService(boundary, () => true)()).toEqual({id:'original',persistent:true});
    expect(boundary.created).toBe(0);
  });
  it('temporary communication failure never creates a new identity', async () => {
    const boundary = auth({ userId: 'original', error: new Error('offline') });
    await expect(createParticipantService(boundary, () => true)()).rejects.toThrow('offline');
    expect(boundary.created).toBe(0);
  });
  it('failed identity verification never starts another anonymous account', async () => {
    const boundary = auth({ userId:'original', valid:false });
    await expect(createParticipantService(boundary, () => true)()).rejects.toThrow('offline');
    expect(boundary.created).toBe(0);
  });
  it('deduplicates simultaneous participant initialization', async () => {
    const boundary = auth();
    const ensure = createParticipantService(boundary, () => false);
    expect(await Promise.all([ensure(),ensure()])).toEqual([{id:'new-person',persistent:false},{id:'new-person',persistent:false}]);
    expect(boundary.created).toBe(1);
  });
  it('continues in memory when persistent storage rejects writes', () => {
    const storage = resilientStorage({getItem:()=>null,setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}});
    storage.setItem('auth-session', 'session');
    expect(storage.getItem('auth-session')).toBe('session');
    expect(storage.persistent).toBe(false);
    storage.removeItem('auth-session');
    expect(storage.getItem('auth-session')).toBe(null);
  });
});
