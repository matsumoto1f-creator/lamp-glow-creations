// Who may read and write the staff chat, checked against a LOCAL Postgres only.
//
//   CONTAINER=lamp-chat-proof deno run --allow-run --allow-env tests/chat-rules.local.ts
//
// The container is Supabase's Postgres image (public.ecr.aws/supabase/postgres:17.6.1.131) with
// every file in supabase/migrations applied in order, as the security kit in Asad's war room does
// (war-room/lamp/security/README.txt). This file adds its own people, runs each case as that person
// (role "authenticated" with their id as the JWT subject, as PostgREST does), rolls every case back,
// and removes its people at the end. It never talks to Lovable Cloud. Not run by `deno test`.

import { chatRefusal, REFUSED_TEXT } from "../src/lib/chat.ts";

const C = (Deno.env.get("CONTAINER") ?? "").trim();
if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(C)) {
  console.error("Set CONTAINER to the local Postgres container's name.");
  Deno.exit(2);
}

const U = {
  admin: "c1000000-0000-0000-0000-000000000001",
  lead: "c2000000-0000-0000-0000-000000000002",
  rep: "c3000000-0000-0000-0000-000000000003",
  other: "c4000000-0000-0000-0000-000000000004",
  exrep: "c5000000-0000-0000-0000-000000000005",
  mA: "ca000000-0000-0000-0000-00000000000a",
  mB: "cb000000-0000-0000-0000-00000000000b",
} as const;
const FILE_A = "fa000000-0000-0000-0000-00000000000a"; // merchant A, rep "chatrep" (team "chatlead")
const FILE_B = "fb000000-0000-0000-0000-00000000000b"; // merchant B, rep "chatother"
const FILE_U = "fc000000-0000-0000-0000-00000000000c"; // merchant B, unassigned
type Who = keyof typeof U | "anon" | "db";
const IDS = Object.values(U)
  .map((u) => `'${u}'`)
  .join(",");

async function psql(sql: string): Promise<{ ok: boolean; out: string[]; err: string }> {
  const cmd = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD=postgres",
      C,
      "psql",
      "-U",
      "postgres",
      "-h",
      "localhost",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const p = cmd.spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(sql));
  await w.close();
  const r = await p.output();
  const out = new TextDecoder()
    .decode(r.stdout)
    .split("\n")
    .filter(
      (l) =>
        l &&
        !["BEGIN", "SET", "ROLLBACK", "COMMIT"].includes(l) &&
        !/^(INSERT|UPDATE|DELETE) /.test(l),
    );
  const err =
    new TextDecoder()
      .decode(r.stderr)
      .split("\n")
      .find((l) => /ERROR/.test(l)) ?? "";
  return { ok: r.success, out, err: err.replace(/^psql:<stdin>:\d+: /, "") };
}

/** SQL that makes the rest of the transaction run as this person. */
const as = (who: Who) =>
  who === "db"
    ? "reset role;\n"
    : who === "anon"
      ? "set local role anon;\nselect set_config('request.jwt.claim.sub', '', true) \\g /dev/null\n"
      : `set local role authenticated;\nselect set_config('request.jwt.claim.sub', '${U[who]}', true) \\g /dev/null\n`;

const ALL = `(select id from public.chat_threads where audience = 'all')`;
const TEAM = `(select id from public.chat_threads where team_slug = 'chatlead')`;
const DM = `(select m1.thread_id from public.chat_members m1
  join public.chat_members m2 on m2.thread_id = m1.thread_id and m2.user_id = '${U.other}'
  join public.chat_threads t on t.id = m1.thread_id and t.kind = 'direct'
  where m1.user_id = '${U.rep}' limit 1)`;
const FILE_T = (file: string) =>
  `(select id from public.chat_threads where application_id = '${file}')`;
const post = (t: string, body: string) =>
  `insert into public.chat_messages (thread_id, body) values (${t}, $b$${body}$b$) returning 1`;
