# 02 — Session lifecycle

## Why everything is a session

Reads could technically bypass sessions, since concurrent reads cannot conflict. They do
not, for one reason: **audit**. If only some interactions create sessions, there is no
complete record of what agents accessed. Forcing every interaction through a session buys a
full picture of what was read, searched, written, and what failed, at the cost of a second
of setup.

That record is also intended to be useful later. Pointing an agent at accumulated session
logs and asking "how should we reorganise this knowledge base?" surfaces things like paths
that get guessed at repeatedly but never exist, or searches that consistently come back
empty. The knowledge base tells you how to restructure itself.

## States

```
  created ──► active ──► committing ──► closed
                 │            │
                 │            └──► conflict ──► active   (agent resolves, retries)
                 │
                 ├──► expired  (idle timeout, reaped)
                 └──► failed   (sandbox died, orchestrator error)
```

## Creating a session

The request carries a bearer token, which identifies the user and the named token behind
the call (see `04-interfaces.md`), plus an optional free-text `purpose`. All of it goes
into the session record and the audit log.

The orchestrator:

1. **Generates a session ID.** Short, URL-safe, unambiguous in a branch name. e.g. `k7m2xq`.
2. **Prepares the workspace** at `/srv/kb/sessions/<id>/` with a local `git clone` of the
   bare repo. Simple, fully self-contained, costs a copy — cheap enough for a markdown repo
   that `git worktree add` was not worth its shared state.
3. **Creates the session branch**: `session/<id>`, branched from current `main`.
4. **Mints a random per-session git token** and rewrites `origin` to
   `http://kb-orchestrator:8080/git/<git-token>/knowledge.git`. Only a hash of the token
   is stored (see `03-git-model.md`).
5. **Starts the sandbox container** with the workspace bind-mounted at `/workspace` and
   `KB_SESSION_ID` set.
6. **Inserts the session row** into `/srv/kb/kb.db`, including the client IP the request
   came from, and records a `create` audit event.
7. **Returns the session ID.**

The agent now has an ordinary git checkout at `/workspace`. It does not need to know it is
a branch of anything, or that a sandbox exists.

## Running commands

Every command the agent issues goes through one operation: execute a shell command in the
session's sandbox, scoped to `/workspace`.

Input: session ID, command string, optional working directory relative to `/workspace`,
optional timeout (default 60 s, maximum 10 minutes), optional stdin.
Output: stdout, stderr, exit code, duration. Returned output is capped at 1 MB.

Implementation is `docker exec` against that session's container, with the command wrapped
in coreutils `timeout`. No agent process inside the sandbox, no extra moving parts. A
command that hits its timeout is reported as a transport error (code 103 / HTTP 504, see
`04-interfaces.md`), not as a command failure.

**Bulk data goes in through stdin.** A file or an archive enters the workspace the way it
would on any Unix box, piped into a command:
`kb exec -- 'cat > topics/nightly-import/index.md' < index.md`, or
`tar -C docs -c . | kb exec -- 'tar -x -C talks'`. The CLI streams its own stdin to the
command whenever that stdin is not a terminal; the HTTP form is
`POST /sessions/{id}/exec/stdin` (see `04-interfaces.md`). This replaced a side door an
agent found during testing — `docker cp` into the sandbox from the host — which bypasses
the audit log and only works when the agent runs on the same machine as Docker: true on a
laptop, not on the VM.

Every invocation is appended to the session's audit log, stdin included, before the result
is returned.

There is no allowlist. `rg`, `ls`, `cat`, `mv`, `sed`, `python3`, `git`, pipes, `jq` all
work because they are in the sandbox image and the shell is real. The safety property comes
from the boundary, not from inspecting the command.

## Landing changes

The agent commits on its own branch and pushes. The orchestrator does not perform merges
and does not resolve conflicts. See `03-git-model.md` for the full mechanics; from the
session's point of view:

```bash
git add -A
git commit -m "Document nightly import job after incident review"
git push origin session/k7m2xq
```

A push that cannot fast-forward `main` is rejected by the server-side hook with a standard
git error. The agent does what any developer does: fetch, merge latest `main`, resolve
conflict markers in the files, push again. No custom conflict format, no orchestrator
involvement. An accepted push is fast-forwarded onto `main` by a `post-receive` hook, with
pushes serialized by the orchestrator so that step cannot race (see `03-git-model.md`).

## Ending a session

**Explicit close.** Agent signals it is done. Orchestrator stops and removes the container,
writes the workspace snapshot described below to the audit log, deletes the workspace, and
marks the session closed with `close_reason = explicit`.

