import { describe, expect, it } from "vitest";
import { createSubmitHandler, type SubmitHandlerConfig } from "../../supabase/functions/slime-trial-submit/handler";

const origin = "https://chameleonjp-lab.github.io";
const caseIds = ["H", "K"].flatMap(prefix => Array.from({length: 10}, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
const scores = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
const requestBody = () => ({ version: "v1", requestId: "66085383-7255-40df-9a2d-3f427f9962b0", answers: caseIds.map(caseId => ({caseId, score: 1})) });
const snapshot = () => ({
  version: "v1", revision: "0", updatedAt: "2026-10-24T00:00:00.000Z", count: "0", scoreSum: "0",
  caseCounts: Object.fromEntries(caseIds.map(id => [id, Object.fromEntries(scores.map(score => [score, "0"]))])),
  axisSums: Object.fromEntries(Array.from({length: 10}, (_, i) => [i + 1, "0"])),
  verdictCounts: Object.fromEntries(["N5", "N4", "N3", "N2", "N1", "Z", "P1", "P2", "P3", "P4", "P5"].map(id => [id, "0"])),
});
const success = () => ({accepted: true, duplicate: false, snapshot: snapshot()});
function setup(overrides: Partial<SubmitHandlerConfig> = {}) {
  const calls: {url: string; init?: RequestInit}[] = [];
  const config: SubmitHandlerConfig = {
    supabaseUrl: "https://project.supabase.co", serviceKey: "server-secret-do-not-expose", publicKeys: ["project-public-key"],
    now: () => Date.parse("2026-10-24T12:20:00.000Z"),
    fetch: async (url, init) => { calls.push({url: String(url), init}); return Response.json(success()); }, ...overrides,
  };
  return {handler: createSubmitHandler(config), calls};
}
function request(body: unknown = requestBody(), headers: Record<string, string> = {}, method = "POST") {
  return new Request("https://project.supabase.co/functions/v1/slime-trial-submit", {method, headers: {origin, apikey: "project-public-key", "content-type": "application/json", ...headers}, ...(method === "POST" ? {body: typeof body === "string" ? body : JSON.stringify(body)} : {})});
}

describe("anonymous submission Edge gate", () => {
  it("accepts the complete public payload and calls only the service RPC, without Auth", async () => {
    const {handler, calls} = setup();
    const body = requestBody(); body.answers.reverse();
    const response = await handler(request(body, {authorization: "Bearer untrusted-visitor-value", "x-forwarded-for": "10.0.0.1, 203.0.113.20"}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(success());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://project.supabase.co/rest/v1/rpc/slime_trial_collect_response");
    expect(calls[0].init?.headers).toEqual({apikey: "server-secret-do-not-expose", "Content-Type": "application/json"});
    const sent = JSON.parse(calls[0].init?.body as string);
    expect(sent).toEqual({p_version: "v1", p_request_id: body.requestId, p_answers: requestBody().answers, p_source_key: expect.stringMatching(/^[a-f0-9]{64}$/), p_previous_source_key: expect.stringMatching(/^[a-f0-9]{64}$/), p_next_source_key: expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(sent.p_source_key).not.toBe(sent.p_previous_source_key);
    expect(new Set([sent.p_source_key, sent.p_previous_source_key, sent.p_next_source_key]).size).toBe(3);
    expect(JSON.stringify(sent)).not.toContain("203.0.113.20");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init?.redirect).toBe("error");
  });

  it.each([
    ["sb_secret_server-only", {apikey: "sb_secret_server-only", "Content-Type": "application/json"}],
    ["eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature", {apikey: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature", Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature", "Content-Type": "application/json"}],
  ] satisfies [string, Record<string, string>][])("uses compatible REST headers for server key %s", async (serviceKey, expectedHeaders) => {
    const {handler, calls} = setup({serviceKey});
    expect((await handler(request())).status).toBe(200);
    expect(calls[0].init?.headers).toEqual(expectedHeaders);
  });

  it("handles allowed preflights without requiring a visitor session or a key", async () => {
    const {handler, calls} = setup();
    const response = await handler(new Request("https://project.supabase.co/gate", {method: "OPTIONS", headers: {origin, "access-control-request-method": "POST", "access-control-request-headers": "apikey,content-type"}}));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toContain("apikey");
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["GET", {}],
    ["POST", {origin: "https://evil.example"}],
    ["POST", {origin: "null"}],
    ["POST", {origin: ""}],
    ["POST", {apikey: "wrong-project"}],
    ["POST", {apikey: "x".repeat(4096)}],
    ["POST", {"content-type": "text/plain"}],
    ["OPTIONS", {"access-control-request-method": "DELETE"}],
    ["OPTIONS", {"access-control-request-method": "POST", "access-control-request-headers": "x-secret"}],
  ] satisfies [string, Record<string, string>][])("rejects invalid method/origin/public-key/content-type/preflight %# before database work", async (method, headers) => {
    const {handler, calls} = setup();
    const response = await handler(request(requestBody(), headers, method));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    if ("origin" in headers && ["https://evil.example", "null", ""].includes(headers.origin)) expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("accepts injected local origins while preserving the same key and payload boundary", async () => {
    const {handler} = setup({allowedOrigins: ["http://127.0.0.1:4173"]});
    const response = await handler(request(requestBody(), {origin: "http://127.0.0.1:4173", "content-type": "application/json; charset=utf-8"}));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4173");
  });

  const invalidBodies = [
    null, [], {}, "{", { ...requestBody(), version: "v2" }, { ...requestBody(), requestId: "anything" },
    {...requestBody(), participantId: "never"}, {...requestBody(), total: 20}, {...requestBody(), expectedRevision: "0"},
    {...requestBody(), answers: {}}, {...requestBody(), answers: requestBody().answers.slice(1)},
    {...requestBody(), answers: [...requestBody().answers, {caseId: "H01", score: 1}]},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, score: 0} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, score: 1.5} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, score: "1"} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, score: 6} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, caseId: "H11"} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, caseId: "K01"} : answer)},
    {...requestBody(), answers: requestBody().answers.map((answer, i) => i === 0 ? {...answer, identity: "never"} : answer)},
  ];
  it.each(invalidBodies)("rejects invalid payload %# before database work", async body => {
    const {handler, calls} = setup();
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await response.json()).toEqual({error: "INVALID_ANSWERS"});
  });

  it("bounds actual streamed bytes even with missing or dishonest Content-Length", async () => {
    for (const declaredLength of [undefined, "1"]) {
      const {handler, calls} = setup();
      let cancelled = false;
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({pull(controller) { pulled++; controller.enqueue(new Uint8Array(4096).fill(32)); }, cancel() {cancelled = true;} });
      const req = new Request("https://project.supabase.co/gate", {method: "POST", headers: {origin, apikey: "project-public-key", "content-type": "application/json", ...(declaredLength ? {"content-length": declaredLength} : {})}, body: stream, duplex: "half"} as RequestInit);
      expect((await handler(req)).status).toBe(400);
      expect(calls).toHaveLength(0);
      expect(cancelled).toBe(true);
      expect(pulled).toBeLessThanOrEqual(4);
    }
  });

  it("enforces the 8192-byte boundary and rejects invalid UTF-8", async () => {
    const {handler, calls} = setup();
    const json = JSON.stringify(requestBody());
    expect((await handler(request(json.padEnd(8192, " ")))).status).toBe(200);
    expect((await handler(request(json.padEnd(8193, " ")))).status).toBe(400);
    const malformed = new Request("https://project.supabase.co/gate", {method: "POST", headers: {origin, apikey: "project-public-key", "content-type": "application/json"}, body: new Uint8Array([0xff])});
    expect((await handler(malformed)).status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it.each(["{", JSON.stringify(requestBody())])("cancels stalled request stream %# within a finite deadline before database work", async partial => {
    const {handler, calls} = setup({timeoutMs: 5});
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(new TextEncoder().encode(partial));}, cancel() {cancelled = true;} });
    const req = new Request("https://project.supabase.co/gate", {method: "POST", headers: {origin, apikey: "project-public-key", "content-type": "application/json"}, body: stream, duplex: "half"} as RequestInit);
    const result = await Promise.race([handler(req), new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
    expect(result?.status).toBe(400);
    expect(cancelled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("rotates a server-derived network bucket hourly and ignores untrusted leading proxy values", async () => {
    let now = Date.parse("2026-10-24T12:20:00Z");
    const {handler, calls} = setup({now: () => now});
    for (const ip of ["evil-client, 203.0.113.20", "other-client, 203.0.113.20", "203.0.113.21"]) await handler(request(requestBody(), {"x-forwarded-for": ip}));
    now += 3600_000;
    await handler(request(requestBody(), {"x-forwarded-for": "203.0.113.20"}));
    const payloads = calls.map(call => JSON.parse(call.init!.body as string));
    const keys = payloads.map(payload => payload.p_source_key);
    expect(keys[0]).toBe(keys[1]); expect(keys[0]).not.toBe(keys[2]); expect(keys[0]).not.toBe(keys[3]);
    expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(payloads[0].p_previous_source_key).toMatch(/^[a-f0-9]{64}$/);
    expect(payloads[0].p_previous_source_key).toBe(payloads[1].p_previous_source_key);
    expect(payloads[0].p_previous_source_key).not.toBe(payloads[2].p_previous_source_key);
    expect(payloads[3].p_previous_source_key).toBe(keys[0]);
    expect(payloads[0].p_next_source_key).toMatch(/^[a-f0-9]{64}$/);
    expect(payloads[0].p_next_source_key).toBe(keys[3]);
    expect(payloads[0].p_next_source_key).toBe(payloads[1].p_next_source_key);
    expect(payloads[0].p_next_source_key).not.toBe(payloads[2].p_next_source_key);
    expect(payloads.every(payload => new Set([payload.p_source_key, payload.p_previous_source_key, payload.p_next_source_key]).size === 3)).toBe(true);
    expect(payloads.every(payload => payload.p_source_key !== payload.p_previous_source_key)).toBe(true);
    expect(JSON.stringify(payloads)).not.toContain("203.0.113.");
    const differentSecret = setup({serviceKey: "different-server-secret"});
    await differentSecret.handler(request(requestBody(), {"x-forwarded-for": "203.0.113.20"}));
    expect(JSON.parse(differentSecret.calls[0].init!.body as string).p_source_key).not.toBe(keys[0]);
  });

  it("uses one shared fallback for absent, oversized, invalid source headers and ignores client IDs", async () => {
    const {handler, calls} = setup();
    const headers: Record<string, string>[] = [{}, {"x-forwarded-for": "x".repeat(3000)}, {"x-forwarded-for": "203.0.113.2, nope"}, {"x-real-ip": "203.0.113.99", "cf-connecting-ip": "203.0.113.99", "x-participant-id": "arbitrary"}, {"x-forwarded-for": "999.999.999.999"}, {"x-forwarded-for": "1.2.3.4:443"}];
    for (const value of headers) expect((await handler(request(requestBody(), value))).status).toBe(200);
    expect(new Set(calls.map(call => JSON.parse(call.init!.body as string).p_source_key)).size).toBe(1);
  });

  it("canonicalizes equivalent IPv6 source addresses", async () => {
    const {handler, calls} = setup();
    for (const ip of ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001"]) await handler(request(requestBody(), {"x-forwarded-for": ip}));
    expect(JSON.parse(calls[0].init!.body as string).p_source_key).toBe(JSON.parse(calls[1].init!.body as string).p_source_key);
  });

  it.each([
    ["INVALID_ANSWERS", 400], ["VERSION_CHANGED", 400], ["RATE_LIMITED", 429], ["secret SQL and 203.0.113.2", 503],
  ])("sanitizes upstream error %s", async (message, status) => {
    const {handler} = setup({fetch: async () => Response.json({code: "P0001", message, details: "server-secret-do-not-expose", hint: requestBody()}, {status: 400})});
    const response = await handler(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({error: status === 503 ? "UNAVAILABLE" : message});
    expect(response.headers.get("retry-after")).toBe(status === 429 ? "60" : null);
  });

  it("does not interpret upstream infrastructure errors as trusted validation or rate errors", async () => {
    const {handler} = setup({fetch: async () => Response.json({message: "RATE_LIMITED"}, {status: 503})});
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error: "UNAVAILABLE"});
  });

  it("sanitizes transport failures and aborts a hung RPC", async () => {
    const failed = setup({fetch: async () => {throw Error("server-secret-do-not-expose");}});
    expect(await (await failed.handler(request())).json()).toEqual({error: "UNAVAILABLE"});
    let aborted = false;
    const timed = setup({timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener("abort", () => {aborted = true; reject(Error("timeout secret"));}); })});
    expect((await timed.handler(request())).status).toBe(503);
    expect(aborted).toBe(true);
  });

  it("preserves safe duplicates but rejects extra upstream data anywhere in the response", async () => {
    const duplicate = setup({fetch: async () => Response.json({...success(), duplicate: true})});
    expect(await (await duplicate.handler(request())).json()).toEqual({...success(), duplicate: true});
    const bad = [
      {...success(), answers: requestBody().answers}, {...success(), snapshot: {...snapshot(), privateCount: "9"}},
      {...success(), accepted: false}, {...success(), snapshot: {...snapshot(), count: "1"}},
      {...success(), snapshot: {...snapshot(), caseCounts: {...snapshot().caseCounts, secret: "never"}}},
    ];
    for (const body of bad) {
      const {handler} = setup({fetch: async () => Response.json(body)});
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: "UNAVAILABLE"});
    }
  });
});
