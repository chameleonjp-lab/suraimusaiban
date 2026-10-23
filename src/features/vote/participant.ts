import type { Participant } from "../../domain/types";
import {
  getSupabaseClient,
  isSessionPersistent,
} from "../../platform/supabase-client";

type User = { id: string };
type AuthBoundary = {
  getSession(): Promise<{
    data: { session: { user: User } | null };
    error: unknown;
  }>;
  getUser(): Promise<{ data: { user: User | null }; error: unknown }>;
  signInAnonymously(): Promise<{ data: { user: User | null }; error: unknown }>;
};
/** Network errors are not evidence that an existing identity has been lost. */
export function createParticipantService(
  auth: AuthBoundary,
  persistent: () => boolean,
): () => Promise<Participant> {
  let pending: Promise<Participant> | null = null;
  async function initialize(): Promise<Participant> {
    const session = await auth.getSession();
    if (session.error) throw session.error;
    if (session.data.session) {
      const verified = await auth.getUser();
      if (verified.error) throw verified.error;
      if (
        !verified.data.user ||
        verified.data.user.id !== session.data.session.user.id
      )
        throw new Error("参加情報を確認できません。再度お試しください。");
      return { id: verified.data.user.id, persistent: persistent() };
    }
    const created = await auth.signInAnonymously();
    if (created.error) throw created.error;
    if (!created.data.user) throw new Error("匿名参加を開始できませんでした。");
    return { id: created.data.user.id, persistent: persistent() };
  }
  return () =>
    pending ??
    (pending = initialize().finally(() => {
      pending = null;
    }));
}
let service: (() => Promise<Participant>) | null = null;
export function ensureParticipant(): Promise<Participant> {
  const client = getSupabaseClient();
  if (!client)
    return Promise.reject(
      new Error("投票先に接続されていません。現在は未送信プレビューです。"),
    );
  service ??= createParticipantService(client.auth, isSessionPersistent);
  return service();
}
