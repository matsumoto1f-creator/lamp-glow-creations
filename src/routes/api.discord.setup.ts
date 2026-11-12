import { createFileRoute } from "@tanstack/react-router";

// POST: registers /lamp with Discord, once, after the bot token is set. Guarded by the engine's push secret.
export const Route = createFileRoute("/api/discord/setup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { discordSetup } = await import("@/lib/discord.server");
        return discordSetup(request);
      },
    },
  },
});
