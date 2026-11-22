import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { postAsMe } from "@/lib/server-api";
import { btnOutline } from "@/components/site/layout";
import { cn } from "@/lib/utils";

/**
 * On a file with no full application (the merchant only answered the website's quick questions):
 * says so plainly, so nobody reads the short PDF as missing data, and lets the file's rep or an
 * admin email the merchant to finish it on their account, where it lands on this same file.
 */
export function QuickOnly({
  fileId,
  firstName,
  hasAccount,
  canSend,
}: {
  fileId: string;
  firstName: string | null;
  hasAccount: boolean;
  canSend: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);
  const who = firstName?.trim() || "The merchant";

  async function send() {
    setBusy(true);
    setOut(null);
    const r = await postAsMe<{ ok: boolean; to: string }>("/api/application/finish", {
      application_id: fileId,
    }).catch(() => null);
    setBusy(false);
    setOut(
      r?.ok
        ? { ok: true, text: `Sent to ${r.data.to}. It's on the timeline.` }
        : { ok: false, text: r?.data.error ?? "Couldn't reach the server. Try again." },
    );
  }

  return (
    <div
      className="mt-4 rounded-xl bg-amber-500/10 p-4 text-sm ring-1 ring-amber-500/30"
      data-quick-only
    >
      <p className="font-semibold">Quick answers only</p>
      <p className="mt-1 text-smoke">
        {who} answered the website&apos;s quick questions but hasn&apos;t filled in the full
        application, so the PDF has no SSN, date of birth, addresses, EIN, owners or signature.
        Nothing is hidden: it hasn&apos;t been given yet.
      </p>
      {canSend &&
        (hasAccount ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={cn(btnOutline, "px-4 py-2 max-md:min-h-11")}
              disabled={busy || out?.ok}
              onClick={() => void send()}
              data-send-finish
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Email {firstName?.trim() || "them"} to finish it
            </button>
            <span className="text-xs text-smoke">
              They sign in on getlamp.app and finish it there; it lands on this file.
            </span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-smoke">
            They have no account yet: send the full application from Staff &gt; Applications.
          </p>
        ))}
      {out && (
        <p
          className={cn("mt-2 text-sm", out.ok ? "text-forest" : "text-destructive")}
          role="status"
        >
          {out.text}
        </p>
      )}
    </div>
  );
}
