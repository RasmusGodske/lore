# 04 — Interfaces

## One core, three skins

The same small set of operations is exposed three ways, because different callers can do
different things:

- **MCP** — agents that speak it natively (Claude Code, Cursor, and most others). The
  common case: agents connect over remote MCP (streamable HTTP) with a bearer token.
- **HTTP API** — anything programmatic, and any environment that cannot do MCP. This is
  what makes the system usable from a Slack agent, a webhook handler, or a script.
- **CLI** — one binary, `lore`: a first-class interface for humans and for agents that have
  a shell, and a thin client over the HTTP API. What a caller may do is decided by its
  token, not by which commands exist.

These are not three systems. Build the operations once as a library; the HTTP API and the
MCP endpoint are two routes on the same process over it, and the CLI calls the HTTP API.

```
        ┌─────────┐
        │   CLI   │────── HTTP ──────┐
        └─────────┘                  │
                        ┌────────────▼─┐   ┌─────────┐
                        │   HTTP API   │   │   MCP   │   two routes,
                        └──────┬───────┘   └────┬────┘   one process
                               └────────┬───────┘
                                 ┌──────▼───────┐
                                 │ core library │
                                 └──────┬───────┘
                          ┌─────────────▼────────────┐
                          │ dockerode · git · SQLite │
                          └──────────────────────────┘
```

## Identity and auth

**Users** have a name and an admin flag. Only admins create users; the very first admin
and its token are created with `lore-admin` inside the orchestrator container, which talks to
the database directly. A bot that belongs to nobody is a user with no login, only tokens.

**Tokens** belong to a user and carry a label (`claude-code-laptop`, `slack-agent`). Users
mint their own tokens; an admin may also mint one for any user (`POST /users/{id}/tokens`,
`lore user token <user> <label>`), which is how a new user gets their first token. Every HTTP
API and MCP request carries one as `Authorization: Bearer <token>`; only a hash is stored.

**Permissions** are the admin flag plus ownership, nothing else. Every token may create
sessions, list and show any session, and read any audit log. Running commands in a session
or closing it is allowed only for its owner — the user behind the token that created it —
or an admin; anyone else gets 403 (transport code 101). Managing users, and other people's
tokens, is admin-only.

A session records which user, which token and which client IP created it. That replaces any
free-text actor field; `purpose` stays free-text. Per-session git tokens are a separate,
narrower credential (see `03-git-model.md`).

## Operations

The surface is deliberately tiny. Everything else the agent needs, it gets from the shell
inside the sandbox.

| Operation | Purpose |
|---|---|
| `session create` | Provision workspace + sandbox. Returns session ID. |
| `session close` | Tear down. Owner or admin. |
| `session list`, `session show` | Sessions and their state. |
| `session log` | Audit log for a session. |
| `exec` | Run a shell command in a session's sandbox, optionally with stdin. Owner or admin. |
| `me`, `token create/list/revoke` | Who am I; my own tokens. |
| `user create/list/token` | Administration. Admin only; CLI and HTTP, not MCP. |

There is no `read_file`, `write_file`, `search`, or `move`. Those are `cat`, a redirect,
`rg`, and `mv`, run through `exec`. Adding them would be reimplementing the shell, worse.

Committing and pushing are also just `exec` — the agent runs `git` itself. There is no
`commit` operation, because git already is one.

## CLI

The CLI must behave like an ordinary Unix program, because the agent will pipe it into
things. Concretely: results on stdout, diagnostics on stderr, meaningful exit codes, no
interactive prompts, machine-readable output available.

```bash
lore login http://host:8080 --token <token>   # writes ~/.config/lore/config.json
lore me                                       # LORE_URL and LORE_TOKEN override the file

lore session create --purpose "Why did the nightly import skip a run?"
# k7m2xq

lore exec k7m2xq -- rg -l 'nightly import' topics/
lore exec k7m2xq --cwd topics/nightly-import --timeout 5000 -- cat index.md
export LORE_SESSION=k7m2xq                    # the ID may then be omitted
lore exec -- 'cat > topics/nightly-import/index.md' < index.md
tar -C docs -c . | lore exec -- 'tar -x -C talks'

lore session list --json | jq -r '.[] | select(.state=="active") | .id'
lore session log k7m2xq --json | jq 'select(.exit != 0)'
lore session close k7m2xq

lore token create --label slack-agent         # my own tokens: create | list | revoke
lore user create bot && lore user token bot slack   # admin: users, and anyone's tokens
```

`lore exec` streams its stdin to the command whenever stdin is not a terminal, which is how
bulk data — a file, a tar stream — gets into a workspace (`02-session-lifecycle.md`). The
session ID may be omitted when `LORE_SESSION` is set; nothing is persisted as a "current
session", so two shells never fight over one.

Output is JSON when stdout is not a terminal and tables (for `session log`, a readable
transcript) when it is; `--json` forces JSON. Because it is well-behaved, it composes: an
agent with bash and an authenticated `lore` on its PATH can pipe `lore` output into `jq`,
`grep`, `xargs`, or its own scripts, without any of that being designed for.

## HTTP API

Same operations. Sketch:

