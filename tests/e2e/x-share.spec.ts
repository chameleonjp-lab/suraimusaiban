import { expect, test } from "@playwright/test";

test("home has an X introduction with only the canonical game URL", async ({
  page,
}) => {
  await page.goto("/?utm_source=do-not-share");
  const link = page.getByRole("link", {
    name: "このゲームをXでシェア",
    exact: true,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.searchParams.get("text")).toContain("20の出来事");
  expect(url.searchParams.get("text")).toContain("#スライム裁判");
  expect(url.searchParams.get("url")).toBe(
    "https://chameleonjp-lab.github.io/suraimusaiban/",
  );
  expect(url.href).not.toContain("do-not-share");
  const size = await link.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
});
