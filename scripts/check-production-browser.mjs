import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const config = JSON.parse(readFileSync("config/production.json", "utf8"));
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  { stdio: "pipe" },
);
const origin = `http://127.0.0.1:4173${config.basePath}`;
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(origin);
      if (response.ok) break;
    } catch {}
    if (attempt === 99) throw new Error("Production preview did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const link = page.getByRole("link", {
    name: "このゲームをXでシェア",
    exact: true,
  });
  await link.waitFor();
  assert.equal(
    new URL(await link.getAttribute("href")).searchParams.get("url"),
    config.siteUrl,
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    config.siteUrl,
  );
  assert.equal(
    await page.locator("[data-scene-fallback]").getAttribute("src"),
    `${config.basePath}slime-fallback.webp`,
  );
  const imageResponse = await page.request.get(`${origin}social-card.png`);
  assert.equal(imageResponse.status(), 200);
  const settings = await page.evaluate(
    async ({ supabaseUrl, supabasePublishableKey }) => {
      const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        headers: { apikey: supabasePublishableKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new Error(`Hosted Auth settings HTTP ${response.status}`);
      const value = await response.json();
      return { anonymousEnabled: value.external?.anonymous_users === true };
    },
    config,
  );
  if (process.env.REQUIRE_ANONYMOUS === "1")
    assert(
      settings.anonymousEnabled,
      "Enable anonymous sign-ins on the configured Supabase project before publication",
    );
  await page.getByRole("button", { name: "みんなの判決" }).click();
  await page
    .getByText("集計を取得しました。", { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/production-aggregate.png" });
  const report = {
    canonical: config.siteUrl,
    productionSubpath: true,
    hostedAggregateLoaded: true,
    anonymousEnabled: settings.anonymousEnabled,
    errors,
    ballotWrites: 0,
  };
  writeFileSync(
    "test-results/production-readiness.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  server.kill();
}
