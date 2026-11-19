import { createFileRoute } from "@tanstack/react-router";

// POST { application_id }: copy a file's new documents into the company Google Drive and say
// where its folder is. The file's rep or an admin; see drive.server.ts.
export const Route = createFileRoute("/api/drive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { driveAction } = await import("@/lib/drive.server");
        return driveAction(request);
      },
    },
  },
});
