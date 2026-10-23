#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const help = `Observe real elapsed application route transitions and WebGL resource instrumentation.

Usage: node scripts/measure-lifecycle.mjs [options]
  --origin URL           LIFECYCLE_ORIGIN (default http://127.0.0.1:5173)
  --duration-ms INTEGER  LIFECYCLE_DURATION_MS (default 1800000)
  --output PATH          LIFECYCLE_OUTPUT (default docs/qa/performance/lifecycle-30min.json)
  --source-label TEXT    LIFECYCLE_SOURCE_LABEL (default unspecified source)
  --condition TEXT       LIFECYCLE_CONDITION (default Linux headless Chromium; SwiftShader; 390x844 CSS px)
  --help                 Show this message without launching a browser

PLAYWRIGHT_BROWSERS_PATH may select an installed browser directory.
Disable Vite HMR for observations of a single source revision. No clock is accelerated.
Resource sets are cleared on explicit WEBGL_lose_context; these are instrumentation
counters, not GPU driver memory measurements. This script does not submit ballots.
`;

const options = {
  origin: process.env.LIFECYCLE_ORIGIN ?? "http://127.0.0.1:5173",
  durationMs: process.env.LIFECYCLE_DURATION_MS ?? "1800000",
  output:
    process.env.LIFECYCLE_OUTPUT ?? "docs/qa/performance/lifecycle-30min.json",
  sourceLabel: process.env.LIFECYCLE_SOURCE_LABEL ?? "unspecified source",
  condition:
    process.env.LIFECYCLE_CONDITION ??
    "Linux headless Chromium; SwiftShader; 390x844 CSS px",
};
const flags = {
  "--origin": "origin",
  "--duration-ms": "durationMs",
  "--output": "output",
  "--source-label": "sourceLabel",
  "--condition": "condition",
};
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (flag === "--help") {
    console.log(help);
    process.exit(0);
  }
  const key = flags[flag];
  if (!key || process.argv[index + 1] === undefined)
    throw new Error(`Unknown option or missing value: ${flag}. Use --help.`);
  options[key] = process.argv[++index];
}
const durationMs = Number(options.durationMs);
if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
  throw new Error(
    "Duration must be a positive integer number of milliseconds.",
  );
const origin = new URL(options.origin);
if (!["http:", "https:"].includes(origin.protocol))
  throw new Error("Origin must use http or https.");
const output = resolve(options.output);
mkdirSync(dirname(output), { recursive: true });
const sourcePaths = [
  "src/app.ts",
  "src/scene/index.ts",
  "src/scene/courtroom.ts",
  "src/scene/slime.ts",
  "src/features/status/status-feed.ts",
  "src/features/status/status-view.ts",
];
const sourceHashes = () =>
  Object.fromEntries(
    sourcePaths.map((path) => [
      path,
      createHash("sha256").update(readFileSync(path)).digest("hex"),
    ]),
  );
const sourceFilesAtStart = sourceHashes();

const instrumentation = {
  resources:
    "Live handles observed through create/delete Buffer, Texture and Program wrappers; sets are cleared when explicit WEBGL_lose_context.loseContext is called.",
  limitations:
    "These counters are not GPU driver memory measurements or proof that the driver has reclaimed memory. The observer retains per-context counters. JS heap is sampled without forcing garbage collection.",
  timing:
    "Real monotonic elapsed time; no clock acceleration. Each route is sampled after up to 4500ms. The final route may have a shorter observation window.",
  routes:
    "trial -> status -> home; app navigation only, no ballot submission or result injection.",
};
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const navigations = [];
const samples = [];
let submitRequests = 0;
let startedAt = new Date().toISOString();
let start = performance.now();
let backendConfigured = null;
let sourceContext = null;
page.on("pageerror", (error) =>
  errors.push({ at: new Date().toISOString(), message: error.message }),
);
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame())
    navigations.push({ at: new Date().toISOString(), url: frame.url() });
});
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    new URL(request.url()).pathname.endsWith("/rpc/submit_ballot")
  )
    submitRequests++;
});
await page.addInitScript(() => {
  const states = [];
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const gl = original.apply(this, args);
    if (gl && /webgl/.test(args[0]) && !gl.__lifecycleObserved) {
      gl.__lifecycleObserved = true;
      const state = {
        buffers: new Set(),
        textures: new Set(),
        programs: new Set(),
        explicitLosses: 0,
      };
      states.push(state);
      for (const [noun, key] of [
        ["Buffer", "buffers"],
        ["Texture", "textures"],
        ["Program", "programs"],
      ]) {
        const create = gl[`create${noun}`].bind(gl);
        const remove = gl[`delete${noun}`].bind(gl);
        gl[`create${noun}`] = (...values) => {
          const value = create(...values);
          if (value) state[key].add(value);
          return value;
        };
        gl[`delete${noun}`] = (value) => {
          state[key].delete(value);
          return remove(value);
        };
      }
      const getExtension = gl.getExtension.bind(gl);
      gl.getExtension = (name) => {
        const extension = getExtension(name);
        if (
          name === "WEBGL_lose_context" &&
          extension &&
          !extension.__lifecycleObserved
        ) {
          extension.__lifecycleObserved = true;
          const loseContext = extension.loseContext.bind(extension);
          extension.loseContext = () => {
            state.explicitLosses++;
            state.buffers.clear();
            state.textures.clear();
            state.programs.clear();
            return loseContext();
          };
        }
        return extension;
      };
    }
    return gl;
  };
  window.resourceObservation = () => ({
    contexts: states.length,
    explicitContextLosses: states.reduce(
      (sum, state) => sum + state.explicitLosses,
      0,
    ),
    buffers: states.reduce((sum, state) => sum + state.buffers.size, 0),
    textures: states.reduce((sum, state) => sum + state.textures.size, 0),
    programs: states.reduce((sum, state) => sum + state.programs.size, 0),
    nodes: document.querySelectorAll("*").length,
    sceneStates: [...document.querySelectorAll("canvas")].map(
      (canvas) => canvas.dataset.sceneState ?? null,
    ),
  });
});
const engine = await browser.version();
const save = (status) =>
  writeFileSync(
    output,
    JSON.stringify(
      {
        status,
        engine,
        viewport: "390x844",
        renderer: "SwiftShader software WebGL",
        origin: origin.href,
        sourceLabel: options.sourceLabel,
        sourceContext,
        sourceFilesAtStart,
        sourceFilesAtSample: sourceHashes(),
        condition: options.condition,
        backendConfigured,
        instrumentation,
        startedAt,
        durationTargetMs: durationMs,
        durationMs: Math.round(performance.now() - start),
        submitRequests,
        navigations,
        samples,
        errors,
      },
      null,
      2,
    ) + "\n",
  );

try {
  await page.goto(origin.href);
  backendConfigured = await page.evaluate(async () =>
    (await import("/src/platform/supabase-client.ts")).isBackendConfigured(),
  );
  sourceContext = await page.evaluate(() => ({
    url: location.href,
    userAgent: navigator.userAgent,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  startedAt = new Date().toISOString();
  start = performance.now();
  save("running");
  let previousSave = start;
  let index = 0;
  while (performance.now() - start < durationMs) {
    const route = ["trial", "status", "home"][index++ % 3];
    await page.evaluate(async (route) => {
      (await import("/src/app.ts")).navigate(route);
    }, route);
    const remaining = durationMs - (performance.now() - start);
    if (remaining > 0) await page.waitForTimeout(Math.min(4500, remaining));
    const resources = await page.evaluate(() => window.resourceObservation());
    const { metrics } = await cdp.send("Performance.getMetrics");
    samples.push({
      elapsedMs: Math.round(performance.now() - start),
      route,
      ...resources,
      heap: metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value,
    });
    if (performance.now() - previousSave >= 45_000) {
      save("running");
      previousSave = performance.now();
      console.log(
        `lifecycle ${Math.round((performance.now() - start) / 1000)}s; ${samples.length} samples; observed handles ${JSON.stringify(resources)}`,
      );
    }
  }
  save("complete");
  if (submitRequests !== 0)
    throw new Error(
      `Unexpected ballot submissions observed: ${submitRequests}`,
    );
  console.log(
    `Lifecycle observation complete: ${samples.length} samples, ${errors.length} page errors, ${Math.round(performance.now() - start)} real milliseconds. ${output}`,
  );
} catch (error) {
  errors.push({
    at: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    observerError: true,
  });
  save("failed");
  throw error;
} finally {
  await browser.close();
}
