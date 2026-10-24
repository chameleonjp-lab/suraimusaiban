import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Answers, SubmitReceipt, SubmitRequest } from "../../src/domain/types";
import { CASE_ORDER } from "../../src/domain/content";
import type { TrialState } from "../../src/features/trial/state";
const boundary = vi.hoisted(() => ({
  trial: null as null | { state: TrialState; submit: (answers: Answers, state: TrialState) => void },
  submit: vi.fn(),
  result: vi.fn(),
}));
vi.mock("../../src/scene", () => ({mountScene: vi.fn()}));
vi.mock("../../src/platform/supabase-client", () => ({isBackendConfigured: () => true}));
vi.mock("../../src/features/vote/vote-api", () => ({submitBallot: boundary.submit}));
vi.mock("../../src/features/trial/view", () => ({mountTrial: (_target: unknown, state: TrialState, submit: (answers: Answers, state: TrialState) => void) => { boundary.trial = {state, submit}; return () => {boundary.trial = null;}; }}));
vi.mock("../../src/features/results/result-view", () => ({renderResults: boundary.result}));
vi.mock("../../src/features/status/status-view", () => ({renderStatus: () => () => {}}));
vi.mock("../../src/features/share/x-share", () => ({homeShare: () => ({}), xShareLink: () => ({})}));
import { mountApp, navigate } from "../../src/app";
class Node {
  innerHTML = "";
  onclick: unknown;
  isConnected = true;
  children = new Map<string, Node>();
  querySelector(selector: string): Node | null {
    if (selector === "canvas") return null;
    if (!this.children.has(selector)) this.children.set(selector, new Node());
    return this.children.get(selector)!;
  }
  querySelectorAll() { return []; }
  append() {}
  replaceChildren() { this.innerHTML = ""; }
  insertAdjacentHTML() {}
  remove() {}
}
let events: EventTarget, stop: () => void;
const answers = Object.fromEntries(CASE_ORDER.map(id => [id, 1])) as Answers;
const receipt = {ballot: {version:"v1",answers},snapshot:{count:"0"}} as SubmitReceipt;
beforeEach(() => {
  boundary.submit.mockReset();
  boundary.result.mockReset().mockReturnValue(() => {});
  events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  vi.stubGlobal("matchMedia", () => ({matches:true,addEventListener() {},removeEventListener() {}}));
  vi.stubGlobal("location", {hash:"",pathname:"/"});
  vi.stubGlobal("history", {pushState: vi.fn()});
  vi.stubGlobal("window", {scrollTo() {}});
  stop = mountApp(new Node() as unknown as HTMLElement);
});
afterEach(() => {stop(); vi.unstubAllGlobals();});
it("ignores a completed submission after leaving the trial and starts again empty", async () => {
  let resolve!: (value: SubmitReceipt) => void;
  boundary.submit.mockImplementation(() => new Promise<SubmitReceipt>(r => {resolve=r;}));
  navigate("trial");
  const trial = boundary.trial!;
  trial.submit(answers, {...trial.state,draft:answers});
  navigate("home");
  resolve(receipt);
  await Promise.resolve();
  expect(boundary.result).not.toHaveBeenCalled();
  navigate("trial");
  expect(boundary.trial!.state.draft).toEqual({});
});
it("purges current answers on pagehide before a bfcache snapshot", () => {
  navigate("trial");
  expect(boundary.trial).not.toBeNull();
  events.dispatchEvent(new Event("pagehide"));
  expect(boundary.trial).toBeNull();
});
it("reuses the original request on explicit retry instead of creating a second response", async () => {
  boundary.submit.mockRejectedValueOnce(Error("offline")).mockResolvedValue(receipt);
  navigate("trial");
  const trial = boundary.trial!;
  trial.submit(answers, {...trial.state,draft:answers});
  await Promise.resolve();
  // The app keeps the same pending request even if a stale view callback runs.
  trial.submit(answers, {...trial.state,draft:answers});
  await Promise.resolve();
  const first = boundary.submit.mock.calls[0][0] as SubmitRequest;
  expect(boundary.submit.mock.calls[1][0]).toEqual(first);
  expect(first).not.toHaveProperty("expectedRevision");
});
it("aborts an outstanding submission when navigation discards the trial", () => {
  boundary.submit.mockImplementation(() => new Promise(() => {}));
  navigate("trial");
  const trial = boundary.trial!;
  trial.submit(answers,{...trial.state,draft:answers});
  const signal = boundary.submit.mock.calls[0][1] as AbortSignal | undefined;
  navigate("home");
  expect(signal?.aborted).toBe(true);
});
