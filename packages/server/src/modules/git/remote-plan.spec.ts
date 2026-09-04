/** Subject: how lore decides to follow the remote. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planRefresh, redactUrl } from "./remote-plan";

const A = "a".repeat(40), B = "b".repeat(40);
const ancestry = (map: Record<string, string[]>) => (x: string, y: string) => x === y || (map[y] ?? []).includes(x);

describe("remote refresh", () => {
  it("does nothing when both sides agree", () => {
    assert.deepEqual(planRefresh(A, A, ancestry({})), { kind: "none" });
  });
  it("fast-forwards local main when the remote is ahead (someone edited on the host)", () => {
    assert.deepEqual(planRefresh(A, B, ancestry({ [B]: [A] })), { kind: "fast-forward", to: B });
  });
  it("adopts lore's history when the remote is still empty", () => {
    assert.deepEqual(planRefresh(A, null, ancestry({})), { kind: "push-local", sha: A });
  });
  it("takes the remote when lore has nothing yet", () => {
    assert.deepEqual(planRefresh(null, B, ancestry({})), { kind: "fast-forward", to: B });
  });
  it("refuses to guess when both moved independently", () => {
    assert.deepEqual(planRefresh(A, B, ancestry({})), { kind: "diverged" });
  });
  it("never shows credentials embedded in the remote URL", () => {
    assert.equal(redactUrl("https://lore:ghp_secret@github.com/org/repo.git"), "https://github.com/org/repo.git");
  });
});
