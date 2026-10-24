import type { Page } from "@playwright/test";

/** Use the native range's real keyboard path, including input events. */
export async function chooseScore(page: Page, score: number) {
  const slider = page.getByRole("slider", { name: "この審理の判断" });
  await slider.press(score === 5 ? "End" : "Home");
  if (score !== 5) {
    for (let i = -5; i < score; i++) await slider.press("ArrowRight");
  }
}
