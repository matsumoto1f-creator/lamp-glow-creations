import { createFileRoute } from "@tanstack/react-router";

// POST { action: "unsubscribe", token } from a reminder's stop link, or { action: "stop", kind, id }
// from a rep or admin. See remindersAction in finish-reminders.server.ts.
export const Route = createFileRoute("/api/application/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { remindersAction } = await import("@/lib/finish-reminders.server");
        return remindersAction(request);
      },
    },
  },
});
