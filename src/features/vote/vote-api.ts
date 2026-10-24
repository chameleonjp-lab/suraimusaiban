import {
  AXES,
  CASE_ORDER,
  CONTENT_VERSION,
  SCORES,
  VERDICTS,
} from "../../domain/content";
import { validateAnswers } from "../../domain/scoring";
import type {
  ContentVersion,
  Snapshot,
  SubmitReceipt,
  SubmitRequest,
} from "../../domain/types";
import {
  getSupabaseClient,
  getSubmissionConfig,
} from "../../platform/supabase-client";

const messages = {
  INVALID_ANSWERS: "20件の回答を確認してください。",
  VERSION_CHANGED:
    "内容が更新されたか、回答受付が停止しています。ホームから確認してください。",
  RATE_LIMITED: "送信が続いています。しばらく待って再度お試しください。",
  NETWORK_ERROR: "送信の成否を確認できません。同じ送信を再確認してください。",
  NOT_CONFIGURED: "未送信プレビューです。送信先に接続されていません。",
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
/** Personal answers come only from the current in-memory request. */
export function parseReceipt(
  input: unknown,
  request: SubmitRequest,
): SubmitReceipt {
  const raw = record(input);
  if (raw.accepted !== true || typeof raw.duplicate !== "boolean")
    throw new VoteError("INVALID_RESPONSE");
  return {
    ballot: {
      version: request.version,
      answers: validateAnswers(request.answers),
    },
    snapshot: parseSnapshot(raw.snapshot),
  };
}
function requireClient() {
  const client = getSupabaseClient();
  if (!client) throw new VoteError("NOT_CONFIGURED");
  return client;
}
export async function loadSnapshot(version: ContentVersion): Promise<Snapshot> {
  const { data, error } = await requireClient()
    .from("slime_trial_aggregate_snapshots")
    .select("payload")
    .eq("version", version)
    .single();
  if (error) throw new VoteError("NETWORK_ERROR");
  return parseSnapshot(data.payload);
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;
/** Retries uncertain transport once, retaining the exact request body and public key. */
export function createSubmitter(
  transport: Transport,
  endpoint: string,
  publicKey: string,
) {
  return async (
    request: SubmitRequest,
    signal?: AbortSignal,
  ): Promise<SubmitReceipt> => {
    const answers = validateAnswers(request.answers);
    if (request.version !== CONTENT_VERSION)
      throw new VoteError("VERSION_CHANGED");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        request.requestId,
      )
    )
      throw new VoteError("INVALID_ANSWERS");
    const captured = {
      version: request.version,
      requestId: request.requestId,
      answers,
    };
    const body = JSON.stringify({
      version: captured.version,
      requestId: captured.requestId,
      answers: CASE_ORDER.map((caseId) => ({ caseId, score: answers[caseId] })),
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await transport(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: publicKey },
          body,
          credentials: "omit",
          ...(signal ? { signal } : {}),
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          const code = record(data).error;
          if (typeof code === "string" && Object.hasOwn(messages, code))
            throw new VoteError(code as VoteErrorCode);
          throw new VoteError("NETWORK_ERROR");
        }
        return parseReceipt(data, captured);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof VoteError && error.code !== "NETWORK_ERROR")
          throw error;
        if (attempt === 1) throw new VoteError("NETWORK_ERROR");
      }
    }
    throw new VoteError("NETWORK_ERROR");
  };
}
export async function submitBallot(
  request: SubmitRequest,
  signal?: AbortSignal,
): Promise<SubmitReceipt> {
  const config = getSubmissionConfig();
  if (!config) throw new VoteError("NOT_CONFIGURED");
  return createSubmitter(
    (url, init) => fetch(url, init),
    config.endpoint,
    config.publicKey,
  )(request, signal);
}
