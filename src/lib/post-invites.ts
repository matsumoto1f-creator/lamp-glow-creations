import { getSupabase } from "@/lib/supabase";
import { logActivity } from "@/lib/track";
import type { SendRequest, SendResult } from "@/lib/application-links";

/** POST /api/application-invites as the signed-in staff member. Throws with the server's words. */
export async function postInvites(body: SendRequest): Promise<SendResult[]> {
  const sb = getSupabase();
  const session = sb ? (await sb.auth.getSession()).data.session : null;
  if (!session) throw new Error("Sign in again to send.");
  const res = await fetch("/api/application-invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { results?: SendResult[]; error?: string };
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  void logActivity("send_application", { detail: `${(data.results ?? []).length} links` });
  return data.results ?? [];
}
