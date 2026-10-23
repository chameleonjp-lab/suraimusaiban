import { expect, it } from "vitest";
import type { SubmitReceipt } from "../../src/domain/types";
import {
  openResult,
  clearResult,
  getResult,
} from "../../src/features/results/result-state";
it("copies and freezes the receipt so later mutations cannot change the displayed comparison", () => {
  const ids = [
    "H01",
    "H02",
    "H03",
    "H04",
    "H05",
    "H06",
    "H07",
    "H08",
    "H09",
    "H10",
    "K01",
    "K02",
    "K03",
    "K04",
    "K05",
    "K06",
    "K07",
    "K08",
    "K09",
    "K10",
  ];
  const receipt = {
    ballot: {
      version: "v1",
      revision: "1",
      answers: Object.fromEntries(ids.map((id) => [id, 5])),
    },
    snapshot: {
      version: "v1",
      revision: "1",
      updatedAt: "2026-10-23T00:00:00Z",
      count: "1",
      scoreSum: "100",
      caseCounts: {},
      axisSums: {},
      verdictCounts: {},
    },
  } as SubmitReceipt;
  const result = openResult(receipt);
  expect(result.individual.total).toBe(100);
  expect(result.individual.verdict).toBe("P5");
  receipt.snapshot.revision = "2";
  expect(result.receipt.snapshot.revision).toBe("1");
  expect(Object.isFrozen(result.receipt.ballot.answers)).toBe(true);
  expect(getResult()).toBe(result);
  clearResult();
  expect(getResult()).toBeNull();
});

// Network and Realtime are external boundaries; actual revision ordering/timers run here.
import { beforeEach, afterEach, vi, describe } from "vitest";
import type { Snapshot } from "../../src/domain/types";
import { watchSnapshot } from "../../src/features/status/status-feed";
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../src/features/vote/vote-api", () => ({ loadSnapshot: load }));
vi.mock("../../src/platform/supabase-client", () => ({
  getSupabaseClient: () => null,
}));
function feedSnapshot(revision: string): Snapshot {
  return {
    version: "v1",
    revision,
    updatedAt: "2026-10-23T00:00:00Z",
    count: "0",
    scoreSum: "0",
    caseCounts: {},
    axisSums: {},
    verdictCounts: {},
  } as Snapshot;
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
describe("public snapshot watcher", () => {
  let doc: EventTarget & { visibilityState: string },
    win: EventTarget,
    stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    load.mockReset();
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    win = new EventTarget();
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("discards an older in-flight revision after a newer response", async () => {
    let resolveOld!: (s: Snapshot) => void;
    load
      .mockImplementationOnce(
        () =>
          new Promise<Snapshot>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(feedSnapshot("9"));
    const received: string[] = [];
    stop = watchSnapshot(
      "v1",
      (s) => received.push(s.revision),
      () => {},
    );
    win.dispatchEvent(
      new CustomEvent("slime:refresh-snapshot", { detail: "v1" }),
    );
    await flush();
    resolveOld(feedSnapshot("8"));
    await flush();
    expect(received).toEqual(["9"]);
  });
  it("ignores an old request failure after a newer successful refresh", async () => {
    let rejectOld!: (e: Error) => void;
    load
      .mockImplementationOnce(
        () =>
          new Promise<Snapshot>((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValueOnce(feedSnapshot("9"));
    let errors = 0;
    const received: string[] = [];
    stop = watchSnapshot(
      "v1",
      (s) => received.push(s.revision),
      () => errors++,
    );
    win.dispatchEvent(
      new CustomEvent("slime:refresh-snapshot", { detail: "v1" }),
    );
    await flush();
    rejectOld(new Error("old timeout"));
    await flush();
    expect(received).toEqual(["9"]);
    expect(errors).toBe(0);
  });
  it("retains the previous snapshot on failure, then reports recovery even if the revision is unchanged", async () => {
    load
      .mockResolvedValueOnce(feedSnapshot("3"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(feedSnapshot("3"));
    let last: Snapshot | undefined,
      errors = 0,
      recovered = 0;
    stop = watchSnapshot(
      "v1",
      (s) => {
        last = s;
        recovered++;
      },
      () => errors++,
    );
    await flush();
    win.dispatchEvent(
      new CustomEvent("slime:refresh-snapshot", { detail: "v1" }),
    );
    await flush();
    expect(last?.revision).toBe("3");
    expect(errors).toBe(1);
    win.dispatchEvent(
      new CustomEvent("slime:refresh-snapshot", { detail: "v1" }),
    );
    await flush();
    expect(recovered).toBe(2);
  });
  it("polls every thirty seconds only while visible and refreshes on return", async () => {
    load.mockResolvedValue(feedSnapshot("1"));
    stop = watchSnapshot(
      "v1",
      () => {},
      () => {},
    );
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
    stop = undefined;
    await vi.advanceTimersByTimeAsync(60000);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
