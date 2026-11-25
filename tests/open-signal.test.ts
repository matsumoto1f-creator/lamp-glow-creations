// deno test --node-modules-dir=none tests/open-signal.test.ts
//
// 2026-11-25, Asad: "if i seen they opened/started the application how true is this signal do we
// know the ip address to verify it was the recipient". GAUDIOSO CONTRACTING showed Started because
// the rep filled it in on the call. Opened and Started now mean the merchant's own browser.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { deviceOf, isScanner, openLines, tracksMerchant } from "../src/lib/open-signal.ts";
import server from "../src/lib/application-links.server.ts" with { type: "text" };
import paper from "../src/components/application/paper-application.tsx" with { type: "text" };
import link from "../src/components/application/link-application.tsx" with { type: "text" };
import visit from "../src/lib/visit-headers.ts" with { type: "text" };
import sent from "../src/components/staff/sent-applications.tsx" with { type: "text" };
import sql from "../supabase/migrations/20261125130000_merchant_opens.sql" with { type: "text" };

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

Deno.test("device: phone, tablet or computer from the browser", () => {
  assertEquals(deviceOf(IPHONE), "phone");
  assertEquals(deviceOf(ANDROID_PHONE), "phone");
  assertEquals(deviceOf(ANDROID_TABLET), "tablet");
  assertEquals(deviceOf(IPAD), "tablet");
  assertEquals(deviceOf(MAC), "computer");
});

Deno.test("scanners: link checkers and empty agents aren't the merchant", () => {
  for (const a of [
    "",
    null,
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Mozilla/5.0 HeadlessChrome/120.0",
    "python-requests/2.31",
    "curl/8.4",
    "Proofpoint URL Defense",
    "Mimecast",
  ])
    assert(isScanner(a), String(a));
  assert(!isScanner(IPHONE) && !isScanner(MAC));
  assertEquals(deviceOf("Mozilla/5.0 (compatible; bingbot/2.0)"), null);
});

const NOW = Date.parse("2026-11-25T15:00:00Z");

Deno.test("lines: before the SQL runs there are none, so the old status shows alone", () => {
  assert(!tracksMerchant({}));
  assertEquals(openLines({}, NOW), []);
});

Deno.test("lines: a link the rep filled in and the merchant never opened says so", () => {
  const r = {
    rep_filled_at: "2026-11-21T14:00:00Z",
    merchant_open_count: 0,
    merchant_opened_at: null,
  };
  assertEquals(openLines(r, NOW), [
    "Filled in by the rep on the call.",
    "No open by them recorded.",
  ]);
});

Deno.test("lines: the merchant's opens, how many, when last and on what", () => {
  const r = {
    rep_filled_at: null,
    merchant_open_count: 3,
    merchant_opened_at: "2026-11-24T10:00:00Z",
    merchant_last_opened_at: "2026-11-25T13:00:00Z",
    merchant_device: "phone",
    merchant_started_at: "2026-11-25T13:02:00Z",
  };
  assertEquals(openLines(r, NOW), [
    "They opened it 3 times, last 2h ago on a phone.",
    "They typed answers themselves.",
  ]);
  assertEquals(
    openLines(
      { ...r, merchant_open_count: 1, merchant_started_at: null, merchant_device: null },
      NOW,
    ),
    ["They opened it once, last 2h ago."],
  );
});

Deno.test("server: a staff visit or a scanner doesn't mark a link opened or started", () => {
  const open = server.slice(server.indexOf("export async function openApplication"));
  assert(
    open.includes("const merchant = !isScanner(agent) && !(await isStaffVisit(request, svc));"),
  );
  assert(open.includes("if (merchant) {"));
  // the old stamps sit inside that guard
  const guarded = open.slice(
    open.indexOf("if (merchant) {"),
    open.indexOf('"note_merchant_open" as never'),
  );
  assert(guarded.includes("started_at: now") && guarded.includes("opened_at: now"));
  assert(server.includes('x.role === "rep" || x.role === "admin"'));
});

Deno.test("server: every merchant visit is counted, and a missing function changes nothing", () => {
  assert(server.includes('"note_merchant_open" as never,'));
  assert(server.includes("_device: deviceOf(agent)"));
  assert(/\.then\(\s*\(\) => undefined,\s*\(\) => undefined,\s*\)/.test(server));
});

Deno.test("pages: the open and start calls carry the staff session when there is one", () => {
  for (const page of [paper, link]) {
    assert(page.includes("headers: await visitHeaders(),"));
    assert(page.includes("void visitHeaders()"));
    assert(
      !page.includes(
        'headers: { "Content-Type": "application/json" },\n          body: JSON.stringify(token ? { token } : { rep: repSlug }),',
      ),
    );
  }
  assert(visit.includes('headers["Authorization"] = `Bearer ${token}`'));
});

Deno.test(
  "applications: Opened and Started come from the merchant's own visits once tracked",
  () => {
    assert(sent.includes('if (r.merchant_started_at) return "started";'));
    assert(sent.includes('if (r.merchant_opened_at) return "opened";'));
    assert(sent.includes('if (r.rep_filled_at) return "filled";'));
    assert(sent.includes('filled: "Filled in on the call",'));
    // the list still loads before the SQL runs
    assert(sent.includes('if (err && (err.code === "42703" || err.code === "PGRST204"))'));
  },
);

Deno.test(
  "database: no IP kept, scanners' device never stored, the counter is the server's alone",
  () => {
    assert(!/\bip\b/i.test(sql.replace(/No IP address is kept/g, "").replace(/-- .*$/gm, "")));
    assert(
      sql.includes(
        "check (merchant_device is null or merchant_device in ('phone', 'tablet', 'computer'))",
      ),
    );
    assert(
      sql.includes(
        "revoke all on function public.note_merchant_open(uuid, text, boolean) from public, anon, authenticated;",
      ),
    );
    assert(sql.includes("add column if not exists merchant_open_count integer not null default 0"));
  },
);

Deno.test("database: history keeps old stamps only where no rep filled the link in", () => {
  assert(
    sql.includes(
      "set rep_filled_at = least(started_at, draft_saved_at)\n     where draft_by is not null;",
    ),
  );
  assert(sql.includes("merchant_started_at = started_at\n     where draft_by is null;"));
  // the backfill runs once
  assert(sql.includes("if not exists (select 1 from public.application_invites"));
});
