// Copies a file's documents into the company Google Drive (getlamp.app), signed in as the
// partners@ mailbox with Drive's "files this app creates" permission (drive.file), so Lamp only
// ever sees the folders it made. "Lamp files" / one folder per file / one copy per document.
// What is already copied is remembered in drive_folders and drive_copies
// (20261119170000_drive_copies.sql). A copy failing never stops anything else in Lamp.
// Never import this from browser code.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  caller,
  env,
  json,
  mayWork,
  MAILBOX,
  service,
  SUPABASE_URL,
} from "@/lib/funder-send.server";
import {
  copyName,
  driveAllowed,
  folderName,
  folderUrl,
  ROOT_FOLDER_NAME,
  type DriveState,
} from "@/lib/drive";

const DRIVE = () => env("GOOGLE_DRIVE_API_URL") || "https://www.googleapis.com/drive/v3";
const UPLOAD = () => env("GOOGLE_DRIVE_UPLOAD_URL") || "https://www.googleapis.com/upload/drive/v3";
const TOKEN_URL = () => env("GOOGLE_TOKEN_URL") || "https://oauth2.googleapis.com/token";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Documents copied per call, so one request stays short; the rest go on the next open. */
const PER_CALL = 8;

type Doc = {
  id: string;
  kind: string;
  bucket: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
};

const off = (reason: string): DriveState => ({ state: "off", reason });

/** An access token for partners@ with Drive allowed, or why there isn't one. */
async function driveToken(svc: SupabaseClient): Promise<{ token: string } | { reason: string }> {
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET"))
    return { reason: "Google isn't set up on the server." };
  const conn = await svc
    .from("mailer_connections" as never)
    .select("refresh_token,scope")
    .eq("mailbox", MAILBOX())
    .maybeSingle();
  const row = conn.data as { refresh_token?: string; scope?: string | null } | null;
  if (conn.error || !row?.refresh_token)
    return { reason: `Connect ${MAILBOX()} first (Funders page, admin).` };
  if (!driveAllowed(row.scope))
    return {
      reason: `Drive isn't allowed yet: an admin reconnects ${MAILBOX()} on the Funders page and allows Drive.`,
    };
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok)
    return { reason: `Google refused the connection (${res.status}). Reconnect ${MAILBOX()}.` };
  const t = (await res.json()) as { access_token?: string };
  return t.access_token ? { token: t.access_token } : { reason: "Google sent no access token." };
}

/** Why Google said no, in a line a person can act on. */
async function googleProblem(res: Response, what: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (/accessNotConfigured|has not been used|is disabled/i.test(text))
    return "The Google Drive API is switched off for Lamp's Google project. Turn it on in Google Cloud (APIs & Services > Library > Google Drive API).";
  if (res.status === 403 && /storageQuotaExceeded/i.test(text)) return "The Drive is full.";
  return `Google said no to ${what} (${res.status}).`;
}

