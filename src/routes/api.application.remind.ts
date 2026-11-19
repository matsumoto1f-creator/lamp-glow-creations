import { createFileRoute } from "@tanstack/react-router";

// POST: the database (finish_remind_tick() every 10 minutes, or another scheduler with the
// reminder secret) asks for the "finish your application" reminders that are due. See
// finish-reminders.server.ts.
export const Route = createFileRoute("/api/application/remind")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { finishReminders } = await import("@/lib/finish-reminders.server");
        return finishReminders(request);
      },
    },
  },
});
