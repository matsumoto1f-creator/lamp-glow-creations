// "On the phone with someone new": a rep calling a business that isn't in their engine leads
// captures the email first, then either emails them their own application link to finish later,
// or opens it to fill in together on the call. No imports, so the Deno tests load it as is.

export type PhoneStart = {
  email: string;
  phone: string;
  first_name: string;
  business_name: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[0-9+()\s.\-x]{7,40}$/;

/** What's wrong with the box, or null when it's ready. The email comes first: it's the point. */
export function phoneStartProblem(p: PhoneStart): string | null {
  const email = p.email.trim().toLowerCase();
  if (!email) return "Get their email first.";
  if (!EMAIL.test(email)) return "That email address doesn't look right.";
  if (p.phone.trim() && !PHONE.test(p.phone.trim()))
    return "Numbers only for the cell, like (718) 555-0142.";
  if (!p.first_name.trim() && !p.business_name.trim())
    return "Add their first name or business, so you know who it's for.";
  return null;
}

/** The rep's fill-in mode of a personal link: the link with fill=rep added. */
export function fillInUrl(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}fill=rep`;
}