**Idle timeout.** A reaper runs periodically (hourly is plenty) and closes any session with
no command activity for longer than the timeout, the same way, with `close_reason = idle`.
**24 hours** is the working default.

**On close and on reap, unpushed work is discarded.** Deliberate. If a session sat
untouched for a day, whatever was in progress was not going anywhere. Log what was lost —
a `git status` snapshot, a diffstat, and the list of unpushed commits written into the
audit log before deletion — so it is visible after the fact without keeping the data around.

**Workspaces.** Explicit close deletes the workspace immediately. The reaper also removes
any workspace still on disk for a session that has been closed, expired, or failed for
longer than the idle window; a failed session deliberately keeps its workspace until then so
the wreckage can be inspected.

Pushed branches are not deleted by the reaper. An unmerged `session/<id>` branch is a
legitimate state: work that exists but has not landed. Prune merged session branches
separately.

## Session record

One row in the `sessions` table of `/srv/kb/kb.db`. Rendered as JSON, which is what
`kb session list --json` and `GET /sessions/{id}` return:

```json
{
  "id": "k7m2xq",
  "state": "active",
  "branch": "session/k7m2xq",
  "container_id": "3f9a...",
  "workspace": "/srv/kb/sessions/k7m2xq",
  "user": "alice",
  "token_label": "claude-code-laptop",
  "created_ip": "10.0.0.5",
  "git_token_hash": "sha256:9c1e...",
  "created_at": "2026-09-03T09:14:22Z",
  "last_activity_at": "2026-09-03T09:31:05Z",
  "closed_at": null,
  "close_reason": null,
  "base_commit": "a1b2c3d",
  "metadata": {
    "purpose": "Work out why the nightly import skipped a run"
  }
}
```

`user` and `token_label` come from the bearer token that created the session and replace
any free-text actor field; `created_ip` is the client address the request came from
(`X-Forwarded-For` behind the reverse proxy on the VM); `purpose` stays free-text.
`close_reason` is one of `explicit`, `idle`, `failed`. The row lives in SQLite, not memory,
so the orchestrator survives a restart. On boot, reconcile every row against actual
container state and mark orphans failed.

## Audit log

Append-only `audit_events` table in `/srv/kb/kb.db`, one row per event, keyed by session.
Each row stores the operation, the acting user and token, the client IP (`X-Forwarded-For`
behind the reverse proxy on the VM), exit code, duration, full byte counts, and the first
64 KB of stdin, stdout and stderr, with a `truncated` flag when any stream exceeded that.
Binary stdin (a tar stream) is noted as `<binary, N bytes>` rather than stored.
`kb session log --json` and `GET /sessions/{id}/log` render it as one JSON object per line:

```json
{"ts":"2026-09-03T09:15:01Z","session":"k7m2xq","op":"exec","user_id":"3f2c","token_id":"9b7e","ip":"10.0.0.5","cmd":"rg -l 'nightly import' topics/","exit":0,"ms":34,"stdout_bytes":128}
{"ts":"2026-09-03T09:15:40Z","session":"k7m2xq","op":"exec","user_id":"3f2c","token_id":"9b7e","ip":"10.0.0.5","cmd":"cat topics/nightly-import/schedule.md","exit":1,"ms":8,"stderr":"cat: topics/nightly-import/schedule.md: No such file or directory"}
{"ts":"2026-09-03T09:15:58Z","session":"k7m2xq","op":"exec","user_id":"3f2c","token_id":"9b7e","ip":"10.0.0.5","cmd":"tar -x -C talks","exit":0,"ms":41,"stdin_bytes":204800,"stdin":"<binary, 204800 bytes>"}
{"ts":"2026-09-03T09:16:12Z","session":"k7m2xq","op":"push","user_id":"3f2c","token_id":"9b7e","ip":"10.0.0.5","branch":"session/k7m2xq","result":"rejected","reason":"non-fast-forward"}
```

Record failures as carefully as successes. Failed reads and empty searches are the most
informative signal about structural gaps in the knowledge base.

Output beyond the first 64 KB per stream is not kept; the byte counts and the `truncated`
flag record that it existed. Push events are recorded by the orchestrator itself, since
every push passes through its git endpoint (see `03-git-model.md`).

**OPEN** — retention. Audit logs are small (text) and their value is cumulative, so
indefinite retention is the assumed default.

## Concurrency

Two sessions editing the same file is expected to be rare at current team size, but the
design handles it rather than assuming it away. Each session has its own workspace and its
own branch, so they never interfere while working. The only interaction point is the push,
and git resolves it there. No locking anywhere.
