import { createFileRoute } from "@tanstack/react-router";

// The War Room engine's daily hand-out, with the shared secret: GET who can take leads,
// POST each rep's leads for the day into Engine leads (see src/lib/engine-push.server.ts).
export const Route = createFileRoute("/api/engine/push")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { pushStatus } = await import("@/lib/engine-push.server");
        return pushStatus(request);
      },
      POST: async ({ request }) => {
        const { pushLeads } = await import("@/lib/engine-push.server");
        return pushLeads(request);
      },
    },
  },
});
