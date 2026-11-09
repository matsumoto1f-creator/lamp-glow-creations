// Who may read and write the in-app chat, checked against a LOCAL Postgres only.
//
//   CONTAINER=lamp-chat-proof deno run --allow-run --allow-env tests/chat-rules.local.ts
//
// The container is Supabase's Postgres image (public.ecr.aws/supabase/postgres:17.6.1.131) with
// every file in supabase/migrations applied in order, as the security kit in Asad's war room does
// (war-room/lamp/security/README.txt). This file adds its own people and files, runs each case as
// that person (role "authenticated" with their id as the JWT subject, as PostgREST does), and
// rolls every case back. It never talks to Lovable Cloud. Not run by `deno test` (no .test.ts).

const C = (Deno.env.get("CONTAINER") ?? "").trim();
if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(C)) {
  console.error("Set CONTAINER to the local Postgres container's name.");
  Deno.exit(2);
}
const PHASE2 = (Deno.env.get("PHASE") ?? "1") === "2";

import { chatRefusal, REFUSED_TEXT } from "../src/lib/chat.ts";

const U = {
  admin: "c1000000-0000-0000-0000-000000000001",
  lead: "c2000000-0000-0000-0000-000000000002",
  rep: "c3000000-0000-0000-0000-000000000003",
  other: "c4000000-0000-0000-0000-000000000004",
  exrep: "c5000000-0000-0000-0000-000000000005",
  mA: "ca000000-0000-0000-0000-00000000000a",
  mB: "cb000000-0000-0000-0000-00000000000b",
} as const;
type Who = keyof typeof U | "anon" | "db";
const FILE_A = "fa000000-0000-0000-0000-00000000000a"; // merchant A, rep "rep" (team "lead")
const FILE_B = "fb000000-0000-0000-0000-00000000000b"; // merchant B, rep "other"
const FILE_U = "fc000000-0000-0000-0000-00000000000c"; // merchant B, unassigned

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

const thread = (file: string) =>
  `(select id from public.chat_threads where application_id = '${file}')`;
const post = (file: string, body: string) =>
  `insert into public.chat_messages (thread_id, body) values (${thread(file)}, $b$${body}$b$) returning 1`;
const seeMsgs = (file: string) =>
  `select count(*) from public.chat_messages where thread_id = ${thread(file)}`;
const seeThread = (file: string) =>
  `select count(*) from public.chat_threads where application_id = '${file}'`;

const postTo0 = (body: string) =>
  `insert into public.chat_messages (thread_id, body) select m1.thread_id, $b$${body}$b$ from public.chat_members m1 join public.chat_members m2 on m2.thread_id = m1.thread_id and m2.user_id = '${U.other}' where m1.user_id = '${U.rep}' limit 1`;

const FIXTURE = `
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '{}', now(), now()
from (values
  ('${U.admin}', 'chat.admin@test.dev'), ('${U.lead}', 'chat.lead@test.dev'),
  ('${U.rep}', 'chat.rep@test.dev'), ('${U.other}', 'chat.other@test.dev'),
  ('${U.exrep}', 'chat.exrep@test.dev'),
  ('${U.mA}', 'chat.ma@test.dev'), ('${U.mB}', 'chat.mb@test.dev')) v(id, email);
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
-- threads as each merchant would make them, on first visit
begin; ${as("mA")} select public.open_file_thread('${FILE_A}') \\g /dev/null
commit;
begin; ${as("mB")} select public.open_file_thread('${FILE_B}') \\g /dev/null
select public.open_file_thread('${FILE_U}') \\g /dev/null
commit;
begin; ${as("mA")} ${post(FILE_A, "Hi, when will I hear back?")};
commit;
begin; ${as("mB")} ${post(FILE_U, "Is anyone there?")};
commit;
${PHASE2 ? `begin; ${as("rep")} select public.open_direct('${U.other}') \\g /dev/null\n${postTo0("first DM")};\ncommit;\n` : ""}
`;

