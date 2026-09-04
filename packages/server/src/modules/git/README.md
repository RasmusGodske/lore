# git

Hides the bare knowledge repository: creating and seeding it, installing the pre-receive and
post-receive hooks on every boot, cloning a workspace onto a session branch with the token-scoped
remote, snapshotting what a workspace would lose, fast-forwarding `main`, and keeping a browsable
read-only checkout of `main` at `<data>/main` current after every landing. Also owns the hook
itself (`hook.ts`, a standalone script run by git, whose rules are the pure functions in
`hook-rules.ts`) and the push lock that serializes receive-packs so the hook's check and the
landing cannot race.

Also owns the remote: when `LORE_REMOTE_URL` is set, that repository is the source of truth.
`RemoteService` keeps local `main` in step with it (boot, before a session starts, when a
sandbox fetches, a periodic sweep, on request), never forcing anything and reporting divergence
instead. The hook lands on the remote itself: fetch, check the rules against the remote's
`main`, push, then accept. The token goes to git through a credential helper and never appears
in a URL, a log, or the API.

Public surface: `GitModule`, `GitRepoService`, `PushLockService`, `MirrorService`.

Invariants (spec 03): only `session/<own id>` may be pushed, never non-fast-forward, never a
delete, and only commits that already contain `main`; an accepted push lands on `main` in
post-receive. Content is never validated.