async function createFolder(token: string, name: string, parent: string | null) {
  const res = await fetch(`${DRIVE()}/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    }),
  });
  if (!res.ok) return { error: await googleProblem(res, "making a folder") };
  const j = (await res.json()) as { id?: string };
  return j.id ? { id: j.id } : { error: "Google made no folder." };
}

/** Is a folder Lamp made still there (not deleted or trashed)? */
async function folderAlive(token: string, id: string): Promise<boolean> {
  const res = await fetch(
    `${DRIVE()}/files/${encodeURIComponent(id)}?fields=trashed&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return false;
  return !((await res.json()) as { trashed?: boolean }).trashed;
}

/** The folder for a key ('root' or 'app:<id>'), made once and remembered. */
async function folderFor(
  svc: SupabaseClient,
  token: string,
  key: string,
  name: string,
  parent: string | null,
): Promise<{ id: string } | { error: string }> {
  const had = await svc
    .from("drive_folders" as never)
    .select("folder_id")
    .eq("key", key)
    .maybeSingle();
  if (had.error)
    return { error: "Drive copies aren't switched on yet: the database step hasn't been run." };
  const known = (had.data as { folder_id?: string } | null)?.folder_id;
  if (known && (await folderAlive(token, known))) return { id: known };
  const made = await createFolder(token, name, parent);
  if ("error" in made) return made;
  await svc.from("drive_folders" as never).upsert({ key, folder_id: made.id } as never);
  return made;
}

/** One document into a folder, by Drive's resumable upload (works for every size we take). */
async function copyOne(svc: SupabaseClient, token: string, folder: string, d: Doc) {
  const file = await svc.storage.from(d.bucket || "documents").download(d.storage_path);
  if (file.error || !file.data) return { error: `Couldn't read ${copyName(d)} from storage.` };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const type = d.mime_type || file.data.type || "application/octet-stream";
  const start = await fetch(
    `${UPLOAD()}/files?uploadType=resumable&supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": type,
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify({ name: copyName(d), parents: [folder] }),
    },
  );
  const where = start.headers.get("location");
  if (!start.ok || !where) return { error: await googleProblem(start, "starting a copy") };
  const put = await fetch(where, {
    method: "PUT",
    headers: { "Content-Type": type, "Content-Length": String(bytes.length) },
    body: bytes,
  });
  if (!put.ok) return { error: await googleProblem(put, "copying a file") };
  const j = (await put.json()) as { id?: string };
  if (!j.id) return { error: "Google kept no copy." };
  await svc
    .from("drive_copies" as never)
    .upsert({ document_id: d.id, drive_file_id: j.id } as never);
  return { id: j.id };
}

/**
 * Copy a file's documents that aren't in Drive yet (a few per call). Returns where the folder is
 * and how many are left, or why it is off. Safe to call as often as a file is opened.
 */
export async function syncApplication(svc: SupabaseClient, appId: string): Promise<DriveState> {
  const t = await driveToken(svc);
  if ("reason" in t) return off(t.reason);
  const app = await svc
    .from("applications")
    .select("id,business_name,first_name")
    .eq("id", appId)
    .maybeSingle();
  if (app.error || !app.data) return off("We couldn't find that file.");
  const root = await folderFor(
    svc,
    t.token,
    "root",
    ROOT_FOLDER_NAME,
    env("DRIVE_ROOT_FOLDER_ID") || null,
  );
  if ("error" in root) return off(root.error);
  const folder = await folderFor(
    svc,
    t.token,
    `app:${appId}`,
    folderName(app.data as { id: string; business_name: string | null; first_name: string | null }),
    root.id,
  );
  if ("error" in folder) return off(folder.error);

  const [docs, done] = await Promise.all([
    svc
      .from("documents")
      .select("id,kind,bucket,storage_path,original_name,mime_type")
      .eq("application_id", appId)
      .order("created_at"),
    svc.from("drive_copies" as never).select("document_id"),
  ]);
  if (docs.error || done.error) return off("Couldn't read the file's documents. Try again.");
  const copied = new Set(
    ((done.data ?? []) as { document_id: string }[]).map((r) => r.document_id),
  );
  const todo = ((docs.data ?? []) as Doc[]).filter((d) => !copied.has(d.id));
  let n = 0;
  for (const d of todo.slice(0, PER_CALL)) {
    const r = await copyOne(svc, t.token, folder.id, d);
    if ("error" in r) return off(r.error);
    n++;
  }
  return {
    state: "copied",
    folder_url: folderUrl(folder.id),
    copied: copied.size + n,
    left: todo.length - n,
  };
}

/** POST /api/drive { application_id }: copy what's new and say where the folder is. */
export async function driveAction(request: Request): Promise<Response> {
  if (!SUPABASE_URL()) return json(500, { error: "The server is missing its database settings." });
  const who = await caller(request);
  if (!who) return json(401, { error: "Sign in first." });
  let body: { application_id?: unknown };
  try {
    body = (await request.json()) as { application_id?: unknown };
  } catch {
    return json(400, { error: "Send JSON." });
  }
  const appId = typeof body.application_id === "string" ? body.application_id : "";
  if (!UUID.test(appId)) return json(400, { error: "application_id is required." });
  // the file's rep or an admin: the same people who open its documents and send it to funders
  if (!(await mayWork(who, appId)))
    return json(403, { error: "Only the file's rep or an admin can copy it to Drive." });
  return json(200, await syncApplication(service(), appId));
}
