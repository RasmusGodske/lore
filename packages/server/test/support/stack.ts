/**
 * Scaffolding for the "stack" tier: tests that drive a running orchestrator over HTTP,
 * with real Docker sandboxes and a real repository. A test file declares the tier by calling
 * `stackTier()`; absent LORE_TEST_URL and LORE_TEST_ADMIN_TOKEN it returns null and the file skips,
 * so `npm test` stays cheap. `npm run test:stack` runs them against the local compose stack.
 */
import { randomBytes } from "node:crypto";

export interface Stack { url: string; adminToken: string }

export function stackTier(): Stack | null {
  const url = process.env.LORE_TEST_URL;
  const adminToken = process.env.LORE_TEST_ADMIN_TOKEN;
  return url && adminToken ? { url: url.replace(/\/$/, ""), adminToken } : null;
}
export const skipReason = "stack tier: set LORE_TEST_URL and LORE_TEST_ADMIN_TOKEN (npm run test:stack)";

export interface Reply { status: number; json: any; text: string }

export class Api {
  constructor(readonly url: string, readonly token: string) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: Buffer): Promise<Reply> {
    const res = await fetch(this.url + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(raw ? { "content-type": "application/octet-stream" } : {}),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  }

  exec(id: string, command: string, opts: { cwd?: string; timeout_ms?: number } = {}) {
    return this.call("POST", `/sessions/${id}/exec`, { command, ...opts });
  }
  execStdin(id: string, command: string, stdin: Buffer) {
    return this.call("POST", `/sessions/${id}/exec/stdin`, undefined, { "x-lore-command": encodeURIComponent(command) }, stdin);
  }
  async createSession(purpose: string): Promise<string> {
    const r = await this.call("POST", "/sessions", { purpose });
    if (r.status !== 201) throw new Error(`session create failed: ${r.text}`);
    return r.json.id;
  }
  close(id: string) { return this.call("DELETE", `/sessions/${id}`); }
}

/** A throwaway user with its own token, so tests never share identities. */
export async function freshUser(stack: Stack, opts: { admin?: boolean } = {}): Promise<{ api: Api; name: string; userId: string }> {
  const admin = new Api(stack.url, stack.adminToken);
  const name = `t-${randomBytes(3).toString("hex")}`;
  const user = await admin.call("POST", "/users", { name, admin: !!opts.admin });
  if (user.status !== 201) throw new Error(`could not create test user: ${user.text}`);
  const token = await admin.call("POST", `/users/${user.json.id}/tokens`, { label: "test" });
  if (token.status !== 201) throw new Error(`could not mint test token: ${token.text}`);
  return { api: new Api(stack.url, token.json.token), name, userId: user.json.id };
}
