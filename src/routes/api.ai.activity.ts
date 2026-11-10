import { createFileRoute } from "@tanstack/react-router";

// GET: what Claude did in Lamp this month and what it cost (admins only).
export const Route = createFileRoute("/api/ai/activity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { aiActivity } = await import("@/lib/ai-activity.server");
        return aiActivity(request);
      },
    },
  },
});
