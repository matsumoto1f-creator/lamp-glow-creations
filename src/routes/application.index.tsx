import { createFileRoute } from "@tanstack/react-router";
import { seo } from "@/lib/site";
import { carriedSearch, quickFromParams } from "@/lib/apply";
import { LinkApplication } from "@/components/application/link-application";

// The website's own application (Asad, 2026-11-19): getlamp.app's "Check my options" lands here.
// A few quick questions, name and number (saved as a lead at once), a rough range, then the full
// application on the same page. No rep: the signed file lands unassigned, and staff see it came
// from the website. /apply sends people here; ?amount=50-100k and other quick answers skip those
// questions, and utm_ tags go on the lead.
export const Route = createFileRoute("/application/")({
  validateSearch: (s: Record<string, unknown>) => carriedSearch(s),
  head: () =>
    seo({
      path: "/application",
      title: "Check your options — Lamp",
      description:
        "Answer a few quick questions, see a rough range, and finish your application in about ten minutes. Checking has no effect on your credit.",
    }),
  component: WebsiteApplication,
});

function WebsiteApplication() {
  const search = Route.useSearch();
  return <LinkApplication repSlug="" token={null} prefill={quickFromParams(search)} />;
}
