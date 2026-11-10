import { useId, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary, card } from "@/components/site/layout";
import { chip, input } from "@/components/staff/field-styles";
import { type KeyInfo, keyLine, keyProblem, tidyKey } from "@/lib/ai-key";

/**
 * The Anthropic key card on AI activity (admins only): shows whether Lamp has a key, where it
 * comes from and who saved it, and lets an admin paste one, replace it or remove it. A pasted key
 * goes to /api/ai/key, which tests it with Anthropic before saving it in the database's Vault. The
 * key is never shown again: this card never receives it back.
 */
async function post(body: { action: "set"; key: string } | { action: "remove" }): Promise<KeyInfo> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again.");
  const r = await fetch("/api/ai/key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { key?: KeyInfo; error?: string };
  if (!r.ok || !j.key) throw new Error(j.error || `The server answered ${r.status}.`);
  return j.key;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function AiKeyCard({ info, onChanged }: { info: KeyInfo; onChanged: (k: KeyInfo) => void }) {
  const fieldId = useId();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const showField = info.source === null || editing;

  const save = async () => {
    const problem = keyProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy("save");
    setError("");
    setNote("");
    try {
      const next = await post({ action: "set", key: tidyKey(value) });
      setValue("");
      setEditing(false);
      setNote(
        next.source === "secrets"
          ? "Saved. The key in the server's secrets is still the one in use."
          : "Saved. Anthropic accepted the key and Claude is on.",
      );
      onChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the key.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError("");
    setNote("");
    try {
      const next = await post({ action: "remove" });
      setConfirmRemove(false);
      setEditing(false);
      setNote(
        next.source === "secrets"
          ? "Removed the saved key. The key in the server's secrets is still in use."
          : "Removed. Claude is off; Lamp keeps working on its own rules.",
      );
      onChanged(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the key.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn(card, "mt-5 p-5")} data-ai-key={info.source ?? "none"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <KeyRound className="size-4" /> Anthropic key
        </h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            info.source ? "bg-leaf/20 text-forest" : "bg-sand text-ink",
          )}
        >
          {info.source ? "Set" : "Not set"}
        </span>
      </div>
      <p className="mt-2 text-sm" data-ai-key-line>
        {keyLine(info, day)}
      </p>
      <p className="mt-1 max-w-2xl text-sm text-smoke">
        This is the key Claude runs on in Lamp. Anthropic bills whoever owns it, and Lamp stops each
        job at its monthly limit below. Make one in the{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Anthropic console
        </a>{" "}
        under API keys. Lamp tests it before saving, stores it encrypted, and never shows it again.
      </p>

      {info.source === "secrets" && (
        <p className="mt-3 text-sm text-smoke">
          To change the key in use, edit ANTHROPIC_API_KEY in the server&apos;s secrets.
        </p>
      )}

      {showField && (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={fieldId} className="text-sm font-medium">
              {info.saved ? "New key" : "Paste the key"}
            </label>
            <input
              id={fieldId}
              type="password"
              className={cn(input, "mt-1 min-h-11 font-mono")}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError("");
              }}
              placeholder="sk-ant-…"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              disabled={busy !== null}
              data-ai-key-input
            />
          </div>
          <button
            type="submit"
            className={cn(btnPrimary, "min-h-11 px-5")}
            disabled={busy !== null || !value.trim()}
            data-ai-key-save
          >
            {busy === "save" ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Testing with Anthropic…
              </>
            ) : (
              "Test and save"
            )}
          </button>
          {editing && (
            <button
              type="button"
              className={cn(chip, "min-h-11 px-4")}
              onClick={() => {
                setEditing(false);
                setValue("");
                setError("");
              }}
              disabled={busy !== null}
            >
              Cancel
            </button>
          )}
        </form>
      )}

      {!showField && info.saved && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(chip, "min-h-11 px-4")}
            onClick={() => {
              setEditing(true);
              setConfirmRemove(false);
              setNote("");
            }}
            disabled={busy !== null}
            data-ai-key-replace
          >
            Replace the key
          </button>
          {confirmRemove ? (
            <>
              <span className="text-sm">Remove it? Claude stops until a key is added again.</span>
              <button
                type="button"
                className={cn(chip, "min-h-11 px-4")}
                onClick={() => void remove()}
                disabled={busy !== null}
                data-ai-key-remove-confirm
              >
                {busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : null} Yes, remove
              </button>
              <button
                type="button"
                className={cn(chip, "min-h-11 px-4")}
                onClick={() => setConfirmRemove(false)}
                disabled={busy !== null}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className={cn(chip, "min-h-11 px-4")}
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
              data-ai-key-remove
            >
              Remove the key
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl bg-sand px-4 py-3 text-sm" role="alert" data-ai-key-error>
          {error}
        </p>
      )}
      {note && !error && (
        <p className="mt-3 text-sm text-forest" role="status" data-ai-key-note>
          {note}
        </p>
      )}
    </div>
  );
}
