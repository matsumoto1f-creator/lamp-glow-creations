// deno test --node-modules-dir=none tests/chat-dock.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { dockThread, readDock, writeDock } from "../src/lib/chat-dock.ts";

const T = "3f2b8c1e-4d5a-4e6f-8a9b-0c1d2e3f4a5b";

Deno.test("first visit: open beside the page on a wide screen, closed on a phone", () => {
  assertEquals(readDock(null, true), { open: true, thread: null });
  assertEquals(readDock(null, false), { open: false, thread: null });
});

Deno.test("a wide screen comes back as it was left", () => {
  assertEquals(readDock(writeDock({ open: false, thread: T }), true), { open: false, thread: T });
  assertEquals(readDock(writeDock({ open: true, thread: null }), true), {
    open: true,
    thread: null,
  });
});

Deno.test("a phone never opens it on arrival, but keeps the conversation", () => {
  assertEquals(readDock(writeDock({ open: true, thread: T }), false), { open: false, thread: T });
});

Deno.test("junk in storage is ignored", () => {
  assertEquals(readDock("not json", true), { open: true, thread: null });
  assertEquals(readDock('{"open":"yes","thread":"drop table"}', true), {
    open: true,
    thread: null,
  });
  assertEquals(readDock("[1,2]", false), { open: false, thread: null });
});

Deno.test("only a real conversation id is taken from a link", () => {
  assertEquals(dockThread(T), T);
  assertEquals(dockThread("messages"), null);
  assertEquals(dockThread(undefined), null);
});
