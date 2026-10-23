import { describe, expect, it } from "vitest";
import { CASE_ORDER } from "../../src/domain/content";
import type { Answers } from "../../src/domain/types";
import { scoreAnswers } from "../../src/domain/scoring";
import {
  homeShare,
  resultShare,
  xShareUrl,
} from "../../src/features/share/x-share";

describe("dedicated X posts", () => {
  it("introduces the game from home using its canonical public URL", () => {
    const post = homeShare();
    expect(post.text).toContain("20の出来事");
    expect(post.text).toContain("#スライム裁判");
    expect(post.url).toBe("https://chameleonjp-lab.github.io/suraimusaiban/");
    expect(post.text).not.toContain("合計");
    const intent = new URL(xShareUrl(post));
    expect(intent.searchParams.get("text")).toBe(post.text);
    expect(intent.searchParams.get("url")).toBe(post.url);
  });
  it.each([-5, 0, 5])(
    "shares this result's verdict and signed total (%s)",
    (value) => {
      const answers = Object.fromEntries(
        CASE_ORDER.map((id, index) => [id, value || (index < 10 ? -5 : 5)]),
      ) as Answers;
      const individual = scoreAnswers(answers);
      const post = resultShare(individual);
      expect(post.text).toContain(
        value < 0
          ? "悪魔の使いとして公開処刑"
          : value > 0
            ? "神の使いとして神殿管理"
            : "釈放",
      );
      expect(post.text).toContain(
        value < 0 ? "−100点" : value > 0 ? "＋100点" : "0点",
      );
      expect(post.text).toContain("#スライム裁判");
      expect(post.text).not.toBe(homeShare().text);
    expect([...post.text].length * 2 + 24).toBeLessThanOrEqual(280);
      expect(post.url).not.toMatch(/[?#]/);
      expect(post.text).not.toMatch(/H01|K01|participant|revision/);
    },
  );
});
