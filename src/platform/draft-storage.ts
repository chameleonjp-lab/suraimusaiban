type LegacyStore = Pick<Storage, "length" | "key" | "removeItem">;
/** Migration cleanup only. Never reads, restores or writes personal state. */
export function purgeLegacyStorage(...stores: (LegacyStore | null)[]): void {
  for (const store of stores) {
    if (!store) continue;
    try {
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
      for (const key of keys)
        if (key?.startsWith("slime-trial:")) store.removeItem(key);
    } catch {
      // Browser storage may be blocked; the application uses memory only.
    }
  }
}
export function purgeBrowserLegacyStorage(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      purgeLegacyStorage(window[name]);
    } catch {
      // The storage property itself can be blocked.
    }
  }
}
