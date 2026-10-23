import type { ContentVersion, Snapshot } from "../../domain/types";
import { loadSnapshot } from "../vote/vote-api";
import { getSupabaseClient } from "../../platform/supabase-client";
/** Watches public aggregate notifications only. Result receipts never subscribe. */
export function watchSnapshot(
  version: ContentVersion,
  onData: (snapshot: Snapshot) => void,
  onError: () => void,
): () => void {
  let closed = false,
    realtime = false,
    last: bigint | null = null,
    request = 0,
    lastSuccess = 0,
    timer: ReturnType<typeof setInterval> | null = null,
    debounce: ReturnType<typeof setTimeout> | null = null;
  const visible = () => document.visibilityState !== "hidden";
  const fetchLatest = async () => {
    if (closed || !visible()) return;
    const ticket = ++request;
    try {
      const snapshot = await loadSnapshot(version);
      if (closed || snapshot.version !== version) return;
      const revision = BigInt(snapshot.revision);
      if (last !== null && revision < last) return;
      last = revision;
      lastSuccess = Math.max(lastSuccess, ticket);
      onData(snapshot);
    } catch {
      if (!closed && ticket > lastSuccess) onError();
    }
  };
  const syncPoll = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (!closed && visible() && !realtime)
      timer = setInterval(() => void fetchLatest(), 30000);
  };
  const queue = () => {
    if (debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      void fetchLatest();
    }, 100);
  };
  const resumed = () => {
    syncPoll();
    if (visible()) void fetchLatest();
  };
  const manual = (event: Event) => {
    if (event instanceof CustomEvent && event.detail !== version) return;
    void fetchLatest();
  };
  document.addEventListener("visibilitychange", resumed);
  window.addEventListener("focus", resumed);
  window.addEventListener("online", resumed);
  window.addEventListener("slime:refresh-snapshot", manual);
  const client = getSupabaseClient();
  const channel = client
    ?.channel(`snapshot-${version}-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "aggregate_snapshots",
        filter: `version=eq.${version}`,
      },
      queue,
    )
    .subscribe((status) => {
      if (closed) return;
      realtime = status === "SUBSCRIBED";
      syncPoll();
      if (status === "SUBSCRIBED") queue();
    });
  syncPoll();
  void fetchLatest();
  return () => {
    closed = true;
    if (timer !== null) clearInterval(timer);
    if (debounce !== null) clearTimeout(debounce);
    document.removeEventListener("visibilitychange", resumed);
    window.removeEventListener("focus", resumed);
    window.removeEventListener("online", resumed);
    window.removeEventListener("slime:refresh-snapshot", manual);
    if (channel && client) void client.removeChannel(channel);
  };
}
