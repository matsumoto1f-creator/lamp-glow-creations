import { createFileRoute, redirect } from "@tanstack/react-router";
import { carriedSearch } from "@/lib/apply";

// Old rep links, e.g. getlamp.app/apply/zeus. Since 2026-11-19 a rep's public link is
// getlamp.app/application/zeus (quick questions, then the full application, filed with that
// rep), so these go there with their quick answers and utm_ tags.
export const Route = createFileRoute("/apply_/$rep")({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: "/application/$rep",
      params: { rep: params.rep.toLowerCase() },
      search: carriedSearch(search),
      replace: true,
    });
  },
  validateSearch: (search: Record<string, unknown>) => search,
});
