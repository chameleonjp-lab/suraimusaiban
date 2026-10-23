import { scoreAnswers } from "../../domain/scoring";
import type { ResultSession, SubmitReceipt } from "../../domain/types";
let current: ResultSession | null = null;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function openResult(receipt: SubmitReceipt): ResultSession {
  const copy = structuredClone(receipt);
  current = freeze({
    receipt: copy,
    individual: scoreAnswers(copy.ballot.answers),
  });
  return current;
}
export function clearResult(): void {
  current = null;
}
export function getResult(): ResultSession | null {
  return current;
}
