// Start application: what a rep's phone draft may keep on Lamp's server. No imports, so the
// deno tests load it directly.

/** The answers without anything that must never sit on a draft: SSNs and dates of birth. */
export function safeDraft(draft: unknown): Record<string, unknown> | null {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  const d = { ...(draft as Record<string, unknown>) };
  if (Array.isArray(d["owners"]))
    d["owners"] = (d["owners"] as unknown[]).map((o) =>
      o && typeof o === "object" ? { ...(o as Record<string, unknown>), ssn: "", dob: "" } : o,
    );
  return d;
}
