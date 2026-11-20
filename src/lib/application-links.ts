// Application links: staff send a merchant a personal link to the full application; the merchant
// fills it in, signs on the page and submits without an account; the signed file lands with the
// rep who sent it. Shared by the browser (staff panel, the application page) and the server
// routes (application-links.server.ts). Pure functions and types only.
//
// Merchant copy: never the word "loan".
import { b64 } from "./funder-send.ts";

export const LINK_TTL_DAYS = 30;
/** Per request, so one click can't send hundreds of emails. */
export const MAX_RECIPIENTS = 50;
export const MAX_NOTE = 1000;
/** Bank statements and other files a merchant may add from the link, before they have an account. */
export const MAX_LINK_UPLOADS = 12;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_SIGNED_PDF_BYTES = 8 * 1024 * 1024;
export const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic"];

/** Where the browser keeps the claim tokens of applications it submitted, until they're claimed. */
export const CLAIMS_KEY = "lamp.application.claims.v1";

export type Channel = "email" | "link";

/** One person in the staff Send panel: a lead from the list, or someone typed in. */
export type Recipient = {
  lead_id?: number | null;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
  channel: Channel;
};

/**
 * What kind of email goes with the link, so the words match what the rep said on the call. Every
 * kind carries the same personal application link (a signed file still lands in the rep's files);
 * only the words, the button and the page it points to first change.
 *   apply   "Here's your application, as we discussed": they're ready to apply
 *   thanks  met or spoke with someone at the business, the owner or not: a thank-you and what
 *           Lamp is, with nothing asked of them (Asad, 2026-11-20: "a hey, thanks for giving us the
 *           time kind of email so we can get out there in front of people")
 *   later   not looking now, or wanted something else: what Lamp is, apply on their own time
 *   options want to see what's out there first: the full application, framed as how they see offers
 *   offer   already have an offer elsewhere: Offer Check, and the application if we can beat it
 */
export const EMAIL_KINDS = ["apply", "thanks", "later", "options", "offer"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];
export const isEmailKind = (v: unknown): v is EmailKind =>
  typeof v === "string" && (EMAIL_KINDS as readonly string[]).includes(v);

/**
 * For the staff picker: what each kind is for, in the rep's words. `short` is the button on a
 * lead's own page, where the rep picks the email right after the call.
 */
export const EMAIL_KIND_LABEL: Record<EmailKind, { label: string; when: string; short: string }> = {
  apply: {
    label: "The application, as we discussed",
    when: "They're ready to apply.",
    short: "The application",
  },
  thanks: {
    label: "Thanks for your time",
    when: "You met or spoke with someone at the business, the owner or not, and want Lamp in front of them. A short thank-you and what Lamp is. Nothing is asked of them.",
    short: "Thanks for your time",
  },
  later: {
    label: "Not right now: Lamp for later",
    short: "Not right now",
    when: "Wrong time, or they wanted something you don't have. A thank-you, what Lamp is, and the application whenever they're ready.",
  },
  options: {
    label: "Wants to see their options first",
    short: "Wants options first",
    when: "They want to see what's out there before committing. The full application, framed as the way to see real offers side by side.",
  },
  offer: {
    label: "Already has an offer",
    short: "Has an offer",
    when: "They have an offer from someone else. Offer Check shows what it really costs.",
  },
};

/** Days a personal link stays open: longer for the kinds that say "whenever you're ready". */
export const linkDays = (kind: EmailKind) => (kind === "apply" ? LINK_TTL_DAYS : 90);

export type SendRequest =
  | {
      action: "send";
      rep_slug?: string;
      note?: string;
      /** Which email; missing means "apply". */
      kind?: EmailKind;
      recipients: Recipient[];
    }
  | { action: "resend"; invite_id: string; channel: Channel; note?: string }
  | { action: "cancel"; invite_id: string };

