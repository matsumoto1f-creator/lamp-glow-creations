import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { contactName } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { card } from "@/components/site/layout";
import { FileThread } from "@/components/chat/file-thread";

/**
 * The merchant's conversation with Lamp about this file, on the account page. Headed with the same
 * contact the application emails name (the rep's team lead when there is one). Hidden until the
 * conversation's SQL has run.
 */
export function MerchantMessages({
  applicationId,
  userId,
}: {
  applicationId: string;
  userId: string;
}) {
  const [contact, setContact] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const hide = useCallback(() => setOff(true), []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    (async () => {
      const a = await sb
        .from("applications")
        .select("rep_slug")
        .eq("id", applicationId)
        .maybeSingle();
      const slug = (a.data as { rep_slug: string | null } | null)?.rep_slug ?? null;
      if (!slug) {
        if (live) setContact(contactName(null, []));
        return;
      }
      const rep = await sb
        .from("reps")
        .select("slug,name,admin_slug")
        .eq("slug", slug)
        .maybeSingle();
      const r = rep.data as { slug: string; name: string; admin_slug: string | null } | null;
      const lead = r?.admin_slug
        ? await sb
            .from("reps")
            .select("slug,name,admin_slug")
            .eq("slug", r.admin_slug)
            .maybeSingle()
        : null;
      const rows = [r, lead?.data as typeof r].filter(Boolean) as NonNullable<typeof r>[];
      if (live) setContact(contactName(slug, rows));
    })();
    return () => {
      live = false;
    };
  }, [applicationId]);

  if (off) return null;
  const who = contact ?? "the Lamp team";

  return (
    <section className={cn(card, "p-6")} id="messages" data-merchant-messages>
      <h2 className="font-display text-lg font-semibold">
        Messages with {who === "the Lamp team" ? "Lamp" : `${who} at Lamp`}
      </h2>
      <p className="mt-2 text-sm text-smoke">
        Ask anything about your file here. To send a statement or other document, use{" "}
        <a className="underline" href="#what-we-need">
          What we need
        </a>
        ; it shows up in this conversation too.
      </p>
      <FileThread
        applicationId={applicationId}
        viewer="merchant"
        userId={userId}
        placeholder="Write a message"
        emptyText="No messages yet. Write here and your Lamp rep will answer."
        onUnavailable={hide}
      />
    </section>
  );
}
