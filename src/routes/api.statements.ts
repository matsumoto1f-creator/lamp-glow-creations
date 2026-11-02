import { createFileRoute } from "@tanstack/react-router";

// POST: the statement reader on a file (staff): get the report, read one statement, confirm.
export const Route = createFileRoute("/api/statements")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { statementsAction } = await import("@/lib/statement-read.server");
        return statementsAction(request);
      },
    },
  },
});