export type SendResult = {
  /** Index into the request's recipients (send) or 0 (resend, cancel). */
  index: number;
  status: "sent" | "link" | "skipped" | "failed" | "cancelled";
  detail: string;
  invite_id?: string;
  /** Only for channel "link": the personal link to copy or text. Never returned for email. */
  url?: string;
  /** The kind of email this link went with, so copied text uses the same words. */
  kind?: EmailKind;
};

export type OpenState = "open" | "signed" | "expired" | "cancelled" | "not_found" | "unknown_rep";

export type OpenResponse = {
  state: OpenState;
  /** A personal link's invite id: the browser keys its saved draft by it, so a resent link
   *  (new token, same invite) opens the merchant's progress. Null for a rep's public link. */
  draft?: string | null;
  rep: { slug: string; name: string; title: string | null } | null;
  /** What the rep already knows, so the merchant doesn't type it twice. */
  prefill: {
    first_name: string;
    last_name: string;
    business_name: string;
    email: string;
    phone: string;
  } | null;
  /** Answers a rep filled in with the merchant on the phone (Start application), saved on the
   *  invite without SSNs or dates of birth, and when; the page opens them in any browser. */
  answers?: Record<string, unknown> | null;
  answers_step?: number | null;
  answers_saved_at?: string | null;
};

/**
 * POST /api/application/draft, signed-in staff only, for a personal link they own: "save" keeps
 * the answers typed with the merchant on the phone; "email" sends that same link to the merchant
 * to check, add their SSN and date of birth, and sign.
 */
export type DraftRequest =
  | { action: "save"; token: string; draft: Record<string, unknown>; step: number }
  | { action: "email"; token: string; to?: string };

export type SubmitResponse = {
  application_id: string;
  claim_token: string;
  rep_name: string;
  email: string;
  /** What the database stamped, for the signed PDF's signature record. */
  signed_at: string;
  signer_ip: string | null;
};

/**
 * What the page sends to /api/application/upload as "kind": bank statements (several), or the
 * signed application PDF it builds after submit with the database's signed_at and IP (one).
 */
export type UploadKind = "bank_statement" | "funder_application";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const cleanEmail = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** 32 random bytes as base64url: the secret part of a personal link or a claim. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes, false).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isToken = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(s);

/** sha256 hex of the token's UTF-8 bytes; the database stores only this. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The rep's public link, or a personal one when there's a token. */
export function applicationUrl(site: string, repSlug: string, token?: string | null): string {
  const base = `${site.replace(/\/$/, "")}/application/${encodeURIComponent(repSlug)}`;
  return token ? `${base}?i=${token}` : base;
}

/**
 * The rep's PDF link, getlamp.app/application/<rep>/pdf: the whole one-page form, filled in and
 * signed on the page. Tested against applicationUrl (A/B); both count opens as page views and
 * signed files as .../signed (see recordSigned).
 */
export function applicationPdfUrl(site: string, repSlug: string): string {
  return `${applicationUrl(site, repSlug)}/pdf`;
}

/**
 * The blank fillable form, for "Prefer paper? Download the PDF": the template with a field over
 * every box, made by
 * buildApplicationPdf(template, { text: {}, checked: {} }, "all", Inter). Rebuild it when the
 * template in public/forms changes.
 */
