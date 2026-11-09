import { createFileRoute } from "@tanstack/react-router";

// POST: the database (or another scheduler with the nudge secret) asks for the merchant email nudges: a Lamp reply unread for 15 minutes gets one email with a link, never the message.
export const Route = createFileRoute("/api/chat/nudge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { chatNudge } = await import("@/lib/chat-nudge.server");
        return chatNudge(request);
      },
    },
  },
});
