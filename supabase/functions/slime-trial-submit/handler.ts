/** Server-only configuration. The local harness may inject loopback origins,
 * fetch, and a clock; production uses the default Pages origin. publicKeys are
 * this project's public API keys, not proof of identity or humanity. serviceKey
 * stays server side and also roots a purpose-separated source HMAC key. */
export type SubmitHandlerConfig = {
  supabaseUrl: string;
  serviceKey: string;
  publicKeys: readonly string[];
  allowedOrigins?: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

const CASE_IDS = ["H", "K"].flatMap(prefix => Array.from({length: 10}, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
const SCORES = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
const SCORE_KEYS = SCORES.map(String);
const AXIS_KEYS = Array.from({length: 10}, (_, i) => String(i + 1));
const VERDICTS = ["N5", "N4", "N3", "N2", "N1", "Z", "P1", "P2", "P3", "P4", "P5"];
const PREFLIGHT_HEADERS = ["apikey", "content-type", "authorization", "x-client-info"];
const encoder = new TextEncoder();
type JsonObject = Record<string, unknown>;
type ValidBody = {version: "v1"; requestId: string; answers: {caseId: string; score: number}[]};

function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is JsonObject {
  return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function parseBody(value: unknown): ValidBody | null {
  if (!exact(value, ["version", "requestId", "answers"]) || value.version !== "v1" ||
      typeof value.requestId !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.requestId) ||
      !Array.isArray(value.answers) || value.answers.length !== 20) return null;
  const byCase = new Map<string, number>();
  for (const answer of value.answers) {
    if (!exact(answer, ["caseId", "score"]) || typeof answer.caseId !== "string" || !CASE_IDS.includes(answer.caseId) ||
        typeof answer.score !== "number" || !SCORES.includes(answer.score) || byCase.has(answer.caseId)) return null;
    byCase.set(answer.caseId, answer.score);
  }
  return {version: "v1", requestId: value.requestId.toLowerCase(), answers: CASE_IDS.map(caseId => ({caseId, score: byCase.get(caseId)!}))};
}

/** Read actual bytes: Content-Length is deliberately not a source of truth. */
async function readJson(body: ReadableStream<Uint8Array> | null, limit: number, timeoutMs: number): Promise<unknown> {
  if (!body) throw Error("missing body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    // Reject before cancellation resolves a pending read as `done`; otherwise
    // a valid JSON prefix on a stalled stream could be treated as complete.
    timeout = setTimeout(() => { reject(Error("body timeout")); void reader.cancel().catch(() => {}); }, timeoutMs);
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw Error("body limit");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch (error) {
    // Do not wait for an untrusted producer's cancel callback to finish.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    reader.releaseLock();
  }
}

/** Supabase's gateway appends its observed address LAST. This is a best-effort
 * network bucket, never an identity guarantee: upstream header trust matters.
 * Invalid/missing headers share one fallback; no client ID or alternate header
 * can create arbitrary fallback buckets. Neither this value nor answers log. */
function sourceAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded || forwarded.length > 2048) return "shared";
  const entries = forwarded.split(",");
  if (entries.length > 64) return "shared";
  const last = entries.at(-1)!.trim();
  if (last.length > 64) return "shared";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(last)) {
    const octets = last.split(".");
    if (octets.every(octet => String(Number(octet)) === octet && Number(octet) <= 255)) return `ip:${last}`;
  } else if (last.includes(":") && /^[a-f\d:.]+$/i.test(last)) {
    try { return `ip:${new URL(`http://[${last}]/`).hostname}`; } catch { /* shared fallback */ }
  }
  return "shared";
}

async function sourceKey(secret: string, address: string, now: number): Promise<string> {
  const root = await crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const derived = await crypto.subtle.sign("HMAC", root, encoder.encode("slime-trial-submit/source-key/v1"));
  const key = await crypto.subtle.importKey("raw", derived, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${Math.floor(now / 3_600_000)}:${address}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function decimal(value: unknown, signed = false): value is string {
  return typeof value === "string" && value.length <= 40 && (signed ? /^(0|-?[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value);
}
/** Exact keys at every level keep accidental SQL diagnostics or new private
 * fields out of the public response. Only published snapshot fields may pass. */
function safeSuccess(value: unknown): boolean {
  if (!exact(value, ["accepted", "duplicate", "snapshot"]) || value.accepted !== true || typeof value.duplicate !== "boolean") return false;
  const s = value.snapshot;
  if (!exact(s, ["version", "revision", "updatedAt", "count", "scoreSum", "caseCounts", "axisSums", "verdictCounts"]) ||
      s.version !== "v1" || !decimal(s.revision) || !decimal(s.count) || !decimal(s.scoreSum, true) ||
      typeof s.updatedAt !== "string" || s.updatedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(s.updatedAt) || !Number.isFinite(Date.parse(s.updatedAt)) ||
      !exact(s.caseCounts, CASE_IDS) || !exact(s.axisSums, AXIS_KEYS) || !exact(s.verdictCounts, VERDICTS)) return false;
  const count = BigInt(s.count);
  let scoreSum = 0n;
  for (const id of CASE_IDS) {
    const distribution = s.caseCounts[id];
    if (!exact(distribution, SCORE_KEYS)) return false;
    let total = 0n;
    for (const score of SCORES) {
      const n = distribution[String(score)];
      if (!decimal(n)) return false;
      total += BigInt(n); scoreSum += BigInt(n) * BigInt(score);
    }
    if (total !== count) return false;
  }
  if (scoreSum !== BigInt(s.scoreSum)) return false;
  for (const axis of AXIS_KEYS) {
    const sum = s.axisSums[axis];
    if (!decimal(sum) || BigInt(sum) > 100n * count) return false;
  }
  let verdictCount = 0n;
  for (const verdict of VERDICTS) {
    const n = s.verdictCounts[verdict];
    if (!decimal(n)) return false;
    verdictCount += BigInt(n);
  }
  return verdictCount === count;
}

export function createSubmitHandler(config: SubmitHandlerConfig): (request: Request) => Promise<Response> {
  const allowedOrigins = new Set(config.allowedOrigins ?? ["https://chameleonjp-lab.github.io"]);
  const publicKeys = new Set(config.publicKeys.filter(key => key.length > 0 && key.length <= 2048));
  const fetchRpc = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? 5000;
  // Opaque sb_secret keys are not JWTs. Current migration docs require apikey
  // only; legacy service_role JWTs also use Bearer authorization.
  // https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
  const serviceHeaders: Record<string, string> = {apikey: config.serviceKey, "Content-Type": "application/json"};
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(config.serviceKey) && !config.serviceKey.startsWith("sb_secret_")) {
    serviceHeaders.Authorization = `Bearer ${config.serviceKey}`;
  }
  const endpoint = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/slime_trial_collect_response`;
  return async request => {
    const origin = request.headers.get("origin") ?? "";
    const headers = new Headers({"Cache-Control": "no-store", "Vary": "Origin"});
    const allowed = origin.length <= 256 && allowedOrigins.has(origin);
    if (allowed) headers.set("Access-Control-Allow-Origin", origin);
    const error = (code: string, status = 400) => {
      if (status === 429) headers.set("Retry-After", "60");
      return Response.json({error: code}, {status, headers});
    };
    if (!allowed) return error("INVALID_REQUEST");
    if (request.method === "OPTIONS") {
      const requested = request.headers.get("access-control-request-headers") ?? "";
      if (request.headers.get("access-control-request-method") !== "POST" || requested.length > 256 ||
          (requested !== "" && requested.split(",").some(header => !PREFLIGHT_HEADERS.includes(header.trim().toLowerCase())))) return error("INVALID_REQUEST");
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", PREFLIGHT_HEADERS.join(", "));
      headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
      return new Response(null, {status: 204, headers});
    }
    if (request.method !== "POST") return error("INVALID_REQUEST");
    const key = request.headers.get("apikey") ?? "";
    if (key.length > 2048 || !publicKeys.has(key)) return error("INVALID_REQUEST");
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.length > 128 || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(contentType)) return error("INVALID_REQUEST");
    let body: ValidBody | null;
    try { body = parseBody(await readJson(request.body, 8192, timeoutMs)); } catch { return error("INVALID_ANSWERS"); }
    if (!body) return error("INVALID_ANSWERS");
    if (!config.serviceKey || !config.supabaseUrl || publicKeys.size === 0) return error("UNAVAILABLE", 503);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Construct service parameters explicitly. No visitor headers or unknown
      // client fields cross the privileged boundary; Auth is never consulted.
      const address = sourceAddress(request.headers);
      const stamp = now();
      // Supply adjacent epochs so SQL counts ten-minute operations across the
      // hourly rotation even if an older request arrives after a newer one.
      // Only the current bucket is written; no permanent identifier is needed.
      const [currentSourceKey, previousSourceKey, nextSourceKey] = await Promise.all([
        sourceKey(config.serviceKey, address, stamp),
        sourceKey(config.serviceKey, address, stamp - 3_600_000),
        sourceKey(config.serviceKey, address, stamp + 3_600_000),
      ]);
      const payload = {p_version: body.version, p_answers: body.answers, p_request_id: body.requestId,
        p_source_key: currentSourceKey, p_previous_source_key: previousSourceKey, p_next_source_key: nextSourceKey};
      const result = await Promise.race([
        (async () => {
          const response = await fetchRpc(endpoint, {method: "POST", headers: serviceHeaders,
            body: JSON.stringify(payload), signal: controller.signal, redirect: "error"});
          return {status: response.status, ok: response.ok, data: await readJson(response.body, 65_536, timeoutMs)};
        })(),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => {controller.abort(); reject(Error("RPC timeout"));}, timeoutMs); }),
      ]);
      if (result.ok) {
        if (!safeSuccess(result.data)) return error("UNAVAILABLE", 503);
        return Response.json(result.data, {status: 200, headers});
      }
      if ((result.status === 400 || result.status === 429) && object(result.data)) {
        const message = result.data.message;
        if (message === "RATE_LIMITED") return error(message, 429);
        if (result.status === 400 && (message === "INVALID_ANSWERS" || message === "VERSION_CHANGED")) return error(message);
      }
      return error("UNAVAILABLE", 503);
    } catch {
      // Never log/return upstream text, addresses, answers, or credentials.
      return error("UNAVAILABLE", 503);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}
