// The company Google Drive copy of each file's documents (drive.server.ts does the work).
// Plain rules shared by the server, the page and the tests; no network calls here.
import { DOCUMENT_LABELS, isDocumentKind } from "./documents.ts";

/** The permission that lets Lamp make and fill only its own folders; it sees nothing else. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const ROOT_FOLDER_NAME = "Lamp files";

/** Did the partners@ connection grant Drive? (Older connections asked for Gmail only.) */
export const driveAllowed = (scope: string | null | undefined) =>
  (scope ?? "").split(/\s+/).includes(DRIVE_SCOPE);

const tidy = (s: string) =>
  [...s]
    // control characters and the ones Drive or a download would trip over become spaces
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** "Vella Interiors, Inc. (1a2b3c4d)": the business, else the person, and a short id so two
 *  files for the same business never share a folder. */
export function folderName(app: {
  id: string;
  business_name: string | null;
  first_name: string | null;
}): string {
  const who = tidy(app.business_name ?? "") || tidy(app.first_name ?? "") || "File";
  return `${who.slice(0, 80)} (${app.id.slice(0, 8)})`;
}

/** "Bank statement - march.pdf": what it is, then its own name. */
export function copyName(doc: {
  kind: string;
  original_name: string | null;
  storage_path: string;
}) {
  const label = isDocumentKind(doc.kind) ? DOCUMENT_LABELS[doc.kind] : "Document";
  const short = label.replace(/^Business bank statement$/, "Bank statement");
  const own =
    tidy(doc.original_name ?? "") ||
    tidy(doc.storage_path.slice(doc.storage_path.lastIndexOf("/") + 1).replace(/^\d+-/, "")) ||
    "file";
  return `${short} - ${own}`.slice(0, 200);
}

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** What the file page shows about its Drive copy. */
export type DriveState =
  | { state: "copied"; folder_url: string; copied: number; left: number }
  | { state: "off"; reason: string };