const seeMsgs = (t: string) => `select count(*) from public.chat_messages where thread_id = ${t}`;
const seeThread = (t: string) => `select count(*) from public.chat_threads where id = ${t}`;

const FIXTURE = `
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '{}', now(), now()
from (values
  ('${U.admin}', 'chat.admin@test.dev'), ('${U.lead}', 'chat.lead@test.dev'),
  ('${U.rep}', 'chat.rep@test.dev'), ('${U.other}', 'chat.other@test.dev'),
  ('${U.exrep}', 'chat.exrep@test.dev'), ('${U.mA}', 'chat.ma@test.dev'),
  ('${U.mB}', 'chat.mb@test.dev')) v(id, email);
insert into public.user_roles (user_id, role) values
  ('${U.admin}', 'admin'), ('${U.lead}', 'rep'), ('${U.rep}', 'rep'), ('${U.other}', 'rep');
insert into public.reps (slug, name, user_id, active) values
  ('chatlead', 'Lena Lead', '${U.lead}', true),
  ('chatrep', 'Ray Rep', '${U.rep}', true),
  ('chatother', 'Otto Other', '${U.other}', true),
  ('chatex', 'Ex Rep', '${U.exrep}', true),
  ('chatadmin', 'Ada Admin', '${U.admin}', true)
on conflict (slug) do nothing;
update public.reps set admin_slug = 'chatlead' where slug = 'chatrep';
insert into public.applications (id, user_id, status, business_name, first_name, email, rep_slug) values
  ('${FILE_A}', '${U.mA}', 'reviewing', 'A Trucking', 'Maria', 'chat.ma@test.dev', 'chatrep'),
  ('${FILE_B}', '${U.mB}', 'reviewing', 'B Bakery', 'Ben', 'chat.mb@test.dev', 'chatother'),
  ('${FILE_U}', '${U.mB}', 'new', 'B Bakery 2', 'Ben', 'chat.mb@test.dev', null);
update public.applications set rep_slug = 'chatrep' where id = '${FILE_A}';
update public.applications set rep_slug = 'chatother' where id = '${FILE_B}';
update public.applications set rep_slug = null where id = '${FILE_U}';
commit;
begin; ${as("mA")} select public.open_file_thread('${FILE_A}') \\g /dev/null
${post(FILE_T(FILE_A), "Hi, when will I hear back?").replace(" returning 1", "")};
commit;
begin; ${as("mB")} select public.open_file_thread('${FILE_B}') \\g /dev/null
select public.open_file_thread('${FILE_U}') \\g /dev/null
${post(FILE_T(FILE_U), "Is anyone there?").replace(" returning 1", "")};
commit;
begin; ${as("rep")} select public.open_direct('${U.other}') \\g /dev/null
${post(DM, "first DM").replace(" returning 1", "")};
commit;
begin; ${as("rep")} ${post(ALL, "Morning all").replace(" returning 1", "")};
commit;
`;

