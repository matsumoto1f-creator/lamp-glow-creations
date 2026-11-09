import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { markStaffBrowser } from "@/lib/track";
import { useAuth } from "@/hooks/use-auth";
import { seo } from "@/lib/site";
import { isStage, useStaffAccess, type Stage } from "@/lib/staff";
import { PageShell } from "@/components/site/layout";
import { Board } from "@/components/staff/board";
import { FileView } from "@/components/staff/file-view";
import { EngineLeads } from "@/components/staff/engine-leads";
import { MyCalls } from "@/components/staff/notes-calls";
import { Today } from "@/components/staff/today";
import { LeadProfile } from "@/components/staff/lead-profile";
import { SentApplications } from "@/components/staff/sent-applications";
import { Funders } from "@/components/staff/funders";
import { Money } from "@/components/staff/money";
import { Dashboard } from "@/components/staff/dashboard";
import { Team } from "@/components/staff/team";
import { NotificationsBell } from "@/components/staff/notifications";
import { AppLinks } from "@/components/staff/app-links";
import { Training } from "@/components/staff/training";
import { Messages } from "@/components/chat/messages";
import { useChatUnread } from "@/hooks/use-chat-unread";

type StaffSearch = {
  view?: View | undefined;
  stage?: Stage | undefined;
  rep?: string | undefined;
  file?: string | undefined;
  lead?: string | undefined;
  thread?: string | undefined;
};

type View =
  "messages" | "dashboard" | "engine" | "sent" | "funders" | "money" | "team" | "training";
