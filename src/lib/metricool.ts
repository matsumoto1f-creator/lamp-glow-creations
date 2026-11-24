// Metricool's public website tag. It is an outside company's script, so it runs on the public
// marketing pages only (Asad, 2026-11-24). It never loads on the application (where a merchant
// types their SSN and tax ID), on an application link (whose address carries the merchant's
// private token), on Offer Check, sign-in, the account page or the staff portal.
//
// The tag sends Metricool the page's address and the address the visitor came from. So it also
// stays off when the visitor came from one of this site's own non-marketing pages: that earlier
// address can carry a merchant's private token. No imports, so the tests can load it.

/** The only pages the tag may load on. A new page is untracked until it is added here. */
export const MARKETING_PATHS = [
  "/",
  "/about",
  "/faq",
  "/how-it-works",
  "/privacy",
  "/terms",
] as const;

const clean = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path) || "/";

export const isMarketingPath = (path: string): boolean =>
  (MARKETING_PATHS as readonly string[]).includes(clean(path));

const HASH = "d109dea0291b67a685c212489ab8f468";

/** Loaded once per document; does nothing off the marketing pages. */
export const METRICOOL_SCRIPT = `(function () {
  var pages = ${JSON.stringify(MARKETING_PATHS)};
  var ok = function (p) {
    p = p.length > 1 ? p.replace(/\\/+$/, "") : p;
    return pages.indexOf(p || "/") !== -1;
  };
  if (!ok(location.pathname)) return;
  var from = document.referrer || "";
  if (from) {
    var m = /^https?:\\/\\/([^\\/?#]+)([^?#]*)/.exec(from);
    if (m && m[1] === location.host && !ok(m[2] || "/")) return;
  }
  var script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = "https://tracker.metricool.com/resources/be.js";
  script.onload = function () {
    beTracker.t({ hash: "${HASH}" });
  };
  document.head.appendChild(script);
})();`;
