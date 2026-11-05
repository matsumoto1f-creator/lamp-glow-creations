import { createFileRoute } from "@tanstack/react-router";

// POST: Discord's /lamp, signed with the app's key. Answers only the person who asked.
export const Route = createFileRoute("/api/discord/interactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { discordInteractions } = await import("@/lib/discord.server");
        return discordInteractions(request);
      },
    },
  },
});
