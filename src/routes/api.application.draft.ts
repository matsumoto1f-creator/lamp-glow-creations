import { createFileRoute } from "@tanstack/react-router";

// POST: Start application. A rep filling in a merchant's personal link with them on the phone
// saves the answers on the link (never an SSN or date of birth), or emails that same link to the
// merchant to check and sign. Signed-in staff only, for their own links.
export const Route = createFileRoute("/api/application/draft")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { applicationDraft } = await import("@/lib/application-links.server");
        return applicationDraft(request);
      },
    },
  },
});
