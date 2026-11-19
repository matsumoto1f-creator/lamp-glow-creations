import { createFileRoute } from "@tanstack/react-router";

// POST { application_id }: email a quick-form merchant to finish the full application on their
// account (the file's rep or an admin). See finishApplicationNudge in application-links.server.ts.
export const Route = createFileRoute("/api/application/finish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { finishApplicationNudge } = await import("@/lib/application-links.server");
        return finishApplicationNudge(request);
      },
    },
  },
});
