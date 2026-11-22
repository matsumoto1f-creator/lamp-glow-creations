import { createFileRoute } from "@tanstack/react-router";

// GET: the rep agreements in force and the caller's signatures (admins: drafts, everyone's
// signatures and the team). POST: sign one, or (admins) save, publish, discard or stop asking.
// See rep-documents.server.ts.
export const Route = createFileRoute("/api/rep-documents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { listRepDocuments } = await import("@/lib/rep-documents.server");
        return listRepDocuments(request);
      },
      POST: async ({ request }) => {
        const { changeRepDocuments } = await import("@/lib/rep-documents.server");
        return changeRepDocuments(request);
      },
    },
  },
});
