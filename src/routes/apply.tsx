import { createFileRoute, redirect } from "@tanstack/react-router";
import { carriedSearch } from "@/lib/apply";

// /apply was the quick-questions page that ended in making an account (where most people
// stopped). Since 2026-11-19 the website's application is getlamp.app/application: the same
// quick questions, then the full application. Every "Check my options" button and any old link
// or ad still pointing here is sent on, with its quick answers and utm_ tags.
export const Route = createFileRoute("/apply")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/application", search: carriedSearch(search), replace: true });
  },
  validateSearch: (search: Record<string, unknown>) => search,
});
