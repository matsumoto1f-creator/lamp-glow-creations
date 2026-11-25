import { getSupabase } from "@/lib/supabase";

/**
 * Headers for the application page's open and start calls. When this browser is signed in to
 * Lamp, the session goes along, so a rep checking a link or filling it in on the call isn't
 * counted as the merchant opening it (Asad, 2026-11-25). A merchant's browser has no staff session.
 */
export async function visitHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch {
    // no session to send: the visit is counted as the merchant's
  }
  return headers;
}
