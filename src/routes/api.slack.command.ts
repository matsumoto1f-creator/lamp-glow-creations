import { createFileRoute } from "@tanstack/react-router";

// POST: Slack's /lamp command, signed with the app's signing secret. Answers only the person who
// asked, about their own leads and files.
export const Route = createFileRoute("/api/slack/command")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { slackCommand } = await import("@/lib/slack.server");
        return slackCommand(request);
      },
    },
  },
});
