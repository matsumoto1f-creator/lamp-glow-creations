import { createFileRoute } from "@tanstack/react-router";

// POST: a signed-in Lamp staff member finishes /lamp link, so their alerts reach their Discord DMs.
export const Route = createFileRoute("/api/discord/link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { discordLink } = await import("@/lib/discord.server");
        return discordLink(request);
      },
    },
  },
});
