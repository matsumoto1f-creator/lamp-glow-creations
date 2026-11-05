import { createFileRoute } from "@tanstack/react-router";

// POST: the database hands over each new notification by id, with the relay secret from its Vault; the person gets it as a Discord DM and deal events go to #deals.
export const Route = createFileRoute("/api/team/relay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { teamRelay } = await import("@/lib/discord.server");
        return teamRelay(request);
      },
    },
  },
});
