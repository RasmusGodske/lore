# git

Hides the bare knowledge repository: creating and seeding it, installing the pre-receive and
post-receive hooks on every boot, cloning a workspace onto a session branch with the token-scoped
remote, snapshotting what a workspace would lose, fast-forwarding `main`, and keeping a browsable
read-only checkout of `main` at `<data>/main` current after every landing. Also owns the hook
itself (`hook.ts`, a standalone script run by git, whose rules are the pure functions in
`hook-rules.ts`) and the push lock that serializes receive-packs so the hook's check and the
landing cannot race.

Also owns the mirror: when `LORE_MIRROR_URL` is set, `MirrorService` pushes `main` to that remote
after every landing, on boot, and on a periodic sweep, with backoff on failure; the token goes to
git through a credential helper and never appears in a URL, a log, or the API. The `admin` module
exposes its state, attempt log, and a forced push. One-way only.

Public surface: `GitModule`, `GitRepoService`, `PushLockService`, `MirrorService`.

Invariants (spec 03): only `session/<own id>` may be pushed, never non-fast-forward, never a
delete, and only commits that already contain `main`; an accepted push lands on `main` in
post-receive. Content is never validated.
