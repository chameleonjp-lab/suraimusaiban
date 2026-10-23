import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type StorageBoundary = Pick<Storage, 'getItem'|'setItem'|'removeItem'>;
/** Keeps a session usable in this tab when browser storage is unavailable. */
export function resilientStorage(source: StorageBoundary | null) {
  const memory = new Map<string,string>();
  let persistent = source !== null;
  return {
    get persistent() { return persistent; },
    getItem(key: string): string | null {
      if (persistent && source) {
        try { const value = source.getItem(key); if (value !== null) memory.set(key,value); else memory.delete(key); return value; }
        catch { persistent = false; }
      }
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      if (persistent && source) { try { source.setItem(key, value); } catch { persistent = false; } }
    },
    removeItem(key: string) {
      memory.delete(key);
      if (persistent && source) { try { source.removeItem(key); } catch { persistent = false; } }
    },
  };
}
function browserStorage(): StorageBoundary | null { try { return window.localStorage; } catch { return null; } }
const sessionStorageAdapter = resilientStorage(browserStorage());
let client: SupabaseClient | null = null;
export function isBackendConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
}
export function getSupabaseClient(): SupabaseClient | null {
  if (!isBackendConfigured()) return null;
  if (!client) {
    const key: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (key.startsWith('sb_secret_')) throw new Error('公開用キーを設定してください。');
    if (key.split('.').length === 3) {
      try { if (JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'service_role') throw new Error('SECRET_KEY'); }
      catch (error) { if (error instanceof Error && error.message === 'SECRET_KEY') throw new Error('公開用キーを設定してください。'); }
    }
    client = createClient(import.meta.env.VITE_SUPABASE_URL, key, {
      auth: { persistSession: true, storage: sessionStorageAdapter, detectSessionInUrl: false },
    });
  }
  return client;
}
export function isSessionPersistent(): boolean { return sessionStorageAdapter.persistent; }
