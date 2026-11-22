import { createFileRoute } from "@tanstack/react-router";

// POST: someone on the team adds a document to a file by hand (the file's rep or an admin).
// PDFs and photos only, checked on the server; see staffUploadDocument in documents.server.ts.
export const Route = createFileRoute("/api/documents/staff-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { staffUploadDocument } = await import("@/lib/documents.server");
        return staffUploadDocument(request);
      },
    },
  },
});
