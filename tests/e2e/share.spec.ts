import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
test("exports three opaque readable-size PNG cards from the same receipt", async ({
  page,
}) => {
  await page.route("http://127.0.0.1:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body></body></html>',
    }),
  );
  await page.goto("/");
  const output = await page.evaluate(async () => {
    const { CASE_ORDER } = await import("/src/domain/content.ts");
    const { openResult } =
      await import("/src/features/results/result-state.ts");
    const { renderCard, cardDescription } =
      await import("/src/features/share/card.ts");
    const { scoreAnswers } = await import("/src/domain/scoring.ts");
    const answers = Object.fromEntries(CASE_ORDER.map((id: string) => [id, 5]));
    const snapshot = {
      version: "v1",
      revision: "7",
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
    const session = openResult({
      ballot: { version: "v1", revision: "1", answers },
      snapshot,
    });
    const results = [];
    for (const kind of ["personality", "comparison", "verdict"] as const) {
      const blob = await renderCard(kind, session, "https://example.test/");
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = true;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) {
          opaque = false;
          break;
        }
      }
      results.push({
        kind,
        type: blob.type,
        width: bitmap.width,
        height: bitmap.height,
        opaque,
        description: cardDescription(kind, session),
        png: Array.from(new Uint8Array(await blob.arrayBuffer())),
      });
      bitmap.close();
    }
    return results;
  });
  await mkdir("/tmp/slime-card-evidence", { recursive: true });
  for (const card of output)
    await writeFile(
      `/tmp/slime-card-evidence/${card.kind}.png`,
      Buffer.from(card.png),
    );
  expect(output.map((x) => [x.width, x.height])).toEqual([
    [1080, 1350],
    [1080, 1350],
    [1080, 1920],
  ]);
  for (const card of output) {
    expect(card.type).toBe("image/png");
    expect(card.opaque).toBe(true);
    expect(card.description).not.toContain("participant");
  }
  expect(output[0].description).toContain("共生");
  expect(output[1].description).toContain("2026/10/23 19:00:00 JST");
  expect(output[2].description).toContain("20 ");
  for (const card of output) expect(card.description).not.toMatch(/[HK]\d{2}/);
});
test("share_cancel_keeps_result and share_fallback", async ({ page }) => {
  await page.route("http://127.0.0.1:5173/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="ja"><body></body></html>',
    }),
  );
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { shareCard } = await import("/src/features/share/share-view.ts");
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => Promise.reject(new DOMException("cancel", "AbortError")),
    });
    const cancelled = await shareCard(
      new Blob(["png"], { type: "image/png" }),
      "スライム裁判",
    );
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => false,
    });
    return {
      cancelled,
      fallback: await shareCard(
        new Blob(["png"], { type: "image/png" }),
        "スライム裁判",
      ),
    };
  });
  expect(result).toEqual({ cancelled: "cancelled", fallback: "fallback" });
});
