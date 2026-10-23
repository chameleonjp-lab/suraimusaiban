/** Reproduce QA assets: npm run dev, then node src/scene/capture.mjs [--video]. */
import { chromium } from "playwright";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const origin = process.env.SCENE_QA_ORIGIN ?? "http://127.0.0.1:5173";
const destination = fileURLToPath(
  new URL("../../docs/qa/scene/", import.meta.url),
);
const asset = (name) => join(destination, name);
function ffmpeg(args) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("ffmpeg failed");
}
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 720, height: 800 } });
page.on("pageerror", (error) => {
  throw error;
});
async function open(quality = "standard") {
  await page.goto(`${origin}/src/scene/qa.html?quality=${quality}`);
  await page.waitForFunction(() => !!window.sceneQA);
}
await open();
for (const [name, angle] of [
  ["front", 0],
  ["right", Math.PI / 2],
  ["rear", Math.PI],
  ["left", -Math.PI / 2],
  ["three-quarter", 0.5],
]) {
  await page.evaluate((a) => {
    window.sceneQA.setTime(0);
    window.sceneQA.setAngle(a);
  }, angle);
  await page.screenshot({ path: asset(`${name}.png`) });
}
for (let i = 0; i < 24; i++) {
  await page.evaluate((index) => {
    window.sceneQA.setTime(index % 2 ? 1.3 : 3.9);
    window.sceneQA.setAngle((index * Math.PI) / 12);
  }, i);
  await page.screenshot({
    path: asset(`turn-${String(i).padStart(2, "0")}.png`),
  });
}
await page.evaluate(() => {
  window.sceneQA.setAngle(0.3);
  window.sceneQA.setTime(0);
});
const dataURL = await page.evaluate(() => window.sceneQA.dataURL());
await writeFile(
  fileURLToPath(new URL("../../public/slime-fallback.webp", import.meta.url)),
  Buffer.from(dataURL.split(",")[1], "base64"),
);
console.log("standard", await page.evaluate(() => window.sceneQA.info()));
await page.evaluate(() => window.sceneQA.transparency(true));
await page.screenshot({ path: asset("transparent-prototype.png") });
await page.evaluate(() => {
  window.sceneQA.transparency(false);
  window.sceneQA.courtroom();
});
await page.screenshot({ path: asset("courtroom.png") });
console.log("courtroom", await page.evaluate(() => window.sceneQA.info()));
await open("low");
await page.screenshot({ path: asset("low-front.png") });
console.log("low", await page.evaluate(() => window.sceneQA.info()));
await page.setViewportSize({ width: 160, height: 180 });
await open("low");
await page.screenshot({ path: asset("small-front.png") });
ffmpeg([
  "-framerate",
  "1",
  "-i",
  asset("turn-%02d.png"),
  "-vf",
  "scale=240:267,tile=6x4",
  "-frames:v",
  "1",
  asset("turntable.png"),
]);
ffmpeg([
  "-i",
  fileURLToPath(
    new URL("../../docs/references/slime/slime-front.jpeg", import.meta.url),
  ),
  "-i",
  asset("front.png"),
  "-filter_complex",
  "[0:v]scale=360:450[a];[1:v]scale=360:400,pad=360:450:0:25:color=0xefedea[b];[a][b]hstack=inputs=2",
  "-frames:v",
  "1",
  asset("reference-comparison.png"),
]);
if (process.argv.includes("--video")) {
  const scratch = await mkdtemp(join(tmpdir(), "slime-idle-"));
  await page.setViewportSize({ width: 540, height: 600 });
  await open();
  await page.evaluate(() => window.sceneQA.setAngle(0.3));
  for (let frame = 0; frame < 150; frame++) {
    await page.evaluate((t) => window.sceneQA.setTime(t), frame / 15);
    await page.screenshot({
      path: join(scratch, `frame-${String(frame).padStart(3, "0")}.png`),
    });
  }
  ffmpeg([
    "-framerate",
    "15",
    "-i",
    join(scratch, "frame-%03d.png"),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "35",
    "-b:v",
    "0",
    "-pix_fmt",
    "yuv420p",
    asset("idle-10s.webm"),
  ]);
  ffmpeg([
    "-i",
    asset("idle-10s.webm"),
    "-vf",
    "fps=2,scale=180:200,tile=5x4",
    "-frames:v",
    "1",
    asset("idle-contact-sheet.png"),
  ]);
  await rm(scratch, { recursive: true });
}
await browser.close();
