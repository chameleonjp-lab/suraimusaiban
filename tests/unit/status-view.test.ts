import { expect, it, vi } from "vitest";
import { renderSnapshot } from "../../src/features/status/status-view";
import type { Snapshot } from "../../src/domain/types";
class Node {
  children: Node[] = [];
  dataset: Record<string, string> = {};
  constructor(readonly tag: string, public textContent = "") {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  querySelector(tag: string): Node | null { return this.children.find(child => child.tag === tag) ?? null; }
  get text(): string { return this.textContent + this.children.map(child => child.text).join(" "); }
}
it("shows pending publication without asserting there are no responses or computing ratios", () => {
  vi.stubGlobal("document", {createElement: (tag: string) => new Node(tag)});
  const container = new Node("div");
  renderSnapshot(container as unknown as HTMLElement, {count:"0", scoreSum:"0", version:"v1", revision:"0", updatedAt:"2026-10-24T00:00:00Z"} as Snapshot);
  expect(container.text).toContain("集計準備中");
  expect(container.text).toContain("10回答ごと");
  expect(container.text).not.toMatch(/まだ投票がありません|0票|回答数 0|NaN|Infinity/);
  vi.unstubAllGlobals();
});
