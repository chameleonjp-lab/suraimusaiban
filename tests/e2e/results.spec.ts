import { test, expect } from "@playwright/test";
test("receipt results show all answers, fixed-order accumulation and paired axis evidence", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body></body></html>',
    }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const { CASE_ORDER } = await import("/src/domain/content.ts");
    const { renderResults } =
      await import("/src/features/results/result-view.ts");
    const { scoreAnswers } = await import("/src/domain/scoring.ts");
    const answers = Object.fromEntries(
      CASE_ORDER.map((id: string, i: number) => [id, i < 10 ? -5 : 5]),
    );
    const snapshot = {
      version: "v1",
      revision: "7",
      updatedAt: "2026-10-23T10:00:00Z",
      count: "10",
      scoreSum: "0",
      caseCounts: Object.fromEntries(
        CASE_ORDER.map((id: string) => [
          id,
          Object.fromEntries(
            [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((s) => [
              s,
              s === answers[id] ? "10" : "0",
            ]),
          ),
        ]),
      ),
      axisSums: Object.fromEntries(
        Object.entries(scoreAnswers(answers).axes).map(([id, value]) => [
          id,
          String(Number(value) * 10),
        ]),
      ),
      verdictCounts: Object.fromEntries(
        ["N5", "N4", "N3", "N2", "N1", "Z", "P1", "P2", "P3", "P4", "P5"].map(
          (v) => [v, v === "Z" ? "10" : "0"],
        ),
      ),
    };
    document.body.innerHTML = '<main id="fixture"></main>';
    renderResults(document.querySelector("#fixture")!, {
      ballot: { version: "v1", revision: "1", answers },
      snapshot,
    });
  });
  await expect(page.getByTestId("individual-total")).toHaveText("0");
  const xPost = new URL(
    (await page
      .getByRole("link", { name: "今回の判決をXでシェア" })
      .getAttribute("href"))!,
  );
  expect(xPost.searchParams.get("text")).toContain("釈放");
  expect(xPost.searchParams.get("text")).toContain("合計 0点");
  await expect(page.getByTestId("score-breakdown")).toContainText("−50");
  await expect(page.getByTestId("score-breakdown")).toContainText("＋50");
  await expect(
    page.getByTestId("case-results").locator("tbody tr"),
  ).toHaveCount(20);
  await expect(
    page.getByTestId("axis-results").locator("tbody tr"),
  ).toHaveCount(10);
  await expect(
    page.getByText("公開回答数 10回"),
  ).toBeVisible();
  await expect(page.getByTestId("snapshot-time")).toContainText(
    "2026/10/23 19:00:00 JST",
  );
});
test("snapshot_stays_fixed", async ({ page }) => {
  await page.route("http://127.0.0.1:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body></body></html>',
    }),
  );
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const { CASE_ORDER } = await import("/src/domain/content.ts");
    const { renderResults } =
      await import("/src/features/results/result-view.ts");
    const { scoreAnswers } = await import("/src/domain/scoring.ts");
    const answers = Object.fromEntries(CASE_ORDER.map((id: string) => [id, 5]));
    const snapshot = {
      version: "v1",
      revision: "1",
      updatedAt: "2026-10-23T10:00:00Z",
      count: "10",
      scoreSum: "1000",
      caseCounts: Object.fromEntries(
        CASE_ORDER.map((id: string) => [
          id,
          Object.fromEntries(
            [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((s) => [
              s,
              s === 5 ? "10" : "0",
            ]),
          ),
        ]),
      ),
      axisSums: Object.fromEntries(
        Object.entries(scoreAnswers(answers).axes).map(([id, value]) => [
          id,
          String(Number(value) * 10),
        ]),
      ),
      verdictCounts: Object.fromEntries(
        ["N5", "N4", "N3", "N2", "N1", "Z", "P1", "P2", "P3", "P4", "P5"].map(
          (v) => [v, v === "P5" ? "10" : "0"],
        ),
      ),
    };
    document.body.innerHTML = '<main id="fixture"></main>';
    renderResults(document.querySelector("#fixture")!, {
      ballot: { version: "v1", revision: "1", answers },
      snapshot,
    });
    const html = document.querySelector(
      '[data-testid="comparison"]',
    )!.innerHTML;
    snapshot.updatedAt = "2026-10-24T10:00:00Z";
    snapshot.count = "2";
    snapshot.axisSums[1] = "0";
    window.dispatchEvent(new Event("focus"));
    return html;
  });
  await expect(page.getByTestId("comparison")).toHaveJSProperty(
    "innerHTML",
    before,
  );
});
