/**
 * Subject: the push rules the pre-receive hook enforces (spec 03-git-model.md).
 * Tier: isolated. The git calls are injected, so this runs with no repository.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPush, planLanding, ZERO_SHA, type RefUpdate } from "./hook-rules";

const MAIN = "m".repeat(40);
const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const own = (overrides: Partial<RefUpdate> = {}): RefUpdate => ({ oldSha: OLD, newSha: NEW, ref: "refs/heads/session/k7m2xq", ...overrides });

/** A fake ancestry: `descends[x]` lists the shas x descends from. */
function ancestry(descends: Record<string, string[]>) {
  return (ancestor: string, descendant: string) => ancestor === descendant || (descends[descendant] ?? []).includes(ancestor);
}
const happy = ancestry({ [NEW]: [OLD, MAIN] });

describe("pre-receive rules", () => {
  it("refuses a push with no session identity", () => {
    const v = checkPush({ session: "", updates: [own()], main: MAIN, isAncestor: happy });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /no session identity/);
  });

  it("rule 1: main is not writable, and the message names the session branch to use", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own({ ref: "refs/heads/main" })], main: MAIN, isAncestor: happy });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /refs\/heads\/session\/k7m2xq/);
  });

  it("rule 2: a session may not push another session's branch", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own({ ref: "refs/heads/session/other1" })], main: MAIN, isAncestor: happy });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /may not push to 'refs\/heads\/session\/other1'/);
  });

  it("rule 3: rewriting the session branch is rejected and the remedy says merge, never rebase", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own()], main: MAIN, isAncestor: ancestry({ [NEW]: [MAIN] }) });
    assert.equal(v.ok, false);
    assert.match(v.messages.join(" "), /non-fast-forward/);
    assert.match(v.messages.join(" "), /git merge origin\/main/);
    assert.doesNotMatch(v.messages.join(" "), /rebase/);
  });

  it("rule 3: deleting the session branch is rejected", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own({ newSha: ZERO_SHA })], main: MAIN, isAncestor: happy });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /deleting/);
  });

  it("rule 4: a commit that does not contain current main is rejected with the merge instructions", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own()], main: MAIN, isAncestor: ancestry({ [NEW]: [OLD] }) });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /behind main/);
    assert.match(v.messages[1], /git fetch origin && git merge origin\/main/);
  });

  it("accepts the first push of a branch (old sha all zeros) when it contains main", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own({ oldSha: ZERO_SHA })], main: MAIN, isAncestor: ancestry({ [NEW]: [MAIN] }) });
    assert.equal(v.ok, true);
    assert.deepEqual(v.messages, ["accepted refs/heads/session/k7m2xq."]);
  });

  it("accepts a fast-forward of the session branch that contains main", () => {
    assert.equal(checkPush({ session: "k7m2xq", updates: [own()], main: MAIN, isAncestor: happy }).ok, true);
  });

  it("refuses when the repository has no main branch", () => {
    const v = checkPush({ session: "k7m2xq", updates: [own()], main: null, isAncestor: happy });
    assert.equal(v.ok, false);
    assert.match(v.messages[0], /no main branch/);
  });
});

describe("post-receive landing", () => {
  it("fast-forwards main to the pushed commit", () => {
    assert.deepEqual(planLanding(own(), MAIN, happy), { kind: "fast-forward", from: MAIN, to: NEW });
  });
  it("does nothing when main already is the pushed commit", () => {
    assert.deepEqual(planLanding(own({ newSha: MAIN }), MAIN, happy), { kind: "skip" });
  });
  it("ignores refs that are not session branches", () => {
    assert.deepEqual(planLanding(own({ ref: "refs/tags/v1" }), MAIN, happy), { kind: "skip" });
  });
  it("warns instead of landing if main moved under the push (the push lock is what prevents this)", () => {
    const plan = planLanding(own(), MAIN, ancestry({ [NEW]: [OLD] }));
    assert.equal(plan.kind, "warn");
  });
});
