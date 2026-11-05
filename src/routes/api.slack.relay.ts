import { createFileRoute } from "@tanstack/react-router";

// POST: the database hands over each new notification (by id, with the relay secret from its
// Vault); the person gets it as a Slack DM and deal events go to the team channel.
export const Route = createFileRoute("/api/slack/relay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { slackRelay } = await import("@/lib/slack.server");
        return slackRelay(request);
      },
    },
  },
});
