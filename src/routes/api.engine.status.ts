import { createFileRoute } from "@tanstack/react-router";

// The War Room email autopilot: POST its status after every scheduled run (shared secret); admins
// GET it for Staff > Email engine (see src/lib/engine-status.server.ts).
export const Route = createFileRoute("/api/engine/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { saveStatus } = await import("@/lib/engine-status.server");
        return saveStatus(request);
      },
      GET: async ({ request }) => {
        const { readStatus } = await import("@/lib/engine-status.server");
        return readStatus(request);
      },
    },
  },
});
