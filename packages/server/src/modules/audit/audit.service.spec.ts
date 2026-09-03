/**
 * Subject: the audit event wire format (`kb session log`), a pure rendering of a row.
 * Tier: isolated.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditService, type AuditRow } from "./audit.service";

const row = (overrides: Partial<AuditRow>): AuditRow => ({
  id: 1, session_id: "k7m2xq", ts: "2026-09-03T09:15:01.000Z", op: "exec",
  user_id: "u1", token_id: "t1", remote_ip: "10.0.0.5",
  cmd: null, cwd: null, exit_code: null, duration_ms: null,
  stdin_bytes: null, stdout_bytes: null, stderr_bytes: null,
  stdin_head: null, stdout_head: null, stderr_head: null, truncated: 0, extra: null,
  ...overrides,
});

describe("audit event rendering", () => {
  it("renders an exec with the fields the spec shows and omits what is null", () => {
    const e = AuditService.toEvent(row({ cmd: "rg -l 'import' topics/", exit_code: 0, duration_ms: 34, stdout_bytes: 128, stdout_head: "x" }));
    assert.deepEqual(e, { ts: "2026-09-03T09:15:01.000Z", session: "k7m2xq", op: "exec", user_id: "u1", token_id: "t1", ip: "10.0.0.5", cmd: "rg -l 'import' topics/", exit: 0, ms: 34, stdout_bytes: 128, stdout: "x" });
  });

  it("keeps a failed read's stderr, which is the signal the spec cares about", () => {
    const e = AuditService.toEvent(row({ cmd: "cat nope.md", exit_code: 1, stderr_bytes: 40, stderr_head: "cat: nope.md: No such file or directory\n" }));
    assert.equal(e.exit, 1);
    assert.equal(e.stderr, "cat: nope.md: No such file or directory\n");
  });

  it("spreads push details from extra onto the event", () => {
    const e = AuditService.toEvent(row({ op: "push", extra: JSON.stringify({ branch: "session/k7m2xq", result: "rejected" }) }));
    assert.equal(e.branch, "session/k7m2xq");
    assert.equal(e.result, "rejected");
  });

  it("marks truncated output", () => {
    assert.equal(AuditService.toEvent(row({ truncated: 1 })).truncated, true);
    assert.equal("truncated" in AuditService.toEvent(row({})), false);
  });

  it("emits one JSON object per line", () => {
    const out = AuditService.toJsonl([row({}), row({ id: 2 })]);
    const lines = out.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[2], "");
    for (const l of lines.slice(0, 2)) JSON.parse(l);
  });
});
