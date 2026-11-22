import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { postAsMe } from "@/lib/server-api";
import type { DriveState } from "@/lib/drive";

/**
 * On a file's Documents: copies any new documents into the company Google Drive when the file is
 * opened (or a document is added), and links to the file's Drive folder. Says plainly why not
 * when Drive isn't connected yet. Only shown to people who work the file.
 */
export function DriveLink({ fileId, docCount }: { fileId: string; docCount: number }) {
  const [s, setS] = useState<DriveState | { state: "busy" } | null>(null);
  useEffect(() => {
    let live = true;
    setS({ state: "busy" });
    postAsMe<DriveState>("/api/drive", { application_id: fileId })
      .then((r) => {
        if (!live) return;
        if (r.ok && (r.data.state === "copied" || r.data.state === "off"))
          setS(r.data as DriveState);
        else setS({ state: "off", reason: r.data.error ?? "Couldn't reach Drive." });
      })
      .catch(() => live && setS({ state: "off", reason: "Couldn't reach Drive." }));
    return () => {
      live = false;
    };
  }, [fileId, docCount]);

  if (!s) return null;
  return (
    <p
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-smoke"
      data-drive={s.state}
    >
      <span className="font-semibold uppercase tracking-wide">Google Drive</span>
      {s.state === "busy" ? (
        <span className="inline-flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" /> Checking…
        </span>
      ) : s.state === "copied" ? (
        <>
          <span>
            {s.copied} {s.copied === 1 ? "document" : "documents"} copied
            {s.left > 0 && `, ${s.left} more on the next open`}
          </span>
          <a
            href={s.folder_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-forest hover:underline"
            data-drive-folder
          >
            Open the folder <ExternalLink className="size-3" />
          </a>
        </>
      ) : (
        <span>{s.reason}</span>
      )}
    </p>
  );
}
