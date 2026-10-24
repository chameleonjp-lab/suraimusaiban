import { expect, it } from "vitest";
import { purgeLegacyStorage } from "../../src/platform/draft-storage";
function storage(entries: [string, string][]) {
  const values = new Map(entries);
  return { values, get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null, removeItem: (key: string) => { values.delete(key); } };
}
it("purges only old game keys from both stores", () => {
  const local = storage([["slime-trial:auth:v1", "private"], ["slime-trial:draft:v1:A", "answers"], ["other-app:auth", "keep"]]);
  const session = storage([["slime-trial:preview-id", "id"], ["unrelated", "keep"]]);
  purgeLegacyStorage(local, session);
  expect([...local.values]).toEqual([["other-app:auth", "keep"]]);
  expect([...session.values]).toEqual([["unrelated", "keep"]]);
});
it("continues clearing the second store when the first is unavailable", () => {
  const session = storage([["slime-trial:draft:v1:A", "answers"]]);
  purgeLegacyStorage({ get length() { throw Error("blocked"); }, key: () => null, removeItem: () => {} }, session);
  expect(session.values.size).toBe(0);
});
