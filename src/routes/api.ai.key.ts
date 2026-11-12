import { createFileRoute } from "@tanstack/react-router";

// POST: save or remove Lamp's Anthropic key (admins only). The key is never sent back.
export const Route = createFileRoute("/api/ai/key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { aiKeyAction } = await import("@/lib/ai-key.server");
        return aiKeyAction(request);
      },
    },
  },
});
