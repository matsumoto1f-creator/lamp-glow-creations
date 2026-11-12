// Spoken notes and the paper link: small pure helpers shared by the staff screens, the paper
// application and the server. No imports, so the Deno tests can load this file as is.

/**
 * Adds what someone just said to the notes they already have. Speech recognition hands back
 * lower-case words with no full stop, so a phrase that starts a new sentence gets a capital, and
 * every phrase ends with a full stop unless it already has its own punctuation.
 */
export function joinSpoken(existing: string, spoken: string): string {
  const said = spoken.replace(/\s+/g, " ").trim();
  if (!said) return existing;
  const before = existing.replace(/\s+$/, "");
  const newSentence = before === "" || /[.!?:]$/.test(before);
  let phrase = newSentence ? said.charAt(0).toUpperCase() + said.slice(1) : said;
  if (!/[.!?,;:]$/.test(phrase)) phrase += ".";
  if (before === "") return phrase;
  return `${before} ${phrase}`;
}

/** Trims spoken notes to a field's limit without cutting a word in half. */
export function fitTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.8 ? cut.slice(0, space) : cut).replace(/\s+$/, "");
}

/**
 * The paper version of an application link: getlamp.app/application/<rep>?i=<token> becomes
 * getlamp.app/application/<rep>/pdf?i=<token>. Works on a full URL or a path, keeps the query and
 * any #fragment, and leaves a link that is already the paper one as it is.
 */
export function paperLink(url: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf("?");
  const path = (qAt >= 0 ? noHash.slice(0, qAt) : noHash).replace(/\/+$/, "");
  const query = qAt >= 0 ? noHash.slice(qAt) : "";
  if (!/\/application\/[^/?#]+(\/pdf)?$/.test(path)) return url;
  return `${path.endsWith("/pdf") ? path : `${path}/pdf`}${query}${hash}`;
}
