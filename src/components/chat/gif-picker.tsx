import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { btnPrimary } from "@/components/site/layout";
import { input } from "@/components/staff/field-styles";
import { gifKeyProblem, KLIPY_PLACEHOLDER, klipyUrl, parseKlipy, type Gif } from "@/lib/gifs";

/**
 * The GIF button beside the message box, in staff rooms and direct messages only. It opens a
 * panel that shows what's trending on KLIPY and searches as the person types; picking one sends it
 * as a message at once. KLIPY's rules (src/lib/gifs.ts): the search goes from this browser straight
 * to KLIPY, results stay in KLIPY's order, the media loads from KLIPY's own address, and the box
 * says "Search KLIPY".
 *
 * Lamp's KLIPY app key lives in chat_settings: staff read it, admins set it. Until there is one the
 * button is hidden from reps, and an admin gets a box to paste it.
 */
let cachedKey: string | null | undefined; // undefined: not read yet

async function readKey(): Promise<string | null | undefined> {
  if (cachedKey !== undefined) return cachedKey;
  const sb = getSupabase();
  if (!sb) return undefined;
  const r = await sb
    .from("chat_settings" as never)
    .select("klipy_app_key")
    .maybeSingle();
  if (r.error) return undefined; // not set up yet, or not staff: no GIF button; ask again next time
  cachedKey = ((r.data as { klipy_app_key?: string | null } | null)?.klipy_app_key ?? null) || null;
  return cachedKey;
}

/** A steady, opaque id for this person, as KLIPY asks: a hash, never their email or Lamp id. */
async function customerOf(userId: string): Promise<string> {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lamp:${userId}`));
    return [...new Uint8Array(d)]
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "lamp-staff";
  }
}

export function GifPicker({
  userId,
  isAdmin,
  disabled,
  onSend,
}: {
  userId: string;
  isAdmin: boolean;
  disabled?: boolean | undefined;
  /** send this KLIPY address as a GIF message; resolves to an error line, or null when sent */
  onSend: (url: string) => Promise<string | null>;
}) {
  const [key, setKey] = useState<string | null | undefined>(cachedKey);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    let live = true;
    void readKey().then((k) => {
      if (live) setKey(k);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const search = useCallback(
    async (words: string) => {
      if (!key) return;
      const mine = ++asked.current;
      setError("");
      try {
        const r = await fetch(klipyUrl(key, words, await customerOf(userId)), {
          referrerPolicy: "no-referrer",
        });
        const parsed = parseKlipy(await r.json().catch(() => null));
        if (mine !== asked.current) return; // a newer search has gone out
        setGifs(parsed.gifs);
        setError(parsed.error ?? (parsed.gifs.length ? "" : "Nothing for that. Try other words."));
      } catch {
        if (mine !== asked.current) return;
        setGifs([]);
        setError("Couldn't reach KLIPY. Check your connection and try again.");
      }
    },
    [key, userId],
  );

  // what's trending when it opens, then a search a moment after the typing stops
  useEffect(() => {
    if (!open || !key) return undefined;
    const t = window.setTimeout(() => void search(q), q ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [open, key, q, search]);

  const saveKey = async () => {
    const problem = gifKeyProblem(newKey);
    if (problem) {
      setError(problem);
      return;
    }
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setError("");
    const value = newKey.trim();
    // prove the key with KLIPY before saving it
    try {
      const r = await fetch(klipyUrl(value, "", await customerOf(userId)), {
        referrerPolicy: "no-referrer",
      });
      const parsed = parseKlipy(await r.json().catch(() => null));
      if (parsed.error) {
        setError("KLIPY didn't accept that key. Copy it again from KLIPY's Partner Panel.");
        setBusy(false);
        return;
      }
    } catch {
      setError("Couldn't reach KLIPY to test the key. Nothing was saved.");
      setBusy(false);
      return;
    }
    const { error: err } = await sb
      .from("chat_settings" as never)
      .update({ klipy_app_key: value } as never)
      .eq("id", true);
    setBusy(false);
    if (err) {
      setError("The key works, but it couldn't be saved. Try again in a minute.");
      return;
    }
    cachedKey = value;
    setKey(value);
    setNewKey("");
  };

  const pick = async (g: Gif) => {
    if (busy) return;
    setBusy(true);
    const problem = await onSend(g.send.url);
    setBusy(false);
    if (problem) setError(problem);
    else {
      setOpen(false);
      setQ("");
    }
  };

  // no key yet: nothing for a rep to use; an admin gets the box to add one
  if (key === undefined || (!key && !isAdmin)) return null;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        className={cn(
          "grid h-11 place-items-center rounded-full px-3 text-xs font-bold tracking-wide ring-1 ring-line hover:bg-sand/60",
          open && "bg-sand/60",
        )}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Send a GIF"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-gif-open
      >
        GIF
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 z-40 mb-2 flex max-h-96 w-[min(20rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line bg-night p-3 shadow-xl"
          role="dialog"
          aria-label="GIFs"
          data-gif-panel
        >
          {!key ? (
            <form
              className="space-y-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
              data-gif-setup
            >
              <p className="font-semibold">GIFs need a KLIPY app key</p>
              <p className="text-smoke">
                KLIPY is free. Make a key in its{" "}
                <a
                  href="https://partner.klipy.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Partner Panel
                </a>{" "}
                under API Keys, and paste it here. Staff&apos;s GIF searches go from their browser
                to KLIPY.
              </p>
              <input
                className={cn(input, "min-h-11 font-mono")}
                value={newKey}
                onChange={(e) => {
                  setNewKey(e.target.value);
                  setError("");
                }}
                placeholder="KLIPY app key"
                aria-label="KLIPY app key"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={busy}
                data-gif-key-input
              />
              <button
                type="submit"
                className={cn(btnPrimary, "min-h-11 w-full")}
                disabled={busy || !newKey.trim()}
                data-gif-key-save
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Test and save
              </button>
            </form>
          ) : (
            <>
              <input
                className={cn(input, "min-h-11 shrink-0")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={KLIPY_PLACEHOLDER}
                aria-label="Search for a GIF"
                autoComplete="off"
                enterKeyHint="search"
                data-gif-search
              />
              <div
                className="mt-2 min-h-24 flex-1 overflow-y-auto overscroll-contain"
                aria-busy={gifs === null}
              >
                {gifs === null ? (
                  <div className="grid place-items-center py-8">
                    <Loader2 className="size-5 animate-spin text-smoke" />
                  </div>
                ) : (
                  <div className="columns-2 gap-1.5" data-gif-results>
                    {gifs.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        className="mb-1.5 block w-full overflow-hidden rounded-lg ring-1 ring-line hover:ring-leaf focus-visible:ring-leaf"
                        onClick={() => void pick(g)}
                        disabled={busy}
                        aria-label={`Send the GIF: ${g.title}`}
                        data-gif={g.id}
                      >
                        <img
                          src={g.preview.url}
                          width={g.preview.width}
                          height={g.preview.height}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-auto w-full"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-2 shrink-0 text-right text-[11px] text-smoke">Powered by KLIPY</p>
            </>
          )}
          {error && (
            <p className="mt-2 shrink-0 text-xs" role="alert" data-gif-error>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
