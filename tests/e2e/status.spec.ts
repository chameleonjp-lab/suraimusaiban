import { test, expect } from "@playwright/test";
for (const scenario of [
  "empty",
  "polarized_zero_mean",
  "tiny-positive",
] as const) {
  test(scenario, async ({ page }) => {
    await page.route("http://127.0.0.1:5173/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="ja"><body></body></html>',
      }),
    );
    await page.goto("/");
    await page.evaluate(async (scenario) => {
      const { CASE_ORDER } = await import("/src/domain/content.ts");
      const { renderSnapshot } =
        await import("/src/features/status/status-view.ts");
      const count =
        scenario === "empty"
          ? "0"
          : scenario === "tiny-positive"
            ? "1000000"
            : "2";
      const snapshot = {
        version: "v1",
        revision: "1",
        updatedAt: "2026-10-23T10:00:00Z",
        count,
        scoreSum: scenario === "tiny-positive" ? "1" : "0",
        caseCounts: Object.fromEntries(
          CASE_ORDER.map((id: string) => [
            id,
            Object.fromEntries(
              [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map((s) => [
                s,
                scenario === "polarized_zero_mean" && (s === -5 || s === 5)
                  ? "1"
                  : "0",
              ]),
            ),
          ]),
        ),
        axisSums: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [i + 1, "100"]),
        ),
        verdictCounts: Object.fromEntries(
          ["N5", "N4", "N3", "N2", "N1", "Z", "P1", "P2", "P3", "P4", "P5"].map(
            (v) => [
              v,
              scenario === "polarized_zero_mean" && (v === "N5" || v === "P5")
                ? "1"
                : "0",
            ],
          ),
        ),
      };
      document.body.innerHTML = '<main id="fixture"></main>';
      renderSnapshot(document.querySelector("#fixture")!, snapshot);
    }, scenario);
    if (scenario === "empty") {
      await expect(page.getByText("集計準備中", { exact: true })).toBeVisible();
      await expect(page.getByTestId("future-story")).toHaveCount(0);
      await expect(page.getByTestId("radar-chart")).toHaveCount(0);
    }
    if (scenario === "polarized_zero_mean") {
      await expect(page.getByTestId("aggregate-verdict")).toContainText("釈放");
      await expect(
        page.getByTestId("verdict-distribution").locator("tbody tr").first(),
      ).toContainText("50%");
      await expect(
        page.getByTestId("verdict-distribution").locator("tbody tr").last(),
      ).toContainText("50%");
    }
    if (scenario === "tiny-positive") {
      await expect(page.getByTestId("aggregate-average")).toHaveText(
        "＋0.01未満",
      );
      await expect(page.getByTestId("aggregate-verdict")).not.toContainText(
        "釈放",
      );
    }
  });
}
test("failed refresh retains the previous values and timestamp", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body></body></html>',
    }),
  );
  await page.route("**/src/platform/supabase-client.ts", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
  const channel={on(){return this},subscribe(callback){callback('CHANNEL_ERROR');return this}};
  export function getSubmissionConfig(){return null;}
  export function getSupabaseClient(){return {channel(){return channel},removeChannel(){return Promise.resolve()},from(table){if(table!=='slime_trial_aggregate_snapshots')throw new Error('slime_trial_private table');return {select(columns){if(columns!=='payload')throw new Error('slime_trial_private fields');return {eq(column,version){if(column!=='version'||version!=='v1')throw new Error('wrong version');return {single:async()=>{if(window.failRefresh)return {data:null,error:{message:'offline'}};return {data:{payload:window.feedSnapshot},error:null};}}}}}}}};}
 `,
    }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    const { CASE_ORDER, AXES, VERDICTS, SCORES } =
      await import("/src/domain/content.ts");
    const { scoreAnswers } = await import("/src/domain/scoring.ts");
    const { renderStatus } =
      await import("/src/features/status/status-view.ts");
    const answers = Object.fromEntries(CASE_ORDER.map((id: string) => [id, 5]));
    const individual = scoreAnswers(answers);
    window.feedSnapshot = {
      version: "v1",
      revision: "77",
      updatedAt: "2026-10-23T10:00:00Z",
      count: "10",
      scoreSum: "1000",
      caseCounts: Object.fromEntries(
        CASE_ORDER.map((id: string) => [
          id,
          Object.fromEntries(
            SCORES.map((s: number) => [s, s === 5 ? "10" : "0"]),
          ),
        ]),
      ),
      axisSums: Object.fromEntries(
        AXES.map((a: { id: number }) => [a.id, String(individual.axes[a.id] * 10)]),
      ),
      verdictCounts: Object.fromEntries(
        VERDICTS.map((v: { id: string }) => [v.id, v.id === "P5" ? "10" : "0"]),
      ),
    };
    document.body.innerHTML = '<main id="fixture"></main>';
    renderStatus(document.querySelector("#fixture")!);
  });
  await expect(page.getByTestId("aggregate-average")).toHaveText("＋100");
  const previousTime = await page.getByTestId("snapshot-time").textContent();
  await page.evaluate(() => {
    window.failRefresh = true;
  });
  await page.getByRole("button", { name: "最新の集計に更新" }).click();
  await expect(page.getByRole("status")).toContainText("更新できていません");
  await expect(page.getByTestId("aggregate-average")).toHaveText("＋100");
  await expect(page.getByTestId("snapshot-time")).toHaveText(previousTime!);
});
