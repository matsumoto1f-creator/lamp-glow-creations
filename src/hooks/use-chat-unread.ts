import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { INBOX_POLL_MS, unreadCount, type InboxRow } from "@/lib/chat";

/**
 * How many of this staff member's conversations have something new, for the Messages tab. Zero
 * (and no more asking) until the Messages SQL has run.
 */
export function useChatUnread(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    let live = true;
    let timer = 0;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const { data, error } = await sb.rpc("my_chat_inbox");
      if (!live) return;
      if (error) {
        window.clearInterval(timer); // not there yet, or not allowed: stop asking
        return;
      }
      setCount(unreadCount((data ?? []) as InboxRow[]));
    };
    void load();
    timer = window.setInterval(() => void load(), INBOX_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [enabled]);
  return count;
}
