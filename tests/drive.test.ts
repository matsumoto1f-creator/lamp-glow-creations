// deno test --node-modules-dir=none tests/drive.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { copyName, driveAllowed, DRIVE_SCOPE, folderName, folderUrl } from "../src/lib/drive.ts";
import send from "../src/lib/funder-send.server.ts" with { type: "text" };
import drive from "../src/lib/drive.server.ts" with { type: "text" };
import migration from "../supabase/migrations/20261119170000_drive_copies.sql" with { type: "text" };

Deno.test(
  "folders are named for the business, with a short id so two files never share one",
  () => {
    const id = "1a2b3c4d-0000-0000-0000-000000000000";
    assertEquals(
      folderName({ id, business_name: "Vella Interiors, Inc.", first_name: "Dana" }),
      "Vella Interiors, Inc. (1a2b3c4d)",
    );
    assertEquals(folderName({ id, business_name: "  ", first_name: "Dana" }), "Dana (1a2b3c4d)");
    assertEquals(folderName({ id, business_name: null, first_name: null }), "File (1a2b3c4d)");
    // characters Drive or a download would trip over become spaces
    assertEquals(
      folderName({ id, business_name: 'A/B: "C"', first_name: null }),
      "A B C (1a2b3c4d)",
    );
  },
);

Deno.test("copies say what they are first", () => {
  assertEquals(
    copyName({ kind: "bank_statement", original_name: "march.pdf", storage_path: "x/1-march.pdf" }),
    "Bank statement - march.pdf",
  );
  assertEquals(
    copyName({ kind: "voided_check", original_name: null, storage_path: "u/1712345-check.jpg" }),
    "Voided business check or bank letter - check.jpg",
  );
  assertEquals(
    copyName({ kind: "mystery", original_name: "a.pdf", storage_path: "a.pdf" }),
    "Document - a.pdf",
  );
  assert(
    copyName({ kind: "other", original_name: "x".repeat(400), storage_path: "p" }).length <= 200,
  );
});

Deno.test("Drive is used only when the connection allowed it", () => {
  assert(driveAllowed(`openid email https://www.googleapis.com/auth/gmail.send ${DRIVE_SCOPE}`));
  assert(!driveAllowed("openid email https://www.googleapis.com/auth/gmail.send"));
  assert(!driveAllowed(null));
  // the narrow permission: only folders Lamp makes, never the whole Drive
  assertEquals(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.file");
  assert(send.includes(`"${DRIVE_SCOPE}"`), "the connect screen asks for Drive");
  assert(!send.includes('auth/drive"'), "never the full Drive permission");
  assert(
    send.includes('if (!(t.scope ?? "").includes("gmail.send")) return back("send_not_allowed");'),
  );
  assertEquals(folderUrl("abc1234567"), "https://drive.google.com/drive/folders/abc1234567");
});

Deno.test(
  "copying is for the file's rep or an admin, and only the server touches the tables",
  () => {
    const action = drive.slice(drive.indexOf("export async function driveAction"));
    assert(
      action.indexOf("mayWork(who, appId)") > 0 &&
        action.indexOf("mayWork(who, appId)") < action.indexOf("syncApplication("),
    );
    const sql = migration.toLowerCase();
    assert(sql.includes("revoke all on public.drive_folders from anon, authenticated"));
    assert(sql.includes("revoke all on public.drive_copies from anon, authenticated"));
    assert(!/create policy/.test(sql));
  },
);