export const BLANK_APPLICATION_PDF = "/forms/lamp-application.pdf";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The site and rep a personal link belongs to: https://getlamp.app/application/<rep>?i=... */
function linkParts(url: string): { site: string; rep: string } {
  const m = /^(https?:\/\/[^/]+)\/application\/([^/?#]+)/.exec(url);
  return m ? { site: m[1]!, rep: m[2]! } : { site: "https://getlamp.app", rep: "" };
}

/** The other pages a softer email points to first, for the rep the link belongs to. */
export function kindLinks(url: string) {
  const { site } = linkParts(url);
  return {
    site,
    howItWorks: `${site}/how-it-works`,
    offerCheck: `${site}/offer-check`,
  };
}

type EmailWords = {
  subject: string;
  /** The opening line, unless the rep wrote their own note. */
  opener: string;
  body: string[];
  button: { label: string; url: string };
  /** A line under the button that names the personal application link, when the button goes elsewhere. */
  appLine: string | null;
};

/** The words for each kind. Facts here come from the site's own pages; never the word "loan". */
export function emailWords(
  kind: EmailKind,
  o: { businessName: string; url: string; filled?: boolean },
): EmailWords {
  const biz = o.businessName.trim();
  const forBiz = biz ? ` for ${biz}` : "";
  const l = kindLinks(o.url);
  if (o.filled)
    return {
      subject: `Your Lamp application${forBiz}: ready to sign`,
      opener: `Here's the application${forBiz} we filled in together on the phone.`,
      body: [
        "Open it, check everything over, and add your SSN and date of birth (we don't save those for you). Then sign right on the page, on your phone or computer, and it comes straight to me.",
        "If you have your last four months of business bank statements handy, you can add them before you sign. If not, you can send them later.",
      ],
      button: { label: "Check and sign", url: o.url },
      appLine: null,
    };
  if (kind === "thanks")
    return {
      subject: "Thanks for your time today",
      opener: "Thanks for giving me a few minutes today. I appreciate it.",
      body: [
        // Asad, 2026-11-20: "we are a business financing brokerage and have an assortment of
        // different private financing and standard commercial products"
        "Lamp is a business financing brokerage. We work with private funders and standard commercial programs, so one conversation covers working capital, lines of credit, equipment financing, invoice factoring, SBA and term funding.",
        `If financing ever comes up${biz ? ` at ${biz}` : ""}, reply to this email and it comes straight to me. There's nothing you need to do until then.`,
      ],
      button: { label: "See how Lamp works", url: l.howItWorks },
      appLine: "The application, if it's ever useful",
    };
  if (kind === "later")
    return {
      subject: "Thanks for taking my call",
      opener:
        "Thanks for taking the time to talk today. I know it wasn't the right time, so I'll keep this short.",
      body: [
        "Lamp helps businesses find funding: working capital, equipment financing, invoice factoring, SBA and term funding. We work with a group of funders, so when you're ready you see what's actually available to you and what it costs in plain numbers, before you commit to anything.",
        `Whenever it suits you, you can make an account on getlamp.app with just your email, and fill in your application${forBiz} on your own time. It takes about ten minutes, and any offers show up in your account as they come in.`,
      ],
      button: { label: "See how Lamp works", url: l.howItWorks },
      appLine: "Your application, ready whenever you are",
    };
  if (kind === "options")
    return {
      subject: `Your options${forBiz}`,
      opener:
        "Thanks for talking with me. You wanted to see what's out there before committing to anything, which makes sense.",
      body: [
        "The application is how funders tell us what they can actually offer you. It takes about ten minutes, and you sign right on the page.",
        "When offers come in, you see them side by side in your account: what lands in your account, what you pay each time, and the total cost. You're never obligated to take any offer.",
      ],
      button: { label: "Open my application", url: o.url },
      appLine: null,
    };
  if (kind === "offer")
    return {
      subject: "A quick way to check the offer you have",
      opener:
        "Thanks for talking with me. Since you already have an offer in hand, here's a quick way to see what it really costs before you sign anything.",
      body: [
        "Enter the amount, the payback and the term, and Offer Check shows the real cost in dollars, an estimated yearly rate, and how much it takes out of your deposits each week. You can compare up to three offers side by side.",
        `If you'd like us to try to beat it, your application${forBiz} is below. It takes about ten minutes, and you're never obligated to take any offer.`,
      ],
      button: { label: "Check my offer", url: l.offerCheck },
      appLine: "Your application, if you'd like us to try to beat it",
    };
  return {
    subject: `Your Lamp application${forBiz}`,
    opener: `Here's your funding application${forBiz}, as we discussed.`,
    body: [
      "It takes about ten minutes. You sign it right on the page, on your phone or computer, and it comes straight to me.",
      "If you have your last four months of business bank statements handy, you can add them at the end. If not, you can send them later.",
    ],
    button: { label: "Open my application", url: o.url },
    appLine: null,
  };
}

/** The email a merchant gets. Plain text and a simple branded HTML version of the same words. */
export function inviteEmail(opts: {
  firstName: string;
  businessName: string;
  repName: string;
  note: string;
  url: string;
  legalName: string;
  address: string;
  /** Filled in with them on the phone: they only check it, add the private numbers and sign. */
  filled?: boolean;
  /** Which words; missing means "apply". */
  kind?: EmailKind;
}): { subject: string; text: string; html: string } {
  const hi = opts.firstName.trim() ? `Hi ${opts.firstName.trim()},` : "Hi,";
  const w = emailWords(opts.kind ?? "apply", {
    businessName: opts.businessName,
    url: opts.url,
    ...(opts.filled ? { filled: true } : {}),
  });
  const subject = w.subject;
  const note = opts.note.trim();
  const body = [note || w.opener, ...w.body];
  const footer = [
    `You're getting this because you spoke with ${opts.repName} at Lamp. Not interested? Reply "stop" and we won't email you again.`,
    [opts.legalName, opts.address].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const textButton =
    w.button.url === opts.url
      ? `${opts.filled ? "Check and sign your application" : "Open your application"}: ${opts.url}`
      : `${w.button.label}: ${w.button.url}`;
  return renderEmail({
    hi,
    subject,
    body,
    textButton,
    button: w.button,
    appLine: w.appLine ? { label: w.appLine, url: opts.url } : null,
    repName: opts.repName,
    footer,
  });
}

/**
 * For a file that came in through the website's quick questions only: asks the merchant to finish
 * the full application on their own account, so it lands on that same file (no second file). The
 * button opens getlamp.app/account; they sign in with their email, no password.
 */
export function finishEmail(opts: {
  firstName: string;
  businessName: string;
  repName: string;
  site: string;
  legalName: string;
  address: string;
}): { subject: string; text: string; html: string } {
  const biz = opts.businessName.trim();
  const forBiz = biz ? ` for ${biz}` : "";
  const url = `${opts.site.replace(/\/$/, "")}/account`;
  return renderEmail({
    hi: opts.firstName.trim() ? `Hi ${opts.firstName.trim()},` : "Hi,",
    subject: `Finish your Lamp application${forBiz}`,
    body: [
      `Thanks for checking your options with Lamp. To get you real offers, funders need the full application${forBiz}: the business and owner details, and your signature.`,
      "It takes about ten minutes, and your answers so far are already saved. Sign in to your account with this email address (we'll email you a secure sign-in link, no password needed) and press Start my application.",
      "If you have your last three months of business bank statements handy, you can add them there too.",
    ],
    textButton: `Finish my application: ${url}`,
    button: { label: "Finish my application", url },
    appLine: null,
    repName: opts.repName,
    footer: [
      `You're getting this because you checked your options on getlamp.app. Not interested? Reply "stop" and we won't email you again.`,
      [opts.legalName, opts.address].filter(Boolean).join(" · "),
    ].filter(Boolean),
  });
}

/**
 * The "finish your application" reminder (finish-reminders.ts says when): to someone who started
 * on a rep's link, the website's application, or a personal link, and left before signing. The
 * button opens the same application; on the phone or computer they started on, it picks up where
 * they left off (the answers are kept in that browser), so the email never claims more than that.
 * n is 1 (an hour later) or 2 (the next morning, the last one).
 */
export function reminderEmail(opts: {
  n: 1 | 2;
  firstName: string;
  businessName: string;
  /** The rep whose link it was; null for the website's own application. */
  repName: string | null;
  url: string;
  stopUrl: string;
  legalName: string;
  address: string;
}): { subject: string; text: string; html: string } {
  const biz = opts.businessName.trim();
  const forBiz = biz ? ` for ${biz}` : "";
  const first = opts.firstName.trim();
  const body =
    opts.n === 1
      ? [
          "You're most of the way there. Funders need the full application to make you a real offer.",
          "It takes about ten more minutes. On the phone or computer you started on, it picks up where you left off.",
          "If you have your last three months of business bank statements handy, you can add them as you go.",
        ]
      : [
          `Your application${forBiz} is still open. Funders need it finished and signed to make you a real offer, and it takes about ten minutes.`,
          "This is the last reminder we'll send.",
        ];
  return renderEmail({
    hi: first ? `Hi ${first},` : "Hi,",
    subject:
      opts.n === 1
        ? `Finish your Lamp application${forBiz}`
        : `Your Lamp application${forBiz} is still open`,
    body,
    textButton: `Finish my application: ${opts.url}`,
    button: { label: "Finish my application", url: opts.url },
    appLine: null,
    repName: opts.repName ?? "The Lamp team",
    footer: [
      `You're getting this because you started an application on getlamp.app${opts.repName ? ` from ${opts.repName}'s link` : ""}.`,
      [opts.legalName, opts.address].filter(Boolean).join(" · "),
    ].filter(Boolean),
    footerLink: { text: "Don't want reminders?", label: "Stop them", url: opts.stopUrl },
  });
}

/** The plain-text and branded HTML versions of one Lamp email, from its parts. */
function renderEmail(o: {
  hi: string;
  subject: string;
  body: string[];
  textButton: string;
  button: { label: string; url: string };
  appLine: { label: string; url: string } | null;
  repName: string;
  footer: string[];
  /** A link in the small print (the reminders' stop link): a line of its own in the text. */
  footerLink?: { text: string; label: string; url: string };
}): { subject: string; text: string; html: string } {
  const { hi, subject, body, footer } = o;
  const fl = o.footerLink;
  const text = [
    hi,
    "",
    ...body.flatMap((p) => [p, ""]),
    o.textButton,
    ...(o.appLine ? ["", `${o.appLine.label}: ${o.appLine.url}`] : []),
    "",
    "Any questions, just reply to this email.",
    "",
    o.repName,
    "Lamp · getlamp.app",
    "",
    ...(fl ? [`${fl.text} ${fl.label}: ${fl.url}`] : []),
    ...footer,
  ].join("\r\n");

  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1f2a24">${esc(s)}</p>`;
  const appLink = o.appLine
    ? `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#1f2a24">${esc(o.appLine.label)}: <a href="${esc(o.appLine.url)}" style="color:#2f6f43;font-weight:700">open my application</a></p>\n`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef2ee">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ee;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:#0f1f17;padding:22px 28px">
<span style="display:inline-block;width:14px;height:14px;border-radius:7px;background:#4a985e;box-shadow:0 0 12px 3px rgba(74,152,94,.7);vertical-align:middle"></span>
<span style="font-size:20px;font-weight:700;color:#f3f6f2;vertical-align:middle;margin-left:10px;letter-spacing:-.3px">Lamp<span style="color:#4a985e">.</span></span>
</td></tr>
<tr><td style="padding:30px 28px 8px">
${p(hi)}
${body.map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:#4a985e">
<a href="${esc(o.button.url)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:700;color:#0f1f17;text-decoration:none;border-radius:999px">${esc(o.button.label)}</a>
</td></tr></table>
${appLink}${p("Any questions, just reply to this email.")}
<p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#1f2a24">${esc(o.repName)}</p>
<p style="margin:0 0 28px;font-size:14px;color:#5b6b61">Lamp · getlamp.app</p>
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e3e9e4">
${fl ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#7a887f">${esc(fl.text)} <a href="${esc(fl.url)}" style="color:#2f6f43">${esc(fl.label)}</a></p>\n` : ""}${footer.map((f) => `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#7a887f">${esc(f)}</p>`).join("\n")}
<p style="margin:0;font-size:12px;line-height:1.5;color:#7a887f">If the button doesn't work, paste this into your browser: ${esc(o.button.url)}</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

/** The text a rep pastes into a text message, in the same words as the email kind. */
export function inviteSms(
  firstName: string,
  repName: string,
  url: string,
  kind: EmailKind = "apply",
): string {
  const hi = firstName.trim() ? `Hi ${firstName.trim()}, ` : "";
  const l = kindLinks(url);
  if (kind === "thanks")
    return `${hi}it's ${repName} at Lamp. Thanks for your time today. Lamp is a business financing brokerage; here's how it works: ${l.howItWorks}. If financing ever comes up, your application is here: ${url}`;
  if (kind === "later")
    return `${hi}it's ${repName} at Lamp. Thanks for talking today. No rush at all: here's how Lamp works (${l.howItWorks}) and your application, for whenever you're ready: ${url}`;
  if (kind === "options")
    return `${hi}it's ${repName} at Lamp. Here's your application, so funders can show you real offers side by side. It takes about 10 minutes and you're never obligated to take one: ${url}`;
  if (kind === "offer")
    return `${hi}it's ${repName} at Lamp. Here's where you can see what your current offer really costs: ${l.offerCheck}. If you'd like us to try to beat it, your application is here: ${url}`;
  return `${hi}it's ${repName} at Lamp. Here's your application. It takes about 10 minutes and you sign right on the page: ${url}`;
}

/** A multipart/alternative message (text and HTML) with an optional Reply-To. */
export function buildAltMime(opts: {
  from: string;
  to: string;
  replyTo?: string | null;
  /** Copied in: the person the sending rep reports to. */
  cc?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  boundary?: string;
}): string {
  for (const v of [opts.from, opts.to, opts.replyTo ?? "", opts.cc ?? ""]) {
    if (/[\r\n]/.test(v)) throw new Error("bad address");
  }
  const boundary = opts.boundary ?? `lamp-${crypto.randomUUID()}`;
  const subject = opts.subject.replace(/[\r\n]+/g, " ");
  const head = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${/^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${b64(new TextEncoder().encode(subject), false)}?=`}`,
    "MIME-Version: 1.0",
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(body)),
    ].join("\r\n");
  if (!opts.html) {
    return [
      ...head,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      b64(new TextEncoder().encode(opts.text)),
      "",
    ].join("\r\n");
  }
  return `${head.join("\r\n")}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${part("text/plain", opts.text)}\r\n${part("text/html", opts.html)}\r\n--${boundary}--\r\n`;
}

/**
 * Display name for a From header. Drops only what could break the header (quotes, backslashes,
 * control characters, CR/LF among them); plain ASCII is quoted, anything else (José, O’Neil) is
 * RFC 2047 encoded, like the Subject.
 */
export const fromName = (s: string) => {
  const n = s.replace(/["\\\p{Cc}]/gu, "").trim() || "Lamp";
  return /^[\x20-\x7e]*$/.test(n)
    ? `"${n}"`
    : `=?UTF-8?B?${b64(new TextEncoder().encode(n), false)}?=`;
};

// ---------- Browser: claim tokens kept after submitting ----------

export function loadClaims(): string[] {
  try {
    const raw = window.localStorage.getItem(CLAIMS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(isToken).slice(-20) : [];
  } catch {
    return [];
  }
}

export function saveClaim(token: string) {
  try {
    const next = [...loadClaims().filter((t) => t !== token), token].slice(-20);
    window.localStorage.setItem(CLAIMS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the emailed-link rule can still match them */
  }
}

export function clearClaims() {
  try {
    window.localStorage.removeItem(CLAIMS_KEY);
  } catch {
    /* ignore */
  }
}
