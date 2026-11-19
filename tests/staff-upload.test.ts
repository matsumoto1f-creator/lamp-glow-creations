// deno test --node-modules-dir=none tests/staff-upload.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { staffUploadProblem } from "../src/lib/documents.ts";
import server from "../src/lib/documents.server.ts" with { type: "text" };
import route from "../src/routes/api.documents.staff-upload.ts" with { type: "text" };
import fileView from "../src/components/staff/file-view.tsx" with { type: "text" };

const MB = 1024 * 1024;

Deno.test("staff drop zone: PDFs and photos up to 20 MB, anything else says why", () => {
  assertEquals(
    staffUploadProblem({ name: "march.pdf", size: 2 * MB, type: "application/pdf" }),
    null,
  );
  assertEquals(staffUploadProblem({ name: "check.JPG", size: MB, type: "image/jpeg" }), null);
  assertEquals(staffUploadProblem({ name: "id.heic", size: MB, type: "" }), null);
  // a browser that doesn't know the type: go by the name
  assertEquals(
    staffUploadProblem({ name: "april.pdf", size: MB, type: "application/octet-stream" }),
    null,
  );
  assert(
    staffUploadProblem({ name: "big.pdf", size: 21 * MB, type: "application/pdf" })!.includes(
      "20 MB",
    ),
  );
  assert(
    staffUploadProblem({ name: "stmt.xlsx", size: MB, type: "application/vnd.ms-excel" })!.includes(
      "PDF",
    ),
  );
  assert(staffUploadProblem({ name: "stmt.csv", size: MB, type: "" })!.includes("PDF"));
  assert(
    staffUploadProblem({ name: "x.pdf", size: 0, type: "application/pdf" })!.includes("empty"),
  );
});

Deno.test(
  "server: only someone who may work the file adds to it, and checks the file itself",
  () => {
    const fn = server.slice(server.indexOf("export async function staffUploadDocument"));
    const workAt = fn.indexOf("mayWork(who, appId)");
    const storeAt = fn.indexOf(".upload(path, bytes");
    assert(workAt > 0 && storeAt > workAt, "the work check must come before anything is stored");
    assert(fn.includes("if (!UPLOAD_TYPES.includes(type))"));
    assert(fn.includes("!looksLikePdf(bytes)"));
    assert(fn.includes("file.size > MAX_UPLOAD_BYTES"));
    // a row that fails to save takes its file with it, and the timeline names the team
    assert(fn.includes("await svc.storage.from(BUCKET).remove([path]);"));
    assert(fn.includes('kind: "document_uploaded"'));
    assert(fn.includes("actor_user_id: who.userId"));
    assert(route.includes("staffUploadDocument(request)"));
  },
);

Deno.test("file view: the drop zone shows only to someone who works the file", () => {
  assert(
    fileView.includes("{!watch && <StaffDocUpload fileId={fileId} onDone={() => void load()} />}"),
  );
});
