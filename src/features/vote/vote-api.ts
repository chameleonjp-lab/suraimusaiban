import {
  AXES,
  CASE_ORDER,
  CONTENT_VERSION,
  SCORES,
  VERDICTS,
} from "../../domain/content";
import { validateAnswers } from "../../domain/scoring";
import type {
  Ballot,
  ContentVersion,
  Snapshot,
  SubmitReceipt,
  SubmitRequest,
} from "../../domain/types";
import { getSupabaseClient } from "../../platform/supabase-client";

const messages = {
  INVALID_ANSWERS: "20件の回答を確認してください。",
  VERSION_CHANGED:
    "内容が更新されたか、投票受付が停止しています。ホームから確認してください。",
  STALE_REVISION:
    "別の画面で回答が更新されています。保存済みの回答を確認してください。",
  REQUEST_ID_REUSED:
    "送信内容の確認が必要です。回答を確認して新しい送信を開始してください。",
  RATE_LIMITED: "送信が続いています。しばらく待って再度お試しください。",
  UNAUTHENTICATED:
    "参加情報が変わったか、確認できません。入力は保存されています。ホームから参加し直してください。",
  NETWORK_ERROR: "保存の成否を確認できません。同じ送信を再確認してください。",
  NOT_CONFIGURED: "未送信プレビューです。投票先に接続されていません。",
  INVALID_RESPONSE:
    "集計データを確認できません。時間を置いて更新してください。",
};
export type VoteErrorCode = keyof typeof messages;
export class VoteError extends Error {
  constructor(readonly code: VoteErrorCode) {
    super(messages[code]);
    this.name = "VoteError";
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new VoteError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function integer(value: unknown, signed = false): string {
  if (
    typeof value !== "string" ||
    !(signed ? /^(0|-?[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)
  )
    throw new VoteError("INVALID_RESPONSE");
  return value;
}
function exactKeys(
  object: Record<string, unknown>,
  keys: readonly (string | number)[],
) {
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  )
    throw new VoteError("INVALID_RESPONSE");
}
export function parseSnapshot(input: unknown): Snapshot {
  const raw = record(input);
  if (
    raw.version !== CONTENT_VERSION ||
    typeof raw.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.updatedAt))
  )
    throw new VoteError("INVALID_RESPONSE");
  const count = integer(raw.count),
    revision = integer(raw.revision),
    scoreSum = integer(raw.scoreSum, true);
  const n = BigInt(count),
    sum = BigInt(scoreSum);
  if (sum < -100n * n || sum > 100n * n)
    throw new VoteError("INVALID_RESPONSE");
  const cases = record(raw.caseCounts),
    axes = record(raw.axisSums),
    verdicts = record(raw.verdictCounts);
  exactKeys(cases, CASE_ORDER);
  exactKeys(
    axes,
    AXES.map((a) => a.id),
  );
  exactKeys(
    verdicts,
    VERDICTS.map((v) => v.id),
  );
  let derivedSum = 0n;
  for (const id of CASE_ORDER) {
    const counts = record(cases[id]);
    exactKeys(counts, SCORES);
    let caseCount = 0n;
    for (const score of SCORES) {
      const value = BigInt(integer(counts[score]));
      caseCount += value;
      derivedSum += BigInt(score) * value;
    }
    if (caseCount !== n) throw new VoteError("INVALID_RESPONSE");
  }
  if (derivedSum !== sum) throw new VoteError("INVALID_RESPONSE");
  for (const axis of AXES) {
    if (BigInt(integer(axes[axis.id])) > 100n * n)
      throw new VoteError("INVALID_RESPONSE");
  }
  if (
    VERDICTS.reduce(
      (total, v) => total + BigInt(integer(verdicts[v.id])),
      0n,
    ) !== n
  )
    throw new VoteError("INVALID_RESPONSE");
  // Copy only the public contract. A response cannot accidentally carry an identity into cards.
  return structuredClone({
    version: raw.version,
    revision,
    updatedAt: raw.updatedAt,
    count,
    scoreSum,
    caseCounts: cases,
    axisSums: axes,
    verdictCounts: verdicts,
  }) as Snapshot;
}
function parseBallot(input: unknown): Ballot {
  const raw = record(input);
  if (raw.version !== CONTENT_VERSION) throw new VoteError("VERSION_CHANGED");
  return {
    version: raw.version,
    answers: validateAnswers(raw.answers),
    revision: integer(raw.revision),
  };
}
export function parseReceipt(input: unknown): SubmitReceipt {
  const raw = record(input);
  const receipt = {
    ballot: parseBallot(raw.ballot),
    snapshot: parseSnapshot(raw.snapshot),
  };
  if (
    receipt.ballot.version !== receipt.snapshot.version ||
    BigInt(receipt.snapshot.count) === 0n
  )
    throw new VoteError("INVALID_RESPONSE");
  return receipt;
}
function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new VoteError("NOT_CONFIGURED");
  return client;
}
export async function loadOwnBallot(
  version: ContentVersion,
): Promise<Ballot | null> {
  const client = requireClient();
  const session = await client.auth.getSession();
  if (session.error) throw new VoteError("NETWORK_ERROR");
  if (!session.data.session) throw new VoteError("UNAUTHENTICATED");
  const { data, error } = await client
    .from("ballots")
    .select("version,answers,revision::text")
    .eq("version", version)
    .eq("participant_id", session.data.session.user.id)
    .maybeSingle();
  if (error) throw new VoteError("NETWORK_ERROR");
  return data ? parseBallot(data) : null;
}
export async function loadSnapshot(version: ContentVersion): Promise<Snapshot> {
  const { data, error } = await requireClient()
    .from("aggregate_snapshots")
    .select("payload")
    .eq("version", version)
    .single();
  if (error) throw new VoteError("NETWORK_ERROR");
  return parseSnapshot(data.payload);
}
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;
function rpcError(error: { message: string; code?: string }): VoteError {
  for (const code of Object.keys(messages) as VoteErrorCode[])
    if (error.message.includes(code)) return new VoteError(code);
  if (error.code === "PGRST301" || error.code === "42501")
    return new VoteError("UNAUTHENTICATED");
  return new VoteError("NETWORK_ERROR");
}
/** Retry only an uncertain transport result, keeping request identity and ballot owner. */
export function createSubmitter(
  rpc: Rpc,
  participantId: () => Promise<string | null>,
  parse = parseReceipt,
) {
  return async (request: SubmitRequest): Promise<SubmitReceipt> => {
    const answers = validateAnswers(request.answers);
    if (request.version !== CONTENT_VERSION)
      throw new VoteError("VERSION_CHANGED");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        request.requestId,
      )
    )
      throw new VoteError("INVALID_ANSWERS");
    integer(request.expectedRevision);
    const owner = await participantId();
    if (!owner) throw new VoteError("UNAUTHENTICATED");
    const args = {
      p_version: request.version,
      p_answers: CASE_ORDER.map((caseId) => ({
        caseId,
        score: answers[caseId],
      })),
      p_request_id: request.requestId,
      p_expected_revision: request.expectedRevision,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt && (await participantId()) !== owner)
        throw new VoteError("UNAUTHENTICATED");
      try {
        const { data, error } = await rpc("submit_ballot", args);
        if (error) throw rpcError(error);
        return parse(data);
      } catch (error) {
        if (error instanceof VoteError && error.code !== "NETWORK_ERROR")
          throw error;
        if (attempt === 1) throw new VoteError("NETWORK_ERROR");
      }
    }
    throw new VoteError("NETWORK_ERROR");
  };
}
export function submitBallot(request: SubmitRequest): Promise<SubmitReceipt> {
  const client = requireClient();
  return createSubmitter(
    (name, args) => client.rpc(name, args),
    async () => {
      const { data, error } = await client.auth.getSession();
      if (error) throw new VoteError("NETWORK_ERROR");
      return data.session?.user.id ?? null;
    },
  )(request);
}
