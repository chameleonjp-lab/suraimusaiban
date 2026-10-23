import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test.setTimeout(120_000);

async function begin(page: Page) {
  await page.goto("/");
  const connected = await page.evaluate(async () =>
    (await import("/src/platform/supabase-client.ts")).isBackendConfigured(),
  );
  test.skip(
    !connected,
    "Requires the real local Supabase Auth/PostgREST stack and VITE_SUPABASE_* configuration.",
  );
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(page.getByTestId("case-number")).toHaveText("審理 01");
}

async function answerAll(page: Page, positive = true) {
  for (let i = 0; i < 20; i++) {
    await expect(page.getByTestId("case-number")).toHaveText(
      `審理 ${String(i + 1).padStart(2, "0")}`,
    );
    await page
      .getByRole("radio", {
        name: positive ? "＋5 強く待遇改善を求める" : "−5 強く刑罰を求める",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: i === 19 ? "回答を確認する" : "次の審理へ" })
      .click();
  }
}

async function submit(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/rpc/slime_trial_submit_ballot") && r.ok(),
  );
  await page.getByRole("button", { name: "この判断を提出する" }).click();
  const receipt = await (await response).json();
  await expect(
    page.getByRole("heading", { name: "今回、あなたが下した判決" }),
  ).toBeVisible();
  return receipt;
}

async function currentSnapshot(page: Page) {
  return page.evaluate(async () =>
    (await import("/src/features/vote/vote-api.ts")).loadSnapshot("v1"),
  );
}

test("connected_journey: anonymous UI submission, fixed comparison, PNG save and one-vote replacement", async ({
  page,
  browser,
}) => {
  await begin(page);
  const before = await currentSnapshot(page);
  await answerAll(page);
  const first = await submit(page);
  expect(BigInt(first.snapshot.count)).toBe(BigInt(before.count) + 1n);
  await expect(page.getByTestId("individual-total")).toHaveText("＋100");
  const xPost = new URL(
    (await page
      .getByRole("link", { name: "今回の判決をXでシェア" })
      .getAttribute("href"))!,
  );
  expect(xPost.searchParams.get("text")).toContain("神の使いとして神殿管理");
  expect(xPost.searchParams.get("text")).toContain("＋100点");
  expect(xPost.searchParams.get("url")).toBe(
    "https://chameleonjp-lab.github.io/suraimusaiban/",
  );
  const comparison = await page.getByTestId("comparison").innerHTML();
  await expect(page.getByTestId("comparison")).toContainText(
    `集計版 ${first.snapshot.revision}`,
  );

  const otherContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const other = await otherContext.newPage();
  await begin(other);
  await answerAll(other, false);
  const secondParticipant = await submit(other);
  expect(BigInt(secondParticipant.snapshot.count)).toBe(
    BigInt(first.snapshot.count) + 1n,
  );
  await page.bringToFront();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("slime:refresh-snapshot"));
  });
  await expect(page.getByTestId("comparison")).toHaveJSProperty(
    "innerHTML",
    comparison,
  );

  await page.getByLabel("保存する画像").selectOption("comparison");
  const save = page.getByRole("link", { name: "PNG画像を保存" });
  await expect(save).toBeVisible();
  await expect(save).toHaveAttribute("download", "slime-trial-comparison.png");
  const downloadPromise = page.waitForEvent("download");
  await save.click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).not.toBeNull();
  const bytes = await readFile(file!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  await expect(page.getByTestId("comparison")).toHaveJSProperty(
    "innerHTML",
    comparison,
  );

  await page.getByRole("button", { name: "スライム裁判 ホームへ" }).click();
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await expect(
    page.getByRole("radio", { name: "＋5 強く待遇改善を求める", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("radio", { name: "−5 強く刑罰を求める", exact: true })
    .click();
  await page.getByRole("button", { name: "回答一覧", exact: true }).click();
  const replacement = await submit(page);
  expect(replacement.snapshot.count).toBe(secondParticipant.snapshot.count);
  expect(BigInt(replacement.ballot.revision)).toBe(
    BigInt(first.ballot.revision) + 1n,
  );
  await expect(page.getByTestId("individual-total")).toHaveText("＋90");
  const saved = await page.evaluate(async () =>
    (await import("/src/features/vote/vote-api.ts")).loadOwnBallot("v1"),
  );
  expect(saved?.answers.H01).toBe(-5);
  expect(saved?.revision).toBe(replacement.ballot.revision);
  await otherContext.close();
});

test("result_lifetime: direct URL, reload, history and page restoration cannot recover an ended receipt", async ({
  page,
}) => {
  await page.goto("/#result");
  await expect(
    page.getByRole("button", { name: "裁判に参加する" }),
  ).toBeVisible();
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  await begin(page);
  await answerAll(page);
  await submit(page);

  const serialized = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    state: history.state,
  }));
  expect(JSON.stringify(serialized)).not.toMatch(
    /"(?:snapshot|caseCounts|verdictCounts|individual|receipt)"/,
  );
  expect(serialized.state).toBeNull();
  await page.reload();
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "裁判に参加する" }),
  ).toBeVisible();

  // A fresh confirmation is allowed to create a new, current comparison.
  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page.getByRole("button", { name: "回答一覧", exact: true }).click();
  await submit(page);
  await page.getByRole("button", { name: "スライム裁判 ホームへ" }).click();
  await page.goBack();
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "裁判に参加する" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page.getByRole("button", { name: "回答一覧", exact: true }).click();
  await submit(page);
  // Exercise the persisted pageshow handler even on engines that do not use BFCache.
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await expect(page.getByTestId("individual-total")).toHaveCount(0);

  await page.getByRole("button", { name: "裁判に参加する" }).click();
  await page.getByRole("button", { name: "回答一覧", exact: true }).click();
  await submit(page);
  await page.evaluate(() => {
    sessionStorage.setItem("qa:bfcache", "false");
    window.addEventListener("pageshow", (event) =>
      sessionStorage.setItem("qa:bfcache", String(event.persisted)),
    );
  });
  await page.goto("/scene/qa.html");
  await page.goBack();
  await expect(page.getByTestId("individual-total")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "裁判に参加する" }),
  ).toBeVisible();
  const actualBFCache = await page.evaluate(
    () => sessionStorage.getItem("qa:bfcache") === "true",
  );
  const evidence = test.info().outputPath("bfcache-evidence.json");
  await writeFile(
    evidence,
    JSON.stringify(
      {
        actualPersistedRestoration: actualBFCache,
        syntheticPersistedHandlerPassed: true,
      },
      null,
      2,
    ),
  );
  await test.info().attach("bfcache-evidence", {
    path: evidence,
    contentType: "application/json",
  });
  test.info().annotations.push({
    type: "BFCache",
    description: actualBFCache
      ? "Actual persisted restoration observed."
      : "Engine reloaded the document; synthetic persisted handler tested separately, actual BFCache remains unverified.",
  });
});
