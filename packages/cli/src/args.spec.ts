/** Subject: how `kb exec` turns argv into one shell command. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { joinCommand, shellQuote, splitDoubleDash } from "./args.js";

describe("exec argument handling", () => {
  it("splits at the first -- so the command may itself contain --", () => {
    assert.deepEqual(splitDoubleDash(["k7", "--cwd", "x", "--", "rg", "--", "-l"]), { own: ["k7", "--cwd", "x"], rest: ["rg", "--", "-l"] });
    assert.deepEqual(splitDoubleDash(["k7"]), { own: ["k7"], rest: [] });
  });

  it("passes a single word through untouched, so quoting in the shell is preserved", () => {
    assert.equal(joinCommand(["git add -A && git commit -m 'x y'"]), "git add -A && git commit -m 'x y'");
  });

  it("quotes words that the sandbox shell would otherwise split or expand", () => {
    assert.equal(joinCommand(["rg", "-l", "nightly import", "topics/"]), "rg -l 'nightly import' topics/");
    assert.equal(shellQuote("it's"), `'it'\\''s'`);
    assert.equal(shellQuote("$HOME"), "'$HOME'");
    assert.equal(shellQuote("plain-word.md"), "plain-word.md");
  });
});
