// GIFs in Lamp's staff chat, from KLIPY (docs.klipy.com). Tenor's developer access ended in June
// 2026 and GIPHY charges for production use; KLIPY is free.
//
// KLIPY's rules shape this file: searches go from the person's own browser straight to KLIPY (not
// through Lamp's server), the media loads straight from KLIPY's servers at the address KLIPY gave,
// unaltered, results stay in KLIPY's order, and the search box says "Search KLIPY". So the app key
// is not a secret from staff, and a GIF message is just that address (20261112120000_chat_reactions_gifs.sql
// checks it the same way). GIFs are for staff rooms and direct messages only: a merchant's browser
// is never sent to KLIPY. No imports, so the Deno tests load it as is.

export const KLIPY_API = "https://api.klipy.com/api/v1";
/** Required by KLIPY: the default placeholder of the search box. */
export const KLIPY_PLACEHOLDER = "Search KLIPY";
export const GIF_PAGE = 24;

/** The address of a GIF (or its WebP twin) on KLIPY's media servers, and nothing else. */
const GIF_URL =
  /^https:\/\/static[12]?\.klipy\.com\/[A-Za-z0-9/_.-]{8,250}\.(gif|webp)(\?[A-Za-z0-9=&_.%-]{1,150})?$/;

/** The same test the database applies (chat_gif_url_ok). */
export function isGifUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length <= 500 &&
    GIF_URL.test(url) &&
    !url.includes("..") &&
    !/\/\/[^/]*\/\//.test(url)
  );
}

/** What's wrong with a pasted KLIPY app key, or null when it has the shape of one. */
export function gifKeyProblem(raw: unknown): string | null {
  const k = typeof raw === "string" ? raw.trim() : "";
  if (!k) return "Paste the KLIPY app key first.";
  if (/\s/.test(k)) return "A KLIPY app key has no spaces. Copy it again.";
  if (k.length < 8) return "That key is too short. Copy the whole key.";
  if (k.length > 200) return "That's longer than a key. Paste only the key.";
  if (!/^[A-Za-z0-9._~-]+$/.test(k)) return "A key holds only letters, numbers, dots and dashes.";
  return null;
}

/**
 * Where to ask KLIPY: a search when there are words, otherwise what's trending. customer is an
 * opaque, steady id for the person (KLIPY asks for one); never their email or Lamp user id.
 */
export function klipyUrl(key: string, q: string, customer: string, page = 1): string {
  const words = q.trim().replace(/\s+/g, " ").slice(0, 80);
  const p = new URLSearchParams({
    page: String(Math.max(1, Math.trunc(page) || 1)),
    per_page: String(GIF_PAGE),
    customer_id: customer,
    locale: "us",
    content_filter: "high",
    format_filter: "gif,webp",
  });
  if (words) p.set("q", words);
  return `${KLIPY_API}/${encodeURIComponent(key)}/gifs/${words ? "search" : "trending"}?${p}`;
}

export type GifFile = { url: string; width: number; height: number };
export type Gif = {
  id: string;
  title: string;
  /** small and light, for the grid */
  preview: GifFile;
  /** what goes into the conversation */
  send: GifFile;
};

type Sizes = Record<string, Record<string, unknown> | undefined>;

const file = (sizes: Sizes | undefined, size: string, format: string): GifFile | null => {
  const f = sizes?.[size]?.[format] as
    { url?: unknown; width?: unknown; height?: unknown } | undefined;
  if (!f || !isGifUrl(f.url)) return null;
  const w = Number(f.width);
  const h = Number(f.height);
  return { url: f.url, width: w > 0 ? w : 200, height: h > 0 ? h : 200 };
};

const first = (sizes: Sizes | undefined, order: [string, string][]) => {
  for (const [size, format] of order) {
    const f = file(sizes, size, format);
    if (f) return f;
  }
  return null;
};

/**
 * KLIPY's answer as the picker's tiles, in KLIPY's own order. Anything whose media isn't on
 * KLIPY's servers is left out rather than shown, so a tile can always be sent.
 */
export function parseKlipy(json: unknown): { gifs: Gif[]; more: boolean; error: string | null } {
  const j = json as {
    result?: unknown;
    data?: { data?: unknown; has_next?: unknown };
    errors?: { message?: unknown };
  } | null;
  if (!j || j.result !== true) {
    const m = j?.errors?.message;
    const text = Array.isArray(m) && typeof m[0] === "string" ? m[0] : "";
    return {
      gifs: [],
      more: false,
      error: /api key/i.test(text)
        ? "KLIPY refused Lamp's app key. An admin needs to check it."
        : "KLIPY didn't answer. Try again in a minute.",
    };
  }
  const rows = Array.isArray(j.data?.data) ? (j.data.data as Record<string, unknown>[]) : [];
  const gifs: Gif[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const sizes = r["file"] as Sizes | undefined;
    const preview = first(sizes, [
      ["sm", "webp"],
      ["sm", "gif"],
      ["xs", "webp"],
      ["xs", "gif"],
      ["md", "webp"],
      ["md", "gif"],
      ["hd", "webp"],
      ["hd", "gif"],
    ]);
    const send = first(sizes, [
      ["md", "gif"],
      ["md", "webp"],
      ["sm", "gif"],
      ["hd", "webp"],
      ["hd", "gif"],
      ["sm", "webp"],
    ]);
    if (!preview || !send) continue;
    const title = typeof r["title"] === "string" ? r["title"].trim().slice(0, 80) : "";
    gifs.push({
      id: String(r["id"] ?? r["slug"] ?? send.url),
      title: title || "GIF",
      preview,
      send,
    });
  }
  return { gifs, more: j.data?.has_next === true, error: null };
}

/** What the inbox shows for a conversation whose latest message is a GIF. */
export const gifPreview = (body: string | null | undefined): string | null =>
  isGifUrl(body) ? "Sent a GIF" : null;
