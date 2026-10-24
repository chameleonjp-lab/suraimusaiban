import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const config = JSON.parse(readFileSync("config/production.json", "utf8"));
const published = process.env.CHECK_PUBLISHED === "1";
const server = published ? null : spawn(
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
const origin = published ? config.siteUrl : `http://127.0.0.1:4173${config.basePath}`;
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
  if (published && process.env.EXPECTED_DEPLOY_COMMIT) {
    let deployed;
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await fetch(`${origin}release.json?check=${Date.now()}`, {cache: "no-store"});
      if (response.ok) deployed = await response.json();
      if (deployed?.commit === process.env.EXPECTED_DEPLOY_COMMIT) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(deployed?.commit, process.env.EXPECTED_DEPLOY_COMMIT, "Published release must match the verified main commit");
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
  const authRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/auth/v1/")) authRequests.push(request.url()); });
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
  const canvas = page.locator('canvas[data-scene-state="active"]');
  await canvas.scrollIntoViewIfNeeded();
  const before = await canvas.screenshot();
  await page.waitForTimeout(500);
  assert.equal((await canvas.screenshot()).equals(before), false, "Three.js must render a visibly animated slime");
  const imageUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
  const imageResponse = await page.request.get(new URL(imageUrl).pathname.replace(config.basePath, origin));
  assert.equal(imageResponse.status(), 200);
  // Invalid input is rejected before the write RPC. Production checks add no responses.
  const endpoint = `${config.supabaseUrl}/functions/v1/slime-trial-submit`;
  const preflight = await page.request.fetch(endpoint, {method: "OPTIONS", headers: {
    Origin: new URL(config.siteUrl).origin,
    "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "apikey,content-type",
  }});
  assert.equal(preflight.status(), 204);
  assert.equal(preflight.headers()["access-control-allow-origin"], new URL(config.siteUrl).origin);
  const invalid = published ? await page.evaluate(async ({endpoint,key}) => {
    const response = await fetch(endpoint, {method:"POST",headers:{apikey:key,"Content-Type":"application/json"},body:"{}"});
    return {status:response.status,body:await response.json()};
  }, {endpoint,key:config.supabasePublishableKey}) : await (async () => {
    const response = await page.request.post(endpoint, {headers:{apikey:config.supabasePublishableKey,Origin:new URL(config.siteUrl).origin},data:{}});
    return {status:response.status(),body:await response.json()};
  })();
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "INVALID_ANSWERS");
  await page.getByRole("button", {name:"裁判に参加する"}).click();
  await page.getByTestId("case-number").waitFor();
  const slider = page.getByRole("slider", {name:"この審理の判断"});
  assert.equal(await slider.inputValue(), "0");
  await slider.press("End");
  assert.equal(await slider.inputValue(), "5");
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
  assert.deepEqual(authRequests, [], "Public participation and aggregate reads must never invoke Auth");
  assert.equal(await page.evaluate(() => [...Object.keys(localStorage),...Object.keys(sessionStorage)].some(key=>key.startsWith("slime-trial:"))), false);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/production-aggregate.png" });
  const report = {
    canonical: config.siteUrl,
    productionSubpath: true,
    hostedAggregateLoaded: true,
    nativeAnswerSlider: true,
    animatedThreeScene: true,
    published,
    anonymousAuthRequired: false,
    submissionGateRejectsInvalidWithoutWrite: true,
    authRequests: authRequests.length,
    errors,
    responseWrites: 0,
  };
  writeFileSync(
    "test-results/production-readiness.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  server?.kill();
}
