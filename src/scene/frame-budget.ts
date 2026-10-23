/** A transient stall must not lower quality. Fast frames drain accumulated debt. */
export function createFrameMonitor() {
  let debt = 0;
  let lowered = false;
  return {
    record(seconds: number): boolean {
      if (lowered || !Number.isFinite(seconds) || seconds <= 0) return false;
      debt = seconds > 1 / 30 ? debt + 1 : Math.max(0, debt - 2);
      if (debt < 45) return false;
      lowered = true;
      return true;
    },
  };
}