type Case = [who: Who, expect: string, label: string, sql: string];
const CASES: Case[] = [
  // reading a file's thread
  ["mA", "1", "merchant reads own file's thread", seeThread(FILE_A)],
  ["mA", "1", "merchant reads own messages", seeMsgs(FILE_A)],
  ["mB", "0", "other merchant can't see thread A", seeThread(FILE_A)],
  ["mB", "0", "other merchant can't read thread A", seeMsgs(FILE_A)],
  [
    "mB",
    "refused",
    "other merchant can't open thread A",
    `select public.open_file_thread('${FILE_A}') is not null`,
  ],
  ["rep", "1", "the file's rep reads it", seeMsgs(FILE_A)],
  ["lead", "1", "the rep's team lead reads it", seeMsgs(FILE_A)],
  ["other", "0", "another rep can't read it", seeMsgs(FILE_A)],
  ["other", "0", "another rep can't see the thread", seeThread(FILE_A)],
  ["admin", "1", "an admin reads it", seeMsgs(FILE_A)],
  ["anon", "refused", "a visitor gets nothing", seeMsgs(FILE_A)],
  ["rep", "0", "a rep can't read an unassigned file's thread", seeMsgs(FILE_U)],
  [
    "rep",
    "refused",
    "a rep can't open an unassigned file's thread",
    `select public.open_file_thread('${FILE_U}') is not null`,
  ],
  ["admin", "1", "an admin reads the unassigned file's thread", seeMsgs(FILE_U)],
  ["mB", "1", "merchant B reads their unassigned file's thread", seeMsgs(FILE_U)],
  ["exrep", "0", "a rep seat without a staff role reads nothing", seeMsgs(FILE_A)],
  [
    "rep",
    "1",
    "rep opens the file's existing thread (no second one)",
    `select (public.open_file_thread('${FILE_A}') = ${thread(FILE_A)})::int`,
  ],
  // moving a file moves the thread
  [
    "db",
    "0",
    "after the file moves to another rep, the old rep reads nothing",
    `update public.applications set rep_slug = 'chatother' where id = '${FILE_A}';\n${as("rep")}${seeMsgs(FILE_A)}`,
  ],
  [
    "db",
    "1",
    "after the file moves, the new rep reads it",
    `update public.applications set rep_slug = 'chatother' where id = '${FILE_A}';\n${as("other")}${seeMsgs(FILE_A)}`,
  ],
  // writing
  ["mA", "1", "merchant writes in own thread", post(FILE_A, "Here's my question")],
  ["rep", "1", "the file's rep writes", post(FILE_A, "Thanks Maria, I'll call you at 2.")],
  ["lead", "1", "the team lead writes", post(FILE_A, "Lena here, I'm on this too.")],
  ["mB", "refused", "other merchant can't write in thread A", post(FILE_A, "hello")],
  ["other", "refused", "another rep can't write in thread A", post(FILE_A, "hello")],
  ["rep", "refused", "a rep can't write in an unassigned file's thread", post(FILE_U, "hello")],
  [
    "mA",
    "merchant|Maria|text",
    "the database stamps a merchant's role and name",
    `${post(FILE_A, "stamp me").replace("returning 1", "returning author_role || '|' || author_name || '|' || kind")}`,
  ],
  [
    "rep",
    "rep|Ray Rep",
    "the database stamps a rep's role and name",
    `${post(FILE_A, "stamp me").replace("returning 1", "returning author_role || '|' || author_name")}`,
  ],
  [
    "admin",
    "admin|Ada Admin",
    "the database stamps an admin's role and name",
    `${post(FILE_A, "stamp me").replace("returning 1", "returning author_role || '|' || author_name")}`,
  ],
  [
    "mA",
    "refused",
    "merchant can't mark a message as Lamp's",
    `insert into public.chat_messages (thread_id, body, kind) values (${thread(FILE_A)}, 'x', 'system') returning 1`,
  ],
  [
    "mA",
    "refused",
    "merchant can't write as someone else",
    `insert into public.chat_messages (thread_id, body, author) values (${thread(FILE_A)}, 'x', '${U.rep}') returning 1`,
  ],
  [
    "mA",
    "refused",
    "merchant can't attach a document id",
    `insert into public.chat_messages (thread_id, body, document_id) values (${thread(FILE_A)}, 'x', gen_random_uuid()) returning 1`,
  ],
  [
    "mA",
    "refused",
    "merchant can't make a thread directly",
    `insert into public.chat_threads (application_id) values ('${FILE_A}') returning 1`,
  ],
  // numbers that belong in the secure application
  ["mA", "refused", "an SSN with dashes is refused", post(FILE_A, "my ssn is 123-45-6789")],
  ["mA", "refused", "an SSN typed as 9 digits is refused", post(FILE_A, "ssn 123456789")],
  ["mA", "refused", "an account number is refused", post(FILE_A, "acct 000123456789")],
  ["mA", "refused", "an EIN is refused", post(FILE_A, "EIN 12-3456789")],
  ["mA", "refused", "a card number is refused", post(FILE_A, "card 4111 1111 1111 1111")],
  ["mA", "1", "a phone number with dashes passes", post(FILE_A, "call me at 201-555-0123")],
  ["mA", "1", "an amount passes", post(FILE_A, "I need $150,000 by Friday")],
  ["rep", "refused", "staff are held to the same rule", post(FILE_A, "is it 123-45-6789?")],
  // never edited, never deleted from a browser
  [
    "mA",
    "refused",
    "merchant can't edit a message",
    `update public.chat_messages set body = 'changed' where thread_id = ${thread(FILE_A)} returning 1`,
  ],
  [
    "rep",
    "refused",
    "a rep can't delete a message",
    `delete from public.chat_messages where thread_id = ${thread(FILE_A)} returning 1`,
  ],
  [
    "admin",
    "refused",
    "even an admin can't edit directly",
    `update public.chat_messages set body = 'changed' where thread_id = ${thread(FILE_A)} returning 1`,
  ],
  [
    "rep",
    "refused",
    "a rep can't redact",
    `select public.redact_message((select min(id) from public.chat_messages where thread_id = ${thread(FILE_A)}), 'oops')`,
  ],
  [
    "admin",
    "This message was removed by Lamp.|true",
    "an admin redacts: words gone, row kept with who",
    `select public.redact_message((select min(id) from public.chat_messages where thread_id = ${thread(FILE_A)}), 'had a number') \\g /dev/null\n` +
      `select body || '|' || (redacted_by = '${U.admin}')::text from public.chat_messages where id = (select min(id) from public.chat_messages where thread_id = ${thread(FILE_A)})`,
  ],
  // too many at once
  [
    "mA",
    "refused",
    "the 21st message in a minute is refused",
    `${Array.from({ length: 20 }, (_, i) => post(FILE_A, `note ${i}`) + " \\g /dev/null").join("\n")}\n${post(FILE_A, "one more")}`,
  ],
  // who hears about it
  [
    "db",
    "chatlead,chatrep",
    "a merchant's message pings the rep and the team lead, not the admin",
    `select string_agg(r.slug, ',' order by r.slug) from public.notifications n join public.reps r on r.user_id = n.user_id
      where n.kind = 'message' and n.application_id = '${FILE_A}'`,
  ],
  [
    "db",
    "t",
    "the ping carries no merchant words",
    `select bool_and(body is null and title = 'Message from Maria at A Trucking') from public.notifications where kind = 'message' and application_id = '${FILE_A}'`,
  ],
  [
    "db",
    "1",
    "a second message doesn't ping again while the first is unread",
    `${as("mA")}${post(FILE_A, "and another thing")} \\g /dev/null\nreset role;\nselect count(*) from public.notifications n where n.kind = 'message' and n.application_id = '${FILE_A}' and n.user_id = '${U.rep}'`,
  ],
  [
    "db",
    "1",
    "a message on an unassigned file pings the admins",
    `select count(*) from public.notifications where kind = 'message' and application_id = '${FILE_U}' and user_id = '${U.admin}'`,
  ],
  [
    "db",
    "lead",
    "a rep's reply tells the team lead, not the rep who wrote it",
    `delete from public.notifications where kind = 'message';\n${as("rep")}${post(FILE_A, "on it")} \\g /dev/null\nreset role;\n` +
      `select string_agg(case n.user_id when '${U.lead}' then 'lead' when '${U.rep}' then 'rep' else 'other' end, ',') from public.notifications n where n.kind = 'message' and n.application_id = '${FILE_A}'`,
  ],
  // read marks
  [
    "rep",
    "0",
    "reading the thread clears its bell item",
    `select public.mark_thread_read(${thread(FILE_A)}) \\g /dev/null\nselect count(*) from public.notifications where user_id = '${U.rep}' and kind = 'message' and read_at is null`,
  ],
  [
    "mB",
    "refused",
    "nobody marks someone else's thread read",
    `select public.mark_thread_read(${thread(FILE_A)})`,
  ],
  [
    "mA",
    "1",
    "a person sees only their own read marks",
    `select public.mark_thread_read(${thread(FILE_A)}) \\g /dev/null\nselect count(*) from public.chat_reads`,
  ],
  // a document arriving
  [
    "db",
    "document|merchant|Sent a business bank statement.",
    "an upload adds a line with the kind, not the file name",
    `insert into public.documents (application_id, user_id, storage_path, kind, original_name) values ('${FILE_A}', '${U.mA}', '${U.mA}/ssn-123-45-6789.pdf', 'bank_statement', 'ssn-123-45-6789.pdf');\n` +
      `select kind || '|' || author_role || '|' || body from public.chat_messages where thread_id = ${thread(FILE_A)} and kind = 'document'`,
  ],
  [
    "db",
    "1",
    "an upload to a file with no thread still saves",
    `delete from public.chat_threads where application_id = '${FILE_B}';\ninsert into public.documents (application_id, user_id, storage_path, kind) values ('${FILE_B}', '${U.mB}', '${U.mB}/x.pdf', 'voided_check') returning 1`,
  ],
  [
    "db",
    "0",
    "a document line doesn't ping (the document alert already does)",
    `delete from public.notifications where kind = 'message';\ninsert into public.documents (application_id, user_id, storage_path, kind) values ('${FILE_A}', '${U.mA}', '${U.mA}/y.pdf', 'other');\nselect count(*) from public.notifications where kind = 'message'`,
  ],
];

