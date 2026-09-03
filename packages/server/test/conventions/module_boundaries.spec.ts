/**
 * Rule about the codebase, never boots the application:
 *   1. every module under src/modules has a README.md and an index.ts (its public surface);
 *   2. no file imports another module's internals — cross-module imports end at the module root;
 *   3. no junk-drawer directories (common, util, helpers, shared, misc) exist in src.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");
const MODULES = path.join(SRC, "modules");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const sourceFiles = walk(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
const modules = fs.readdirSync(MODULES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

describe("module boundaries", () => {
  it("every module has a README.md and an index.ts", () => {
    for (const m of modules) {
      assert.ok(fs.existsSync(path.join(MODULES, m, "README.md")), `${m} has no README.md`);
      assert.ok(fs.existsSync(path.join(MODULES, m, "index.ts")), `${m} has no index.ts`);
    }
  });

  it("no file imports another module's internals", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        const rel = path.relative(MODULES, target);
        if (rel.startsWith("..")) continue; // outside modules (root glue), not governed here
        const [targetModule, ...rest] = rel.split(path.sep);
        const fileModule = path.relative(MODULES, file).split(path.sep)[0];
        const insideSameModule = !path.relative(MODULES, file).startsWith("..") && fileModule === targetModule;
        if (!insideSameModule && rest.length > 0) offenders.push(`${path.relative(SRC, file)} -> ${m[1]}`);
      }
    }
    assert.deepEqual(offenders, [], "imports must go through the other module's index:\n" + offenders.join("\n"));
  });

  it("has no junk-drawer directories", () => {
    const banned = new Set(["common", "util", "utils", "helpers", "shared", "misc"]);
    const found = walk(SRC).map((f) => path.relative(SRC, path.dirname(f))).flatMap((d) => d.split(path.sep)).filter((seg) => banned.has(seg));
    assert.deepEqual([...new Set(found)], []);
  });

  it("modules do not form import cycles at the module level", () => {
    const edges = new Map<string, Set<string>>();
    for (const file of sourceFiles.filter((f) => !path.relative(MODULES, f).startsWith(".."))) {
      const from = path.relative(MODULES, file).split(path.sep)[0];
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
        const rel = path.relative(MODULES, path.resolve(path.dirname(file), m[1]));
        if (rel.startsWith("..")) continue;
        const to = rel.split(path.sep)[0];
        if (to !== from) (edges.get(from) ?? edges.set(from, new Set()).get(from)!).add(to);
      }
    }
    const visiting = new Set<string>(); const done = new Set<string>(); const cycles: string[] = [];
    const visit = (n: string, trail: string[]) => {
      if (done.has(n)) return;
      if (visiting.has(n)) { cycles.push([...trail, n].join(" -> ")); return; }
      visiting.add(n);
      for (const next of edges.get(n) ?? []) visit(next, [...trail, n]);
      visiting.delete(n); done.add(n);
    };
    for (const n of modules) visit(n, []);
    assert.deepEqual(cycles, []);
  });
});
