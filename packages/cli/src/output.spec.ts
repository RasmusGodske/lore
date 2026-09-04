/** Subject: the human rendering of `lore session log`. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAuditEvent } from "./output.js";

describe("audit log rendering", () => {
  it("shows a command with its exit code, timing, and indented output", () => {
    const line = formatAuditEvent({ ts: "2026-09-03T09:15:01.000Z", op: "exec", cmd: "cat x.md", exit: 1, ms: 8, stderr: "cat: x.md: No such file\n", ip: "10.0.0.5" });
    assert.match(line, /^2026-09-03 09:15:01Z \[10\.0\.0\.5\] \$ cat x\.md\n  exit 1  8ms\n  ! cat: x\.md: No such file$/);
  });

  it("shows a push with the movement of main", () => {
    const line = formatAuditEvent({ ts: "2026-09-03T09:16:12Z", op: "push", branch: "session/k7", result: "accepted", main_before: "a1b2c3d4e5", main_after: "f6e5d4c3b2" });
    assert.equal(line, "2026-09-03 09:16:12Z push session/k7: accepted  main a1b2c3d -> f6e5d4c");
  });

  it("shows what a close discarded", () => {
    const line = formatAuditEvent({ ts: "2026-09-03T09:20:00Z", op: "close", reason: "closed by caller", unpushed: "abc1234 draft\n" });
    assert.match(line, /session closed: closed by caller\nunpushed commits:\n    abc1234 draft$/);
  });
});
