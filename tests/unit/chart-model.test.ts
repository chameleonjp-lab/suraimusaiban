import { describe, expect, it } from "vitest";
import type { Answers, AxisValues, Snapshot } from "../../src/domain/types";
import {
  radarModel,
  caseModel,
  cumulativeModel,
  distributionModel,
  formatRatio,
  snapshotVerdict,
} from "../../src/charts/chart-model";
const ids = [
  "H01",
  "K06",
  "H02",
  "K07",
  "H03",
  "K08",
  "H04",
  "K09",
  "H05",
  "K10",
  "H06",
  "K01",
  "H07",
  "K02",
  "H08",
  "K03",
  "H09",
  "K04",
  "H10",
  "K05",
];
function snapshot(count = "2", sum = "0"): Snapshot {
  return {
    version: "v1",
    revision: "3",
    updatedAt: "2026-10-23T10:00:00Z",
    count,
    scoreSum: sum,
    caseCounts: Object.fromEntries(
      ids.map((id) => [
        id,
        Object.fromEntries(
          [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((s) => [
            s,
            s === -5 || s === 5 ? "1" : "0",
          ]),
        ),
      ]),
    ),
    axisSums: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [i + 1, "100"]),
    ),
    verdictCounts: {
      N5: "1",
      N4: "0",
      N3: "0",
      N2: "0",
      N1: "0",
      Z: "0",
      P1: "0",
      P2: "0",
      P3: "0",
      P4: "0",
      P5: "1",
    },
  } as Snapshot;
}
describe("chart models preserve the exact receipt and rational signs", () => {
  it("does not create an average radar or verdict for zero slime_trial_ballots", () => {
    expect(radarModel(null, snapshot("0", "0"))).toBeNull();
    expect(snapshotVerdict(snapshot("0", "0"))).toBeNull();
  });
  it("compares all ten axes on the same 0–100 scale", () => {
    const personal = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [i + 1, i * 10]),
    ) as AxisValues;
    const model = radarModel(personal, snapshot())!;
    expect(model.labels).toHaveLength(10);
    expect(model.min).toBe(0);
    expect(model.max).toBe(100);
    expect(model.series[0].values).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
    expect(model.series[1].values).toEqual(Array(10).fill(50));
  });
  it("retains polarized distribution when mean is exactly zero", () => {
    expect(snapshotVerdict(snapshot())).toBe("Z");
    expect(distributionModel(snapshot()).series[0].values).toEqual([
      50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50,
    ]);
  });
  it("never formats a tiny signed mean as zero or selects release", () => {
    expect(formatRatio("1", "100000000000000000000000000")).toBe("＋0.01未満");
    expect(formatRatio("-1", "1000000")).toBe("−0.01未満");
    expect(formatRatio("0", "2")).toBe("0");
    expect(formatRatio("5", "2")).toBe("＋2.5");
    expect(snapshotVerdict(snapshot("100000000000000000000000000", "1"))).toBe(
      "P1",
    );
  });
  it("uses fixed order for 20 answers and their cumulative sum", () => {
    const answers = Object.fromEntries(
      ids.map((id, i) => [id, i < 10 ? -5 : 5]),
    ) as Answers;
    expect(caseModel(answers).labels.map((s) => s.slice(0, 2))).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
    ]);
    expect(caseModel(answers).labels.join(" ")).not.toMatch(/[HK]\d{2}/);
    expect(cumulativeModel(answers).series[0].values).toEqual([
      -5, -10, -15, -20, -25, -30, -35, -40, -45, -50, -45, -40, -35, -30, -25,
      -20, -15, -10, -5, 0,
    ]);
  });
});
