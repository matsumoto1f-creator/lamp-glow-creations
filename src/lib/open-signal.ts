// What an application link's Opened and Started really mean (Asad, 2026-11-25). The merchant's
// own visits are counted apart from the rep's: a rep filling it in on the call, or a signed-in
// staff member checking the link, never counts as the merchant. No imports, so the tests can
// load it.

export type Device = "phone" | "tablet" | "computer";

/**
 * Link checkers that open every link in an email before the person does: security scanners,
 * preview fetchers and headless browsers. Their visits aren't the merchant's.
 */
export function isScanner(agent: string | null | undefined): boolean {
  const a = (agent ?? "").toLowerCase();
  if (!a.trim()) return true;
  return /bot|crawl|spider|slurp|preview|scanner|headless|phantom|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|proofpoint|mimecast|barracuda|safelinks|urldefense/.test(
    a,
  );
}

/** Phone, tablet or computer, from the browser's own description of itself. Nothing else is kept. */
export function deviceOf(agent: string | null | undefined): Device | null {
  const a = agent ?? "";
  if (isScanner(a)) return null;
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(a)) return "tablet";
  if (/iPhone|iPod|Android.*Mobile|Mobile|BlackBerry|IEMobile|Opera Mini/i.test(a)) return "phone";
  return "computer";
}

export type OpenFacts = {
  rep_filled_at?: string | null;
  merchant_opened_at?: string | null;
  merchant_last_opened_at?: string | null;
  merchant_open_count?: number | null;
  merchant_started_at?: string | null;
  merchant_device?: string | null;
};

/** True once the database keeps the merchant's own visits (the 20261125130000 SQL ran). */
export const tracksMerchant = (r: OpenFacts) => r.merchant_open_count !== undefined;

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 60) return m <= 1 ? "just now" : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const ON: Record<Device, string> = {
  phone: "on a phone",
  tablet: "on a tablet",
  computer: "on a computer",
};

/**
 * The lines under a link's status, in plain words: what the rep did, then what the merchant did.
 * Empty before the SQL runs, so the old status shows alone.
 */
export function openLines(r: OpenFacts, now = Date.now()): string[] {
  if (!tracksMerchant(r)) return [];
  const out: string[] = [];
  if (r.rep_filled_at) out.push("Filled in by the rep on the call.");
  const n = r.merchant_open_count ?? 0;
  if (n > 0 && r.merchant_last_opened_at) {
    const times = n === 1 ? "once" : `${n} times`;
    const where =
      r.merchant_device && r.merchant_device in ON ? ` ${ON[r.merchant_device as Device]}` : "";
    out.push(`They opened it ${times}, last ${ago(r.merchant_last_opened_at, now)}${where}.`);
  } else if (r.merchant_opened_at) {
    out.push(`They opened it ${ago(r.merchant_opened_at, now)}.`);
  } else {
    out.push("No open by them recorded.");
  }
  if (r.merchant_started_at) out.push("They typed answers themselves.");
  return out;
}