```
GET    /me                        -> {user, token, admin}
POST   /sessions                  -> {id, state, branch}
GET    /sessions                  -> [...]
GET    /sessions/{id}             -> {...}
DELETE /sessions/{id}                (owner or admin)
POST   /sessions/{id}/exec        -> {stdout, stderr, exit_code, duration_ms}  (owner or admin)
POST   /sessions/{id}/exec/stdin  -> same; the body is the command's stdin
GET    /sessions/{id}/log         -> JSONL
POST   /tokens, GET /tokens, DELETE /tokens/{id}       own tokens
POST   /users, GET /users, POST /users/{id}/tokens     admin only
GET    /docs, /docs/openapi.json  -> Swagger UI and the OpenAPI document
POST   /mcp                       -> MCP over streamable HTTP (below)
*      /git/{git-token}/knowledge.git/*  -> git smart HTTP, sandboxes only (03-git-model.md)
```

`exec` takes `{command, cwd?, timeout_ms?}`; default 60 s, maximum 10 minutes, returned
output capped at 1 MB. `exec/stdin` is the same operation for bulk input: an
`application/octet-stream` body that becomes the command's stdin, with the command
percent-encoded in the `x-lore-command` header and `x-lore-cwd` / `x-lore-timeout-ms` for the
rest. A command that hits its timeout is a 504; a malformed request is a 400; exec or close
on a session you do not own is a 403. Long-running commands would otherwise need streaming;
a timeout with a clear error is simpler and sufficient. The full contract is the OpenAPI
document at `/docs/openapi.json`, committed as `openapi.json`; the CLI's types are generated
from it.

Authentication: bearer token on every request (see above), except the git route, which is
authenticated by the git token in its path. No TLS in the first build; do not expose port
8080 beyond the internal network until there is.

## MCP server

Served at `/mcp` over streamable HTTP by the official `@modelcontextprotocol/sdk`, in the
same process as the API. Agents connect directly with a bearer token; there is no local
stdio bridge in the first version:

```bash
claude mcp add --transport http lore http://host:8080/mcp \
  --header "Authorization: Bearer <token>"
```

Four tools:

| Tool | Arguments |
|---|---|
| `lore_session_create` | `purpose?` — returns the session ID |
| `lore_session_list` | — |
| `lore_session_close` | `session_id` |
| `lore_shell` | `session_id`, `command`, `cwd?`, `timeout_ms?` |

**Sessions are explicit.** An earlier draft folded session creation into first use, one
session per MCP connection, on the grounds that an agent will forget to call create. It was
dropped: one connection may drive several sessions, sessions must be attributable, and a
lazily created session has no purpose. The forgetting risk is real and is
covered by the idle reaper (`02-session-lifecycle.md`): an unclosed session costs one idle
container for at most the idle timeout.

**Name the exec tool for what it is.** Something like `lore_shell` with a description making
clear it is a real shell in a sandboxed checkout of the knowledge base, that `/workspace` is
a git repo, and that landing changes means committing and pushing. Tool calls carry no
stdin, so the description also points agents that have a shell at the `lore` CLI for bulk
transfers. The description is where the agent learns the workflow.

Alongside the tools, ship the working instructions — what to write, when, where things go —
as documented in `05-knowledge-format.md`. Those matter more than the tool surface.

### `lore mcp`: the stdio bridge

Some MCP clients cannot reach a remote HTTP server, or cannot attach a header to it, and every
client that can still needs the URL and the token pasted into its own configuration. The CLI
therefore also speaks MCP over stdio: `lore mcp` reads JSON-RPC messages on stdin, sends each
one to the logged-in server's `/mcp` with the saved token, and writes the replies to stdout,
unwrapping server-sent events where the server streams. It defines no tools of its own; the
server remains the single place the tool surface is declared. Registering it is one line with
nothing secret in it: `claude mcp add lore -- lore mcp`. The HTTP endpoint stays for callers
without a shell.

## Errors: two vocabularies

An agent must be able to tell "the command I ran failed" from "the system running my
commands failed", because the correct response differs completely. A missing file means try
a different path. A dead connection means retry or escalate; trying different paths will
never help.

### Command failures pass through untouched

If the shell command itself fails, return its exit code and stderr verbatim.

```
$ lore exec k7m2xq -- cat topics/nightly-import/nope.md
cat: topics/nightly-import/nope.md: No such file or directory
$ echo $?
1
```

Do not wrap, reformat, or annotate. The agent already knows what this means.

### Transport failures are distinctly marked

If the request never reached the sandbox — orchestrator unreachable, session gone, auth
rejected, timeout — that is a different class, and gets a reserved exit code plus an
unmistakable stderr prefix.

| Code | Meaning |
|---|---|
| 100 | Connection error — could not reach the orchestrator |
| 101 | Authentication failed, or not permitted (not the session's owner) |
| 102 | Session not found or expired |
| 103 | Timeout — including a command that hit its timeout inside the sandbox |
| 104 | Bad request — malformed call |

```
$ lore exec k7m2xq -- ls
lore: connection error: could not reach orchestrator at lore-server:8080
$ echo $?
100
```

Two things distinguish these, deliberately, because either alone is imperfect. The exit
codes sit above the range real commands use in practice, but nothing stops some program from
returning 100 legitimately. The `lore:` stderr prefix disambiguates: transport errors always
carry it, and passed-through command errors never do. An agent (or a script) can key on
either.

Corollary: **the CLI must never print `lore:`-prefixed lines for anything but its own
failures.** Use a different prefix or stdout for ordinary chatter.

### HTTP equivalents

Transport failures are HTTP errors with a structured body: 401 and 403 for code 101, 404
for 102, 504 for 103, 400 for 104, any other 5xx for 100. A command that ran and exited non-zero is
HTTP **200** with `exit_code` set — the API call succeeded; the command inside it did not.
Conflating those is the same mistake in a different shape.
