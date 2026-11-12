import { createFileRoute } from "@tanstack/react-router";

// The War Room engine's reply check, with the shared secret: POST each answer to a Lamp email,
// so it lands in Staff > Email replies and the sender and every admin are notified
// (see src/lib/email-replies.server.ts).
export const Route = createFileRoute("/api/engine/reply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { saveReplies } = await import("@/lib/email-replies.server");
        return saveReplies(request);
      },
    },
  },
});
