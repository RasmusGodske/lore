# sessions

Hides the session lifecycle (spec 02): a session is a row, a workspace cloned from `main` on its
own branch, and a sandbox container; commands run in it through `docker exec`; it ends by explicit
close, idle reap, or failure. Owns the two entry points a session has: the HTTP/MCP-facing
operations (`SessionsController`) and the git smart HTTP endpoint the sandbox pushes to
(`GitHttpController`), which maps the per-session token in the URL to a session id for the hook.

Public surface: `SessionsModule`, `SessionsService` (create, get, list, exec, close, reapIdle,
reconcile, byGitToken, touch) and the `SessionDto`/`ExecResultDto` shapes.

Invariants: only the owner or an admin may exec into or close a session; everyone may read any
session and its log. A command's non-zero exit is a normal result. Unpushed work is discarded on
close and reap, after its shape is written to the audit log.
