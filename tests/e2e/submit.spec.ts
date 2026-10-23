import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120_000);

async function start(page: Page) {
  await page.goto("/");
  const configured = await page.evaluate(async () =>
    (await import("/src/platform/supabase-client.ts")).isBackendConfigured(),
  );
  test.skip(
    !configured,
    "Real local Supabase is required; auth and submission are never fulfilled with fixtures.",
  );
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(page.getByTestId("case-number")).toHaveText("審理 01");
}

async function complete(page: Page) {
  for (let i = 0; i < 20; i++) {
    await page
      .getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true })
      .click();
    await page
      .getByRole("button", { name: i === 19 ? "回答を確認する" : "次の審理へ" })
      .click();
  }
}

async function snapshot(page: Page) {
  return page.evaluate(async () =>
    (await import("/src/features/vote/vote-api.ts")).loadSnapshot("v1"),
  );
}

test("lost_response_retries_once: discard the actual committed response and replay the identical request", async ({
  page,
}) => {
  await start(page);
  const before = await snapshot(page);
  await complete(page);
  const requests: unknown[] = [];
  let committed: any;
  let replay: any;
  await page.route("**/rest/v1/rpc/submit_ballot", async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (requests.length === 1) {
      committed = await response.json();
      await route.abort("failed");
    } else {
      replay = await response.json();
      await route.fulfill({ response });
    }
  });
  await page.getByRole("button", { name: "この判断を提出する" }).click();
  await expect(page.getByTestId("individual-total")).toHaveText("＋100");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(replay).toEqual(committed);
  const after = await snapshot(page);
  expect(BigInt(after.count)).toBe(BigInt(before.count) + 1n);
  expect(BigInt(after.revision)).toBe(BigInt(before.revision) + 1n);
});

test("stale_receipt_newer_vote: a committed old request cannot return its receipt after another tab replaces the ballot", async ({
  page,
  context,
}) => {
  await start(page);
  const before = await snapshot(page);
  await complete(page);
  let committed: any;
  let resolveCommitted!: () => void;
  const didCommit = new Promise<void>((resolve) => {
    resolveCommitted = resolve;
  });
  let releaseFirst!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let requests = 0;
  await page.route("**/rest/v1/rpc/submit_ballot", async (route) => {
    requests++;
    if (requests !== 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed = await response.json();
    resolveCommitted();
    await release;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "この判断を提出する" }).click();
  await didCommit;

  const newer = await context.newPage();
  await newer.goto("/");
  // This independent editor intentionally starts from the committed server ballot.
  await newer.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("slime-trial:draft:"))
      .forEach((key) => localStorage.removeItem(key)),
  );
  await newer.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(newer.getByTestId("case-number")).toHaveText("審理 01");
  await newer
    .getByRole("radio", { name: "−5 強く刑罰を求める", exact: true })
    .click();
  await newer.getByRole("button", { name: "回答一覧", exact: true }).click();
  await newer.getByRole("button", { name: "この判断を提出する" }).click();
  await expect(newer.getByTestId("individual-total")).toHaveText("＋90");

  releaseFirst();
  await expect(page.getByRole("alert")).toContainText("別の画面で");
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  expect(requests).toBe(2);
  const after = await snapshot(page);
  expect(BigInt(after.count)).toBe(BigInt(before.count) + 1n);
  expect(BigInt(after.revision)).toBe(BigInt(before.revision) + 2n);
  const ballot = await newer.evaluate(async () =>
    (await import("/src/features/vote/vote-api.ts")).loadOwnBallot("v1"),
  );
  expect(ballot?.answers.H01).toBe(-5);
  expect(BigInt(ballot!.revision)).toBe(BigInt(committed.ballot.revision) + 1n);
  await page.getByRole("button", { name: "編集中の判断を確認する" }).click();
  await page.getByRole("button", { name: "回答一覧", exact: true }).click();
  await page.getByRole("button", { name: "この判断を提出する" }).click();
  await expect(page.getByTestId("individual-total")).toHaveText("＋100");
  expect((await snapshot(page)).count).toBe(after.count);
  await newer.close();
});