type Case = [who: Who, expect: string, label: string, sql: string];
const CASES: Case[] = [
  // All staff
  ["rep", "1", "a rep sees the All staff room", seeThread(ALL)],
  ["admin", "1", "an admin sees the All staff room", seeThread(ALL)],
  ["mA", "0", "a merchant can't see the All staff room", seeThread(ALL)],
  ["mA", "0", "a merchant can't read its messages", seeMsgs(ALL)],
  ["anon", "refused", "a visitor gets nothing", seeMsgs(ALL)],
  ["exrep", "0", "a rep seat without a staff role can't see it", seeThread(ALL)],
  ["rep", "1", "a rep writes in All staff", post(ALL, "Calls by noon")],
  ["other", "1", "so does a rep on no team", post(ALL, "On it")],
  [
    "db",
    "refused",
    "a merchant can't write in All staff, even with its id",
    // knowing the room's id doesn't help: it's looked up as the database, then tried as them
    `select id as tid from public.chat_threads where audience = 'all' \\gset\n${as("mA")}insert into public.chat_messages (thread_id, body) values (:'tid', 'hi') returning 1`,
  ],
  // a team room, made by the database for the team lead
  [
    "db",
    "Lena Lead's team|team",
    "the database made the team lead's room",
    `select title || '|' || audience from public.chat_threads where team_slug = 'chatlead'`,
  ],
  ["rep", "1", "a rep on the team sees the team room", seeThread(TEAM)],
  ["lead", "1", "the team lead sees it", seeThread(TEAM)],
  ["other", "0", "a rep on no team can't", seeThread(TEAM)],
  ["admin", "1", "an admin can", seeThread(TEAM)],
  ["lead", "1", "the team lead writes in it", post(TEAM, "Team call at 4")],
  [
    "db",
    "refused",
    "a rep on no team can't write in it, even with its id",
    `select id as tid from public.chat_threads where team_slug = 'chatlead' \\gset\n${as("other")}insert into public.chat_messages (thread_id, body) values (:'tid', 'hi') returning 1`,
  ],
  [
    "db",
    "1",
    "moving a rep to another lead makes that lead's room",
    `update public.reps set admin_slug = 'chatother' where slug = 'chatrep';\nselect count(*) from public.chat_threads where team_slug = 'chatother'`,
  ],
  // direct messages
  ["rep", "1", "a rep reads their direct message", seeMsgs(DM)],
  ["other", "1", "the other person reads it", seeMsgs(DM)],
  ["lead", "0", "a third person can't", seeMsgs(DM)],
  [
    "admin",
    "1",
    "an admin can read it",
    `select count(*) from public.chat_messages m join public.chat_members a on a.thread_id = m.thread_id and a.user_id = '${U.rep}' join public.chat_members b on b.thread_id = m.thread_id and b.user_id = '${U.other}'`,
  ],
  [
    "admin",
    "refused",
    "an admin can't post into someone else's direct message",
    `insert into public.chat_messages (thread_id, body) select m.thread_id, 'hi' from public.chat_members m join public.chat_members b on b.thread_id = m.thread_id and b.user_id = '${U.other}' where m.user_id = '${U.rep}' returning 1`,
  ],
  [
    "mA",
    "0",
    "a merchant can't read it",
    `select count(*) from public.chat_messages m join public.chat_threads t on t.id = m.thread_id and t.kind = 'direct'`,
  ],
  [
    "rep",
    "true",
    "opening the same pair again gives the same conversation",
    `select (public.open_direct('${U.other}') = ${DM})::text`,
  ],
  [
    "other",
    "true",
    "from either side",
    `select (public.open_direct('${U.rep}') = (select m1.thread_id from public.chat_members m1 join public.chat_members m2 on m2.thread_id = m1.thread_id and m2.user_id = '${U.rep}' where m1.user_id = '${U.other}' limit 1))::text`,
  ],
  [
    "mA",
    "refused",
    "a merchant can't open a direct message",
    `select public.open_direct('${U.rep}')`,
  ],
  [
    "rep",
    "refused",
    "a rep can't direct-message a merchant",
    `select public.open_direct('${U.mA}')`,
  ],
  ["rep", "refused", "nor themselves", `select public.open_direct('${U.rep}')`],
  // rooms admins make
  [
    "rep",
    "refused",
    "a rep can't make a room",
    `select public.create_room('Deals desk', array['${U.other}'::uuid])`,
  ],
  [
    "db",
    "admin,rep|0",
    "an admin's room holds the admin and the staff chosen; others can't see it",
    `${as("admin")}select public.create_room('Deals desk', array['${U.rep}'::uuid, '${U.mA}'::uuid]) \\g /dev/null\nreset role;\n` +
      `select (select string_agg(x.who, ',' order by x.who) from (select case m.user_id when '${U.admin}' then 'admin' when '${U.rep}' then 'rep' else 'other' end as who from public.chat_members m join public.chat_threads t on t.id = m.thread_id where t.title = 'Deals desk') x) || '|' ||\n` +
      `(select count(*) from public.chat_threads t where t.title = 'Deals desk' and public.chat_can_read(t.id, '${U.other}'))::text`,
  ],
  // what the database stamps and refuses
  [
    "rep",
    "rep|Ray Rep|text",
    "the database stamps a rep's role and name",
    post(ALL, "stamp me").replace(
      "returning 1",
      "returning author_role || '|' || author_name || '|' || kind",
    ),
  ],
  [
    "admin",
    "admin|Ada Admin",
    "and an admin's",
    post(ALL, "stamp me").replace("returning 1", "returning author_role || '|' || author_name"),
  ],
  [
    "rep",
    "refused",
    "nobody marks a message as Lamp's",
    `insert into public.chat_messages (thread_id, body, kind) values (${ALL}, 'x', 'system') returning 1`,
  ],
  [
    "rep",
    "refused",
    "nobody writes as someone else",
    `insert into public.chat_messages (thread_id, body, author) values (${ALL}, 'x', '${U.other}') returning 1`,
  ],
  [
    "rep",
    "refused",
    "nobody makes a conversation directly",
    `insert into public.chat_threads (kind) values ('direct') returning 1`,
  ],
  [
    "rep",
    "refused",
    "nobody adds themselves to a conversation",
    `insert into public.chat_members (thread_id, user_id) values (${DM}, '${U.lead}') returning 1`,
  ],
  ["rep", "refused", "an SSN is refused", post(ALL, "his ssn is 123-45-6789")],
  ["rep", "refused", "an account number is refused", post(ALL, "acct 000123456789")],
  ["rep", "refused", "a card number is refused", post(DM, "card 4111 1111 1111 1111")],
  ["rep", "1", "a phone number with dashes passes", post(ALL, "call him at 201-555-0123")],
  [
    "rep",
    "refused",
    "nobody edits a message",
    `update public.chat_messages set body = 'changed' where thread_id = ${ALL} returning 1`,
  ],
  [
    "admin",
    "refused",
    "not even an admin, directly",
    `update public.chat_messages set body = 'changed' where thread_id = ${ALL} returning 1`,
  ],
  [
    "rep",
    "refused",
    "nobody deletes one",
    `delete from public.chat_messages where thread_id = ${ALL} returning 1`,
  ],
  [
    "rep",
    "refused",
    "a rep can't redact",
    `select public.redact_message((select min(id) from public.chat_messages where thread_id = ${ALL}), 'oops')`,
  ],
  [
    "admin",
    "This message was removed by Lamp.|true",
    "an admin redacts: words gone, row kept with who",
    `select public.redact_message((select min(id) from public.chat_messages where thread_id = ${ALL}), 'wrong room') \\g /dev/null\n` +
      `select body || '|' || (redacted_by = '${U.admin}')::text from public.chat_messages where id = (select min(id) from public.chat_messages where thread_id = ${ALL})`,
  ],
  [
    "rep",
    "refused",
    "the 21st message in a minute is refused",
    `${Array.from({ length: 20 }, (_, i) => post(ALL, `note ${i}`) + " \\g /dev/null").join("\n")}\n${post(ALL, "one more")}`,
  ],
  // nothing leaves Lamp
  [
    "db",
    "0",
    "chat writes no notifications (so nothing reaches Discord or email)",
    `create temp table n0 as select count(*) as n from public.notifications;\n${as("rep")}${post(ALL, "room note")} \\g /dev/null\n${post(TEAM, "team note")} \\g /dev/null\nreset role;\nselect (select count(*) from public.notifications) - (select n from n0)`,
  ],
  [
    "db",
    "0",
    "not even for a direct message",
    `create temp table n0 as select count(*) as n from public.notifications;\n${as("other")}${post(DM, "reply")} \\g /dev/null\nreset role;\nselect (select count(*) from public.notifications) - (select n from n0)`,
  ],
  // the inbox
  [
    "rep",
    "direct,merchant,room,room",
    "a rep's inbox: their merchant, All staff, their team room, their DM",
    `select string_agg(kind, ',' order by kind) from public.my_chat_inbox()`,
  ],
  [
    "other",
    "direct,room",
    "another rep's: All staff and the DM",
    `select string_agg(kind, ',' order by kind) from public.my_chat_inbox()`,
  ],
  [
    "admin",
    "merchant,room,room",
    "an admin's lists rooms and the unassigned file, not other people's DMs",
    `select string_agg(kind, ',' order by kind) from public.my_chat_inbox()`,
  ],
  ["mA", "0", "a merchant's inbox is empty", `select count(*) from public.my_chat_inbox()`],
  [
    "other",
    "true|first DM",
    "a new direct message shows unread, with a preview",
    `select unread::text || '|' || preview from public.my_chat_inbox() where kind = 'direct'`,
  ],
  [
    "other",
    "false",
    "and read once opened",
    `select public.mark_thread_read(${DM}) \\g /dev/null\nselect unread::text from public.my_chat_inbox() where kind = 'direct'`,
  ],
  [
    "rep",
    "false",
    "your own message isn't unread",
    `select unread::text from public.my_chat_inbox() where kind = 'direct'`,
  ],
  [
    "rep",
    "120",
    "previews are cut to 120 characters",
    `${post(ALL, "y".repeat(300))} \\g /dev/null\nselect char_length(preview) from public.my_chat_inbox() where title = 'All staff'`,
  ],
  [
    "lead",
    "refused",
    "nobody marks a conversation they can't read",
    `select public.mark_thread_read(${DM})`,
  ],
  [
    "rep",
    "1",
    "people see only their own read marks",
    `select public.mark_thread_read(${ALL}) \\g /dev/null\nselect count(*) from public.chat_reads`,
  ],
  // ---------- merchant conversations (20261110140000_chat_merchant.sql) ----------
  ["mA", "1", "merchant reads own file's conversation", seeMsgs(FILE_T(FILE_A))],
  ["mB", "0", "another merchant can't", seeMsgs(FILE_T(FILE_A))],
  [
    "mB",
    "refused",
    "another merchant can't open it",
    `select public.open_file_thread('${FILE_A}') is not null`,
  ],
  ["rep", "1", "the file's rep reads it", seeMsgs(FILE_T(FILE_A))],
  ["lead", "1", "the rep's team lead reads it", seeMsgs(FILE_T(FILE_A))],
  ["other", "0", "another rep can't", seeMsgs(FILE_T(FILE_A))],
  ["admin", "1", "an admin can", seeMsgs(FILE_T(FILE_A))],
  ["exrep", "0", "a rep seat without a staff role can't", seeMsgs(FILE_T(FILE_A))],
  ["rep", "0", "a rep can't read an unassigned file's conversation", seeMsgs(FILE_T(FILE_U))],
  ["rep", "refused", "nor open one", `select public.open_file_thread('${FILE_U}') is not null`],
  ["admin", "1", "an admin reads the unassigned file's", seeMsgs(FILE_T(FILE_U))],
  ["mA", "0", "a merchant still sees no rooms", seeThread(ALL)],
  [
    "db",
    "0",
    "after the file moves to another rep, the old rep reads nothing",
    `update public.applications set rep_slug = 'chatother' where id = '${FILE_A}';\n${as("rep")}${seeMsgs(FILE_T(FILE_A))}`,
  ],
  [
    "db",
    "1",
    "and the new rep reads it",
    `update public.applications set rep_slug = 'chatother' where id = '${FILE_A}';\n${as("other")}${seeMsgs(FILE_T(FILE_A))}`,
  ],
  [
    "mA",
    "merchant|Maria|text",
    "the database stamps a merchant's role and name",
    post(FILE_T(FILE_A), "stamp me").replace(
      "returning 1",
      "returning author_role || '|' || author_name || '|' || kind",
    ),
  ],
  ["rep", "1", "the file's rep writes to the merchant", post(FILE_T(FILE_A), "On it, Maria.")],
  ["lead", "1", "so does the team lead", post(FILE_T(FILE_A), "Lena here too.")],
  [
    "db",
    "refused",
    "another rep can't write in it, even with its id",
    `select id as tid from public.chat_threads where application_id = '${FILE_A}' \\gset\n${as("other")}insert into public.chat_messages (thread_id, body) values (:'tid', 'hi') returning 1`,
  ],
  [
    "db",
    "refused",
    "another merchant can't either",
    `select id as tid from public.chat_threads where application_id = '${FILE_A}' \\gset\n${as("mB")}insert into public.chat_messages (thread_id, body) values (:'tid', 'hi') returning 1`,
  ],
  [
    "mA",
    "refused",
    "a merchant can't attach a document id",
    `insert into public.chat_messages (thread_id, body, document_id) values (${FILE_T(FILE_A)}, 'x', gen_random_uuid()) returning 1`,
  ],
  ["mA", "refused", "a merchant's SSN is refused", post(FILE_T(FILE_A), "my ssn is 123-45-6789")],
  ["mA", "1", "a merchant's amount passes", post(FILE_T(FILE_A), "I need $150,000 by Friday")],
  [
    "mA",
    "refused",
    "a merchant can't edit",
    `update public.chat_messages set body = 'changed' where thread_id = ${FILE_T(FILE_A)} returning 1`,
  ],
  [
    "db",
    "document|merchant|Sent a business bank statement.",
    "an upload adds a line with the kind, not the file name",
    `insert into public.documents (application_id, user_id, storage_path, kind, original_name) values ('${FILE_A}', '${U.mA}', '${U.mA}/ssn-123-45-6789.pdf', 'bank_statement', 'ssn-123-45-6789.pdf');\n` +
      `select kind || '|' || author_role || '|' || body from public.chat_messages where thread_id = ${FILE_T(FILE_A)} and kind = 'document'`,
  ],
  [
    "db",
    "1",
    "an upload to a file with no conversation still saves",
    `delete from public.chat_threads where application_id = '${FILE_B}';\ninsert into public.documents (application_id, user_id, storage_path, kind) values ('${FILE_B}', '${U.mB}', '${U.mB}/x.pdf', 'voided_check') returning 1`,
  ],
  [
    "db",
    "0",
    "merchant messages write no notifications either",
    `create temp table n0 as select count(*) as n from public.notifications;\n${as("mA")}${post(FILE_T(FILE_A), "any news?")} \\g /dev/null\n${as("rep")}${post(FILE_T(FILE_A), "yes")} \\g /dev/null\nreset role;\nselect (select count(*) from public.notifications) - (select n from n0)`,
  ],
  // the inbox
  [
    "rep",
    "true|A Trucking",
    "the merchant's message shows unread in the rep's list",
    `select unread::text || '|' || title from public.my_chat_inbox() where kind = 'merchant'`,
  ],
  [
    "lead",
    "A Trucking",
    "and in the team lead's",
    `select title from public.my_chat_inbox() where kind = 'merchant'`,
  ],
  [
    "other",
    "0",
    "not in another rep's",
    `select count(*) from public.my_chat_inbox() where kind = 'merchant'`,
  ],
  [
    "admin",
    "B Bakery 2",
    "an admin's list has the unassigned file, not every assigned one",
    `select string_agg(title, ',') from public.my_chat_inbox() where kind = 'merchant'`,
  ],
  [
    "admin",
    "A Trucking,B Bakery 2",
    "until they open one",
    `select public.mark_thread_read(${FILE_T(FILE_A)}) \\g /dev/null\nselect string_agg(title, ',' order by title) from public.my_chat_inbox() where kind = 'merchant'`,
  ],
  ["mA", "0", "a merchant's list is empty", `select count(*) from public.my_chat_inbox()`],
  // the nudge
  [
    "db",
    "1",
    "a staff reply unread for 15 minutes is due a nudge",
    `${as("rep")}${post(FILE_T(FILE_A), "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `select count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not before 15 minutes",
    `${as("rep")}${post(FILE_T(FILE_A), "Can you send April?")} \\g /dev/null\nreset role;\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not again after a nudge",
    `${as("rep")}${post(FILE_T(FILE_A), "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `select public.chat_mark_nudged(${FILE_T(FILE_A)}, '${U.mA}') \\g /dev/null\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not once the merchant has read it",
    `${as("rep")}${post(FILE_T(FILE_A), "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `${as("mA")}select public.mark_thread_read(${FILE_T(FILE_A)}) \\g /dev/null\nreset role;\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "never for the merchant's own messages",
    `${as("mA")}${post(FILE_T(FILE_A), "just me")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'just me';\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  ["rep", "refused", "staff can't list nudges", `select count(*) from public.chat_nudges_due()`],
  [
    "mA",
    "refused",
    "a merchant can't mark a nudge",
    `select public.chat_mark_nudged(${FILE_T(FILE_A)}, '${U.mA}')`,
  ],
  ["rep", "refused", "staff can't read the nudge secret", `select public.chat_nudge_secret()`],
  ["mA", "refused", "nor can a merchant", `select public.chat_nudge_secret()`],
  [
    "db",
    "t",
    "the nudge has its own Vault entries, not the Discord relay's",
    `select (exists (select 1 from vault.secrets where name = 'chat_nudge_url') and exists (select 1 from vault.secrets where name = 'chat_nudge_secret'))::text::bool`,
  ],
];

let bad = 0;
const fx = await psql(FIXTURE);
if (!fx.ok) {
  console.error("Fixture failed:", fx.err);
  Deno.exit(1);
}
for (const [who, expect, label, sql] of CASES) {
  const r = await psql(`begin;\n${as(who)}${sql};\nrollback;\n`);
  const got = r.ok && r.out.length ? r.out[r.out.length - 1] : r.ok ? "0" : "refused";
  const ok = got === expect;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${who.padEnd(6)} ${label.padEnd(72)} -> ${got}${!ok ? `  (wanted ${expect}) ${r.err}` : ""}`,
  );
}

// the browser's check (src/lib/chat.ts) and the database's (chat_text_refused) agree
const SAMPLES = [
  "his ssn is 123-45-6789",
  "ssn 123 45 6789",
  "123456789",
  "routing 021000021",
  "acct 000123456789",
  "EIN 12-3456789",
  "card 4111 1111 1111 1111",
  "card 4111-1111-1111-1111",
  "+12015550123",
  "Call him at 201-555-0123",
  "(201) 555-0123 works",
  "201 555 0123",
  "They need $150,000 by Friday",
  "About 1,250,000 a year",
  "Zip is 07030",
  "1234567",
  "12345678",
];
for (const text of SAMPLES) {
  const r = await psql(`select public.chat_text_refused($t$${text}$t$);`);
  const db = r.out[r.out.length - 1] === "t";
  const browser = chatRefusal(text) === REFUSED_TEXT;
  const ok = r.ok && db === browser;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  parity ${JSON.stringify(text).padEnd(72)} -> db ${db}, browser ${browser}`,
  );
}
{
  const r = await psql(`begin;\n${as("rep")}${post(ALL, "123-45-6789")};\nrollback;\n`);
  const ok = r.err.includes(REFUSED_TEXT);
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  rep    the database refuses in the same words the browser shows`,
  );
}

// leave the container as it was
await psql(`begin;
delete from public.chat_threads where kind = 'direct' and id in (select thread_id from public.chat_members where user_id in (${IDS}));
delete from public.chat_threads where title = 'Deals desk' or team_slug in ('chatlead', 'chatrep', 'chatother', 'chatex', 'chatadmin');
delete from public.chat_messages where author in (${IDS});
delete from public.applications where id in ('${FILE_A}', '${FILE_B}', '${FILE_U}');
delete from public.reps where slug in ('chatlead', 'chatrep', 'chatother', 'chatex', 'chatadmin');
delete from auth.users where id in (${IDS});
commit;`);
console.log(`\n${bad} problems`);
Deno.exit(bad ? 1 : 0);
