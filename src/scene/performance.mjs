/** Real 60-second trials, three per quality. Run against a stable HMR-disabled server. */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const origin = process.env.SCENE_QA_ORIGIN ?? "http://127.0.0.1:5173";
const output = fileURLToPath(
  new URL("../../docs/qa/scene/performance.json", import.meta.url),
);
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const results = {
  date: new Date().toISOString(),
  browser: browser.version(),
  platform:
    "Linux managed container / Chromium ANGLE SwiftShader; concurrent development activity; not iPhone hardware",
  viewport: { width: 390, height: 320 },
  samples: [],
};
for (const quality of ["standard", "low"]) {
  const page = await browser.newPage({ viewport: results.viewport });
  await page.goto(`${origin}/src/scene/qa.html?quality=${quality}`);
  await page.waitForFunction(() => !!window.sceneQA);
  await page.evaluate(() => window.sceneQA.courtroom());
  // Individual subject benchmark: courtroom scene is static backdrop; animate the same rig.
  await page.evaluate(() => window.sceneQA.animate(true));
  for (let run = 1; run <= 3; run++) {
    const metrics = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [];
          const start = performance.now();
          let previous = start;
          function sample(now) {
            intervals.push(now - previous);
            previous = now;
            if (now - start >= 60000) {
              const sorted = intervals.slice().sort((a, b) => a - b);
              resolve({
                durationMs: now - start,
                frames: intervals.length,
                fps: (intervals.length * 1000) / (now - start),
                p50Ms: sorted[Math.floor(sorted.length * 0.5)],
                p95Ms: sorted[Math.floor(sorted.length * 0.95)],
                maxMs: sorted.at(-1),
                resources: window.sceneQA.info(),
              });
            } else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        }),
    );
    results.samples.push({ quality, run, ...metrics });
    await fs.writeFile(output, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.samples.at(-1)));
  }
  await page.close();
}
await browser.close();