// Phase 2 (20261109130000_chat_staff_messages.sql): rooms, direct messages, the inbox, the nudge.
const ALL = `(select id from public.chat_threads where audience = 'all')`;
const TEAM = `(select id from public.chat_threads where team_slug = 'chatlead')`;
const DM = `(select m1.thread_id from public.chat_members m1
  join public.chat_members m2 on m2.thread_id = m1.thread_id and m2.user_id = '${U.other}'
  join public.chat_threads t on t.id = m1.thread_id and t.kind = 'direct'
  where m1.user_id = '${U.rep}' limit 1)`;
const postTo = (t: string, body: string) =>
  `insert into public.chat_messages (thread_id, body) values (${t}, $b$${body}$b$) returning 1`;
const seeIn = (t: string) => `select count(*) from public.chat_messages where thread_id = ${t}`;
const seeT = (t: string) => `select count(*) from public.chat_threads where id = ${t}`;

const CASES_2: Case[] = [
  // All staff
  ["rep", "1", "a rep sees the All staff room", seeT(ALL)],
  ["admin", "1", "an admin sees the All staff room", seeT(ALL)],
  ["mA", "0", "a merchant can't see the All staff room", seeT(ALL)],
  ["exrep", "0", "a rep seat without a staff role can't see it", seeT(ALL)],
  ["rep", "1", "a rep writes in All staff", postTo(ALL, "Morning all")],
  ["mA", "refused", "a merchant can't write in All staff", postTo(ALL, "hello")],
  ["rep", "refused", "the number guard holds in rooms", postTo(ALL, "acct 000123456789")],
  // a team room, made by the database for the team lead
  [
    "db",
    "Lena Lead's team|team",
    "the database made the team lead's room",
    `select title || '|' || audience from public.chat_threads where team_slug = 'chatlead'`,
  ],
  ["rep", "1", "a rep on the team sees the team room", seeT(TEAM)],
  ["lead", "1", "the team lead sees the team room", seeT(TEAM)],
  ["other", "0", "a rep on no team can't see it", seeT(TEAM)],
  ["admin", "1", "an admin sees the team room", seeT(TEAM)],
  ["other", "refused", "a rep on no team can't write in it", postTo(TEAM, "hi")],
  ["lead", "1", "the team lead writes in it", postTo(TEAM, "Calls by noon")],
  [
    "db",
    "0",
    "room messages ping nobody",
    `delete from public.notifications where kind = 'message';\n${as("lead")}${postTo(TEAM, "ping?")} \\g /dev/null\nreset role;\nselect count(*) from public.notifications where kind = 'message' and link like '%view=messages%'`,
  ],
  // direct messages
  ["rep", "1", "a rep reads their direct message", seeIn(DM)],
  ["other", "1", "the other person reads it", seeIn(DM)],
  ["lead", "0", "a third person can't", seeIn(DM)],
  [
    "admin",
    "1",
    "an admin can read it (decision 4)",
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
  [
    "db",
    "Message from Ray Rep|Short note",
    "a direct message notifies the other person with a preview",
    `delete from public.notifications where kind = 'message';\n${as("rep")}${postTo(DM, "Short note")} \\g /dev/null\nreset role;\nselect title || '|' || body from public.notifications where user_id = '${U.other}' and kind = 'message'`,
  ],
  [
    "db",
    "100",
    "the preview is cut to 100 characters",
    `delete from public.notifications where kind = 'message';\n${as("rep")}${postTo(DM, "x".repeat(300))} \\g /dev/null\nreset role;\nselect char_length(body) from public.notifications where user_id = '${U.other}' and kind = 'message'`,
  ],
  [
    "db",
    "0",
    "the sender isn't notified of their own message",
    `${as("rep")}${postTo(DM, "me?")} \\g /dev/null\nreset role;\nselect count(*) from public.notifications where user_id = '${U.rep}' and kind = 'message' and link like '%view=messages%'`,
  ],
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
    "an admin's room holds the admin and the people chosen; others can't see it",
    `${as("admin")}select public.create_room('Deals desk', array['${U.rep}'::uuid, '${U.mA}'::uuid]) \\g /dev/null\nreset role;\n` +
      `select (select string_agg(x.who, ',' order by x.who) from (select case m.user_id when '${U.admin}' then 'admin' when '${U.rep}' then 'rep' else 'other' end as who from public.chat_members m join public.chat_threads t on t.id = m.thread_id where t.title = 'Deals desk') x) || '|' ||\n` +
      `(select count(*) from public.chat_threads t where t.title = 'Deals desk' and public.chat_can_read(t.id, '${U.other}'))::text`,
  ],
  [
    "db",
    "0",
    "a merchant chosen for a room isn't added",
    `${as("admin")}select public.create_room('Deals desk', array['${U.mA}'::uuid]) \\g /dev/null\nreset role;\nselect count(*) from public.chat_members m join public.chat_threads t on t.id = m.thread_id where t.title = 'Deals desk' and m.user_id = '${U.mA}'`,
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
    "another rep's inbox: All staff and the DM (no team, no merchant messages yet)",
    `select string_agg(kind, ',' order by kind) from public.my_chat_inbox()`,
  ],
  ["mA", "0", "a merchant's inbox is empty", `select count(*) from public.my_chat_inbox()`],
  [
    "rep",
    "true",
    "a merchant's new message shows unread for the rep",
    `select unread::text from public.my_chat_inbox() where application_id = '${FILE_A}'`,
  ],
  [
    "rep",
    "false",
    "and read once they open it",
    `select public.mark_thread_read(${thread(FILE_A)}) \\g /dev/null\nselect unread::text from public.my_chat_inbox() where application_id = '${FILE_A}'`,
  ],
  [
    "rep",
    "false",
    "their own message doesn't count as unread",
    `${postTo(ALL, "mine")} \\g /dev/null\nselect unread::text from public.my_chat_inbox() where kind = 'room' and title = 'All staff'`,
  ],
  // the nudge
  [
    "db",
    "1",
    "a staff reply unread for 15 minutes is due a nudge",
    `${as("rep")}${post(FILE_A, "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `select count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not before 15 minutes",
    `${as("rep")}${post(FILE_A, "Can you send April?")} \\g /dev/null\nreset role;\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not again after a nudge",
    `${as("rep")}${post(FILE_A, "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `select public.chat_mark_nudged(${thread(FILE_A)}, '${U.mA}') \\g /dev/null\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "not once the merchant has read it",
    `${as("rep")}${post(FILE_A, "Can you send April?")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'Can you send April?';\n` +
      `${as("mA")}select public.mark_thread_read(${thread(FILE_A)}) \\g /dev/null\nreset role;\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  [
    "db",
    "0",
    "a merchant's own messages never trigger one",
    `${as("mA")}${post(FILE_A, "just me")} \\g /dev/null\nreset role;\nupdate public.chat_messages set created_at = now() - interval '20 minutes' where body = 'just me';\nselect count(*) from public.chat_nudges_due() where user_id = '${U.mA}'`,
  ],
  ["rep", "refused", "staff can't list nudges", `select count(*) from public.chat_nudges_due()`],
  [
    "mA",
    "refused",
    "a merchant can't mark a nudge",
    `select public.chat_mark_nudged(${thread(FILE_A)}, '${U.mA}')`,
  ],
  // phase 1 still holds with phase 2 in place
  ["other", "0", "another rep still can't read merchant A", seeMsgs(FILE_A)],
  ["mB", "0", "another merchant still can't read merchant A", seeMsgs(FILE_A)],
];

let bad = 0;
const fx = await psql(FIXTURE);
if (!fx.ok) {
  console.error("Fixture failed:", fx.err);
  Deno.exit(1);
}
for (const [who, expect, label, sql] of [...CASES, ...(PHASE2 ? CASES_2 : [])]) {
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
  "my ssn is 123-45-6789",
  "ssn 123 45 6789",
  "123456789",
  "routing 021000021",
  "acct 000123456789",
  "EIN 12-3456789",
  "card 4111 1111 1111 1111",
  "card 4111-1111-1111-1111",
  "+12015550123",
  "Call me at 201-555-0123",
  "(201) 555-0123 works",
  "201 555 0123",
  "I need $150,000 by Friday",
  "We do about 1,250,000 a year",
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
  const r = await psql(`begin;\n${as("mA")}${post(FILE_A, "123-45-6789")};\nrollback;\n`);
  const ok = r.err.includes(REFUSED_TEXT);
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  mA     the database refuses in the same words the browser shows`,
  );
}

// leave the container as it was
await psql(`begin;
delete from public.chat_threads where kind <> 'merchant' and audience is distinct from 'all'
  and (id in (select thread_id from public.chat_members where user_id in (${Object.values(U)
    .map((u) => `'${u}'`)
    .join(",")})) or team_slug in ('chatlead', 'chatrep', 'chatother', 'chatex', 'chatadmin'));
delete from public.chat_messages where author in (${Object.values(U)
  .map((u) => `'${u}'`)
  .join(",")});
delete from public.applications where id in ('${FILE_A}', '${FILE_B}', '${FILE_U}');
delete from public.notifications where user_id in (${Object.values(U)
  .map((u) => `'${u}'`)
  .join(",")});
delete from public.reps where slug in ('chatlead', 'chatrep', 'chatother', 'chatex', 'chatadmin');
delete from auth.users where id in (${Object.values(U)
  .map((u) => `'${u}'`)
  .join(",")});
commit;`);
console.log(`\n${bad} problems`);
Deno.exit(bad ? 1 : 0);
