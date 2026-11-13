// deno test --node-modules-dir=none tests/team-lead.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  boardFilter,
  knownTeam,
  ownRow,
  roleLabel,
  teamOf,
  watching,
  workVerdict,
} from "../src/lib/team-lead.ts";

const REPS = [
  { slug: "asad", name: "Asad", admin_slug: "stevie" },
  { slug: "stevie", name: "Stevie Marshall", admin_slug: null },
  { slug: "zeus", name: "Zeus", admin_slug: "stevie" },
  { slug: "darrell", name: "Darrell Alston", admin_slug: "zeus" },
  { slug: "micheal", name: "Micheal Logan", admin_slug: "zeus" },
  { slug: "omar", name: "Omar" },
];

Deno.test("team: the reps who report to someone, and nobody for a rep with no team", () => {
  assertEquals(teamOf("zeus", REPS), ["darrell", "micheal"]);
  assertEquals(teamOf("stevie", REPS), ["asad", "zeus"]);
  assertEquals(teamOf("omar", REPS), []);
  assertEquals(teamOf(null, REPS), []);
});

Deno.test("team: the database's answer wins, and before its SQL runs nobody is a lead", () => {
  assertEquals(knownTeam(["darrell", "micheal"], REPS), ["darrell", "micheal"]);
  // the page hasn't loaded that rep (or the value isn't a slug): left out, never put in a filter
  assertEquals(knownTeam(["darrell", "ghost", "a,b", "x)or(1"], REPS), ["darrell"]);
  assertEquals(knownTeam([], REPS), []);
  assertEquals(knownTeam(null, REPS), []);
});

Deno.test("board: a rep with no team gets the filter they always had", () => {
  assertEquals(boardFilter("omar", [], "all"), { or: "rep_slug.eq.omar,rep_slug.is.null" });
  // a rep link picked in the address bar means nothing without a team
  assertEquals(boardFilter("omar", [], "zeus"), { or: "rep_slug.eq.omar,rep_slug.is.null" });
  assertEquals(boardFilter("omar", [], "unassigned"), { unassigned: true });
  // no rep seat and no team: the unassigned pool only
  assertEquals(boardFilter(null, [], "all"), { unassigned: true });
});

Deno.test("board: a lead sees their own, the team's and the pool, or one of them", () => {
  const team = ["darrell", "micheal"];
  assertEquals(boardFilter("zeus", team, "all"), {
    or: "rep_slug.in.(zeus,darrell,micheal),rep_slug.is.null",
  });
  assertEquals(boardFilter("zeus", team, "mine"), { rep: "zeus" });
  assertEquals(boardFilter("zeus", team, "darrell"), { rep: "darrell" });
  assertEquals(boardFilter("zeus", team, "unassigned"), { unassigned: true });
  // someone outside the team can't be picked: back to the whole team
  assertEquals(boardFilter("zeus", team, "omar"), {
    or: "rep_slug.in.(zeus,darrell,micheal),rep_slug.is.null",
  });
});

Deno.test("board: nothing that isn't a slug reaches the filter", () => {
  const f = boardFilter("zeus", ["darrell", "x),rep_slug.neq.(y", ""], "all");
  assertEquals(f, { or: "rep_slug.in.(zeus,darrell),rep_slug.is.null" });
  assertEquals(boardFilter("zeus)", ["darrell"], "all"), {
    or: "rep_slug.eq.darrell,rep_slug.is.null",
  });
});

Deno.test("watching: only someone who isn't an admin, on another rep's file", () => {
  assert(watching(false, "zeus", "darrell"));
  assert(!watching(false, "zeus", "zeus"));
  assert(!watching(false, "zeus", null));
  assert(!watching(true, "zeus", "darrell"));
  // no rep seat: any assigned file is someone else's
  assert(watching(false, null, "darrell"));
});

Deno.test("role label: admin, team lead, rep", () => {
  assertEquals(roleLabel(true, 0), "Admin");
  assertEquals(roleLabel(true, 4), "Admin");
  assertEquals(roleLabel(false, 4), "Team lead");
  assertEquals(roleLabel(false, 0), "Rep");
});

Deno.test(
  "server: may-work reads the database's answer, and falls back only before its SQL",
  () => {
    assertEquals(workVerdict({ data: true, error: null }), "yes");
    assertEquals(workVerdict({ data: false, error: null }), "no");
    assertEquals(workVerdict({ data: null, error: null }), "no");
    assertEquals(workVerdict({ data: "true", error: null }), "no");
    // the function isn't there yet (PostgREST, or Postgres itself): the old test applies
    assertEquals(workVerdict({ data: null, error: { code: "PGRST202" } }), "old");
    assertEquals(workVerdict({ data: null, error: { code: "42883" } }), "old");
    // any other failure is a no, never a quiet yes
    assertEquals(workVerdict({ data: null, error: { code: "42501" } }), "no");
    assertEquals(workVerdict({ data: true, error: { code: "PGRST301" } }), "no");
    assertEquals(workVerdict({ data: null, error: {} }), "no");
  },
);

Deno.test("server: a sent link or a lead is acted on only by its own rep or an admin", () => {
  assert(ownRow(true, null, "darrell"));
  assert(ownRow(true, "asad", null));
  assert(ownRow(false, "darrell", "darrell"));
  // the lead reads the team's row and still may not act on it
  assert(!ownRow(false, "zeus", "darrell"));
  assert(!ownRow(false, "zeus", null));
  assert(!ownRow(false, null, null));
  assert(!ownRow(false, null, "darrell"));
});