const VIEWS: readonly View[] = [
  "messages",
  "dashboard",
  "engine",
  "sent",
  "funders",
  "money",
  "team",
  "training",
];
/** Tabs only admins see. */
const ADMIN_VIEWS: readonly View[] = ["team"];
const VIEW_TITLE: Record<View, string> = {
  messages: "Messages",
  dashboard: "Dashboard",
  engine: "Engine leads",
  sent: "Applications",
  funders: "Funders",
  money: "Money",
  team: "Team",
  training: "Training",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const Route = createFileRoute("/staff")({
  validateSearch: (s: Record<string, unknown>): StaffSearch => ({
    view: VIEWS.includes(s["view"] as View) ? (s["view"] as View) : undefined,
    stage: isStage(s["stage"]) ? s["stage"] : undefined,
    rep:
      typeof s["rep"] === "string" && (s["rep"] === "unassigned" || SLUG.test(s["rep"]))
        ? s["rep"]
        : undefined,
    file: typeof s["file"] === "string" && UUID.test(s["file"]) ? s["file"] : undefined,
    lead: typeof s["lead"] === "string" && UUID.test(s["lead"]) ? s["lead"] : undefined,
    thread: typeof s["thread"] === "string" && UUID.test(s["thread"]) ? s["thread"] : undefined,
  }),
  head: () =>
    seo({
      path: "/staff",
      title: "Staff — Lamp",
      description: "Lamp staff files.",
      noindex: true,
    }),
  component: Staff,
});

function Staff() {
  const { user, loading } = useAuth();
  const access = useStaffAccess(user?.id ?? null, loading);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/staff" });
  const [reps, setReps] = useState<{ slug: string; name: string; admin_slug: string | null }[]>([]);
  const [repsTick, setRepsTick] = useState(0);

  const isStaff = access.state === "staff";
  const chatUnread = useChatUnread(isStaff);
  useEffect(() => {
    // staff browsing the site shouldn't count as visitors
    if (isStaff) markStaffBrowser();
  }, [isStaff]);
  useEffect(() => {
    const sb = getSupabase();
    if (!sb || !isStaff) return;
    sb.from("reps")
      .select("slug,name,admin_slug")
      .order("name")
      .then(({ data }) => setReps(data ?? []));
  }, [isStaff, repsTick]);

  if (access.state === "loading") {
    return (
      <PageShell member wide footer={false} tone="night">
        <div className="grid place-items-center py-40">
          <Loader2 className="size-6 animate-spin text-smoke" />
        </div>
      </PageShell>
    );
  }

  if (access.state !== "staff") {
    return (
      <PageShell member wide footer={false} tone="night">
        <div className="mx-auto max-w-xl px-5 py-24 text-center" data-staff-gate={access.state}>
          <h1 className="font-display text-2xl font-bold">Staff only</h1>
          <p className="mt-2 text-smoke">
            {access.state === "error" ? access.message : "This page is for the Lamp team."}
          </p>
          {access.state === "signed_out" && (
            <Link to="/login" className="mt-6 inline-block font-semibold text-forest">
              Sign in
            </Link>
          )}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell member wide footer={false} tone="night">
      <div className="w-full px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-smoke">
              {user?.email} · {access.isAdmin ? "Admin" : "Rep"}
              {access.repSlug && ` · /${access.repSlug}`}
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {search.lead ? "Lead" : search.view ? VIEW_TITLE[search.view] : "Files"}
            </h1>
          </div>
          <NotificationsBell chatUnread={chatUnread} />
        </div>
        {!search.file && !search.lead && (
          <nav
            className={
              // on a phone one row that scrolls sideways; hidden while a conversation is open
              "-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 text-sm [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" +
              (search.thread ? " max-lg:hidden" : "")
            }
            aria-label="Staff views"
          >
            <Link to="/staff" search={{}} className={viewTab(!search.view)} data-staff-view="files">
              Files
            </Link>
            {VIEWS.filter((v) => access.isAdmin || !ADMIN_VIEWS.includes(v)).map((v) => (
              <Link
                key={v}
                to="/staff"
                search={{ view: v }}
                className={viewTab(search.view === v)}
                data-staff-view={v}
              >
                {VIEW_TITLE[v]}
                {v === "messages" && chatUnread > 0 && (
                  <span
                    className="ml-1.5 rounded-full bg-leaf px-1.5 text-xs text-ink"
                    aria-label={`${chatUnread} unread`}
                  >
                    {chatUnread}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        )}
        {!search.file && !search.lead && !search.view && (
          <AppLinks isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        )}
        {search.lead ? (
          <LeadProfile
            leadId={search.lead}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : search.file ? (
          <FileView
            fileId={search.file}
            userId={access.userId}
            isAdmin={access.isAdmin}
            repSlug={access.repSlug}
            reps={reps}
          />
        ) : search.view === "messages" ? (
          <Messages
            userId={access.userId}
            isAdmin={access.isAdmin}
            thread={search.thread}
            onThread={(thread) => navigate({ search: (s) => ({ ...s, thread }) })}
          />
        ) : search.view === "dashboard" ? (
          <Dashboard isAdmin={access.isAdmin} repSlug={access.repSlug} />
        ) : search.view === "engine" ? (
          <EngineLeads isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : search.view === "sent" ? (
          <SentApplications isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
        ) : search.view === "funders" ? (
          <Funders isAdmin={access.isAdmin} />
        ) : search.view === "money" ? (
          <Money isAdmin={access.isAdmin} userId={access.userId} reps={reps} />
        ) : search.view === "training" ? (
          <Training isAdmin={access.isAdmin} />
        ) : search.view === "team" ? (
          access.isAdmin ? (
            <Team onChanged={() => setRepsTick((t) => t + 1)} />
          ) : (
            <p className="mt-8 text-sm text-smoke">Only admins manage the team.</p>
          )
        ) : (
          <>
            <Today isAdmin={access.isAdmin} reps={reps} />
            <MyCalls isAdmin={access.isAdmin} repSlug={access.repSlug} reps={reps} />
            <Board
              isAdmin={access.isAdmin}
              repSlug={access.repSlug}
              stage={search.stage}
              rep={access.isAdmin ? (search.rep ?? "all") : "all"}
              reps={reps}
              onStage={(stage) => navigate({ search: (s) => ({ ...s, stage }) })}
              onRep={(rep) =>
                navigate({ search: (s) => ({ ...s, rep: rep === "all" ? undefined : rep }) })
              }
            />
          </>
        )}
      </div>
    </PageShell>
  );
}

const viewTab = (on: boolean) =>
  on
    ? "shrink-0 whitespace-nowrap rounded-full bg-ink px-4 py-1.5 font-semibold text-white"
    : "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 font-semibold text-smoke ring-1 ring-line hover:text-ink";
