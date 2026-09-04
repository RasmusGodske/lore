/** Subject: the mirror's pure decisions. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactUrl, retryDelayMs } from "./mirror-plan";

describe("mirror", () => {
  it("never shows credentials embedded in the remote URL", () => {
    assert.equal(redactUrl("https://lore:ghp_secret@github.com/org/repo.git"), "https://github.com/org/repo.git");
    assert.equal(redactUrl("https://github.com/org/repo.git"), "https://github.com/org/repo.git");
    assert.equal(redactUrl("not a url"), "<invalid url>");
  });
  it("backs off exponentially from one minute and caps at fifteen", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => retryDelayMs(n) / 60_000), [1, 2, 4, 8, 15, 15]);
  });
});
