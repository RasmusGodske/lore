/** Subject: version comparison, the registry lookup and the daily nudge. Tier: isolated. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, fetchLatest, isStale, nudgeLine, updateNudge, ownVersion, type CheckState } from "./version.js";
import { performUpdate } from "./commands/update.js";

const fakeFetch = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("versions", () => {
  it("compares numerically, ignoring a v prefix and a prerelease suffix", () => {
    assert.ok(compareVersions("0.1.10", "0.1.9") > 0);
    assert.ok(compareVersions("v0.2.0", "0.1.99") > 0);
    assert.equal(compareVersions("1.0.0-beta", "1.0.0"), 0);
    assert.ok(compareVersions("0.1.9", "0.1.10") < 0);
  });
  it("reads its own version from package.json", () => {
    assert.match(ownVersion(), /^\d+\.\d+\.\d+/);
  });
  it("asks the registry for the latest dist-tag", async () => {
    assert.equal(await fetchLatest({ fetchImpl: fakeFetch(200, { version: "0.1.11" }), registry: "https://r" }), "0.1.11");
    await assert.rejects(fetchLatest({ fetchImpl: fakeFetch(503, {}), registry: "https://r" }), /503/);
  });
});

describe("the daily nudge", () => {
  const fresh: CheckState = { checked_at: new Date(1_000_000).toISOString(), latest: "0.1.11" };
  it("is stale after a day, or when there is no state", () => {
    assert.equal(isStale(null), true);
    assert.equal(isStale(fresh, 1_000_000 + 1000), false);
    assert.equal(isStale(fresh, 1_000_000 + 25 * 3600 * 1000), true);
  });
  it("says something only when the registry is ahead", () => {
    assert.equal(nudgeLine("0.1.10", "0.1.10"), null);
    assert.equal(nudgeLine("0.1.10", null), null);
    assert.match(nudgeLine("0.1.10", "0.1.11")!, /0\.1\.11 is available.*lore update/);
  });
  it("uses the cached answer inside the interval and does not touch the registry", async () => {
    let asked = 0;
    const line = await updateNudge("0.1.10", { now: 1_000_000 + 1000, read: () => fresh, write: () => {}, latest: async () => { asked++; return "9.9.9"; } });
    assert.equal(asked, 0);
    assert.match(line!, /0\.1\.11/);
  });
  it("refreshes when stale and stays silent when the registry is unreachable", async () => {
    const written: CheckState[] = [];
    const line = await updateNudge("0.1.10", { now: 5_000_000_000, read: () => fresh, write: (s) => written.push(s), latest: async () => "0.1.12" });
    assert.match(line!, /0\.1\.12/);
    assert.equal(written[0].latest, "0.1.12");
    assert.equal(await updateNudge("0.1.10", { read: () => null, write: () => {}, latest: async () => { throw new Error("offline"); } }), null);
  });
});

describe("lore update", () => {
  const deps = (latest: string, install?: (spec: string) => Promise<{ code: number; stderr: string }>) =>
    ({ current: () => "0.1.10", latest: async () => latest, install: install ?? (async () => ({ code: 0, stderr: "" })) });
  it("reports up to date without installing", async () => {
    let installed = false;
    const o = await performUpdate(false, deps("0.1.10", async () => { installed = true; return { code: 0, stderr: "" }; }));
    assert.equal(o.action, "up-to-date"); assert.equal(installed, false);
  });
  it("only checks with --check", async () => {
    const o = await performUpdate(true, deps("0.1.11"));
    assert.equal(o.action, "checked"); assert.equal(o.latest, "0.1.11");
  });
  it("installs the exact latest version with npm", async () => {
    const specs: string[] = [];
    const o = await performUpdate(false, deps("0.1.11", async (spec) => { specs.push(spec); return { code: 0, stderr: "" }; }));
    assert.equal(o.action, "updated"); assert.deepEqual(specs, ["@rasmusgodske/lore@0.1.11"]);
  });
  it("turns a permission failure into the sudo line, and passes npm's exit code through", async () => {
    const o = await performUpdate(false, deps("0.1.11", async () => ({ code: 243, stderr: "npm error EACCES: permission denied" })));
    assert.equal(o.action, "failed"); assert.equal(o.exit_code, 243);
    assert.match(o.hint!, /sudo npm install -g @rasmusgodske\/lore@0\.1\.11/);
  });
});
