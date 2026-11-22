// The reminders' shared secret (the Vault's finish_remind_secret, 20261120090000_finish_reminders.sql):
// the database sends it with each tick, and the site signs and checks reminder links and stop
// links with it. Read once and kept for ten minutes. Never import this from browser code.
import type { service } from "@/lib/funder-send.server";

type Svc = ReturnType<typeof service>;

let cached: { value: string; at: number } | null = null;

/** The secret, or "" when the database step hasn't run (then there are no reminders at all). */
export async function remindSecret(svc: Svc): Promise<string> {
  if (cached && Date.now() - cached.at < 600_000) return cached.value;
  const r = await svc.rpc("finish_remind_secret" as never);
  const value = typeof r.data === "string" ? r.data : "";
  if (value) cached = { value, at: Date.now() };
  return value;
}
