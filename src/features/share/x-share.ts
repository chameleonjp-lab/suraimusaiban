import deployment from "../../../config/production.json";
import { VERDICTS } from "../../domain/content";
import type { IndividualResult } from "../../domain/types";
import { signedNumber } from "../../charts/chart-model";

export type XPost = Readonly<{ text: string; url: string }>;
export const GAME_URL = deployment.siteUrl;
export function homeShare(): XPost {
  return {
    text: "言葉を持たない一匹のスライム。20の出来事に、あなたならどんな判決を下す？\n#スライム裁判",
    url: GAME_URL,
  };
}
export function resultShare(result: IndividualResult): XPost {
  const verdict = VERDICTS.find((value) => value.id === result.verdict)!;
  return {
    text: `スライム裁判で、私は「${verdict.label}」の判決を下しました。\n合計 ${signedNumber(result.total)}点（−100〜＋100）\n20の出来事に、あなたならどんな判決を？\n#スライム裁判`,
    url: GAME_URL,
  };
}
export function xShareUrl(post: XPost): string {
  const url = new URL("https://twitter.com/intent/tweet");
  url.searchParams.set("text", post.text);
  url.searchParams.set("url", post.url);
  return url.href;
}
export function xShareLink(label: string, post: XPost): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "x-share-button";
  link.href = xShareUrl(post);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}
