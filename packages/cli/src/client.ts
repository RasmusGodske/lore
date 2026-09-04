import type { Readable } from "node:stream";
import type { components, paths } from "./generated/api.js";
import { CliError } from "./errors.js";

export type Session = components["schemas"]["SessionDto_Output"];
export type ExecResult = components["schemas"]["ExecResultDto_Output"];
export type Token = components["schemas"]["TokenDto_Output"];
export type CreatedToken = components["schemas"]["CreatedTokenDto_Output"];
export type User = components["schemas"]["UserDto_Output"];
export type Me = components["schemas"]["MeDto_Output"];
export type AuditEvent = components["schemas"]["AuditEventDto"];
type CreateSession = components["schemas"]["CreateSessionDto"];
type ExecBody = components["schemas"]["ExecDto"];
export type ApiPaths = paths;

const codeForStatus = (status: number, fallback: number): CliError["code"] => {
  if (status === 401 || status === 403) return 101;
  if (status === 404) return 102;
  if (status === 504) return 103;
  if (status === 400) return 104;
  return (fallback as CliError["code"]) ?? 100;
};

/** Thin typed client over the orchestrator's HTTP API. Nothing but fetch. */
export class LoreClient {
  constructor(private readonly url: string, readonly token: string) {}

  private async request<T>(method: string, path: string, init: { json?: unknown; body?: Readable; headers?: Record<string, string>; raw?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}`, ...init.headers };
    let body: BodyInit | undefined;
    if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
    if (init.body) { headers["content-type"] = "application/octet-stream"; body = readableToWeb(init.body); }
    let res: Response;
    try {
      res = await fetch(this.url + path, { method, headers, body, ...(init.body ? { duplex: "half" } as any : {}) });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code || cause?.message || (e as Error).message;
      throw new CliError(100, `connection error: could not reach orchestrator at ${this.url} (${detail})`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text; let code: number | undefined;
      try { const j = JSON.parse(text); message = j.error?.message ?? text; code = j.error?.code; } catch { /* not json */ }
      const code2 = codeForStatus(res.status, code ?? 100);
      throw new CliError(code2, code2 === 102 || code2 === 101 ? `${message} (server: ${this.url})` : message);
    }
    if (init.raw) return text as unknown as T;
    return (res.headers.get("content-type")?.startsWith("application/json") ? JSON.parse(text) : text) as T;
  }

  me() { return this.request<Me>("GET", "/me"); }
  guide() { return this.request<string>("GET", "/guide", { raw: true }); }

  createSession(body: CreateSession) { return this.request<Session>("POST", "/sessions", { json: body }); }
  listSessions(q: { all?: boolean; user?: string } = {}) {
    const params = new URLSearchParams();
    if (q.all) params.set("all", "true");
    if (q.user) params.set("user", q.user);
    const qs = params.toString();
    return this.request<Session[]>("GET", `/sessions${qs ? "?" + qs : ""}`);
  }
  getSession(id: string) { return this.request<Session>("GET", `/sessions/${encodeURIComponent(id)}`); }
  closeSession(id: string) { return this.request<Session>("DELETE", `/sessions/${encodeURIComponent(id)}`); }
  exec(id: string, body: ExecBody) { return this.request<ExecResult>("POST", `/sessions/${encodeURIComponent(id)}/exec`, { json: body }); }
  execStdin(id: string, command: string, stdin: Readable, opts: { cwd?: string; timeout_ms?: number } = {}) {
    const headers: Record<string, string> = { "x-lore-command": encodeURIComponent(command) };
    if (opts.cwd) headers["x-lore-cwd"] = opts.cwd;
    if (opts.timeout_ms) headers["x-lore-timeout-ms"] = String(opts.timeout_ms);
    return this.request<ExecResult>("POST", `/sessions/${encodeURIComponent(id)}/exec/stdin`, { body: stdin, headers });
  }
  sessionLog(id: string) { return this.request<string>("GET", `/sessions/${encodeURIComponent(id)}/log`, { raw: true }); }

  listTokens() { return this.request<Token[]>("GET", "/tokens"); }
  createToken(label: string) { return this.request<CreatedToken>("POST", "/tokens", { json: { label } }); }
  revokeToken(id: string) { return this.request<{ revoked: boolean }>("DELETE", `/tokens/${encodeURIComponent(id)}`); }

  listUsers() { return this.request<User[]>("GET", "/users"); }
  createUser(name: string, admin: boolean) { return this.request<User>("POST", "/users", { json: { name, admin } }); }
  mintTokenFor(user: string, label: string) { return this.request<CreatedToken>("POST", `/users/${encodeURIComponent(user)}/tokens`, { json: { label } }); }
}

function readableToWeb(r: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      r.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      r.on("end", () => controller.close());
      r.on("error", (e) => controller.error(e));
    },
    cancel() { r.destroy(); },
  });
}
