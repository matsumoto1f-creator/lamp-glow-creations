import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { chatMissing, type Viewer } from "@/lib/chat";
import { ChatThread } from "@/components/chat/chat-thread";

/**
 * A file's conversation with its merchant (20261110140000_chat_merchant.sql): the merchant on their
 * account page, staff in the file view. Opens (or makes, on first use) the file's one conversation
 * and shows it as a panel. Renders nothing until the conversation's SQL has run, so publishing first
 * is harmless.
 */
export function FileThread({
  applicationId,
  viewer,
  userId,
  isAdmin = false,
  placeholder,
  emptyText,
  onUnavailable,
}: {
  applicationId: string;
  viewer: Viewer;
  userId: string;
  isAdmin?: boolean;
  placeholder: string;
  emptyText: string;
  onUnavailable?: () => void;
}) {
  const [thread, setThread] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    setState("loading");
    setThread(null);
    sb.rpc("open_file_thread", { _application_id: applicationId }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        if (chatMissing(error)) {
          setState("missing");
          onUnavailable?.();
        } else setState("error");
        return;
      }
      setThread(data);
      setState("ready");
    });
    return () => {
      live = false;
    };
  }, [applicationId, onUnavailable]);

  if (state === "missing") return null;
  if (state === "error")
    return (
      <p className="mt-3 text-sm text-smoke">
        Messages couldn't load just now. Refresh the page to try again.
      </p>
    );
  if (!thread)
    return (
      <div className="grid place-items-center py-8">
        <Loader2 className="size-5 animate-spin text-smoke" />
      </div>
    );
  return (
    <div className="mt-4">
      <ChatThread
        threadId={thread}
        userId={userId}
        isAdmin={isAdmin}
        viewer={viewer}
        layout="panel"
        warnLending={viewer === "staff"}
        placeholder={placeholder}
        emptyText={emptyText}
      />
    </div>
  );
}
