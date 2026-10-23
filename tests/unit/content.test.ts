import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AXES,
  CASES,
  CASE_ORDER,
  CONTENT_VERSION,
  SCORES,
  VERDICTS,
} from "../../src/domain/content";

const requirements = readFileSync(
  new URL("../../docs/requirements.md", import.meta.url),
  "utf8",
);

describe("versioned trial content", () => {
  it("provides the specified twenty unique cases in the fixed presentation order", () => {
    expect(CONTENT_VERSION).toBe("v1");
    expect(CASE_ORDER).toEqual([
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
    ]);
    expect(CASES).toHaveLength(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(20);
    expect(new Set(CASES.map((c) => c.id))).toEqual(new Set(CASE_ORDER));
    expect(SCORES).toEqual([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]);
  });

  it("preserves the complete fact and both interpretations from the requirements", () => {
    const sourceCases = [
      ...requirements.matchAll(
        /^## ([HK]\d{2}) (.+)\n\n事実：(.+)\n\n検察：(.+)\n\n弁護士：(.+)$/gm,
      ),
    ];
    expect(sourceCases).toHaveLength(20);
    for (const [, id, title, fact, prosecutor, defense] of sourceCases) {
      expect(CASES.find((c) => c.id === id)).toEqual({
        id,
        title,
        fact,
        prosecutor,
        defense,
      });
    }
  });

  it("assigns each case to exactly one of ten exclusive pairs", () => {
    expect(AXES).toHaveLength(10);
    expect(AXES.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const assigned = AXES.flatMap((axis) => [axis.h, axis.k]);
    expect(new Set(assigned).size).toBe(20);
    expect(new Set(assigned)).toEqual(new Set(CASE_ORDER));
    for (const axis of AXES) {
      expect(axis.h).toBe(`H${String(axis.id).padStart(2, "0")}`);
      expect(axis.k).toBe(`K${String(axis.id).padStart(2, "0")}`);
      expect(axis.label).not.toBe("");
      expect(axis.description).not.toBe("");
    }
  });

  it("provides eleven complete 300 Unicode code point stories matching their dispositions", () => {
    expect(VERDICTS.map((v) => v.id)).toEqual([
      "N5",
      "N4",
      "N3",
      "N2",
      "N1",
      "Z",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
    ]);
    const storySection = requirements
      .split("# 小説の表示規則")[1]
      .split("# 完成を確認する条件")[0];
    const sourceStories = [...storySection.matchAll(/^## (.+)\n\n([^\n]+)$/gm)];
    expect(sourceStories).toHaveLength(11);
    for (const [index, [, label, story]] of sourceStories.entries()) {
      expect(VERDICTS[index].label).toBe(label);
      expect(VERDICTS[index].story).toBe(story);
      expect([...VERDICTS[index].story]).toHaveLength(300);
      expect(VERDICTS[index].story).not.toMatch(/\s/);
      expect(VERDICTS[index].description).not.toBe("");
    }
  });
});
