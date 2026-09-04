# 03 — Git model

## Why git is the interface

Git is not just storage here. It is deliberately the *interface* an agent uses to land
changes, because agents are already fluent in it. `! [rejected] main -> main
(non-fast-forward)` needs no explanation, and the remedy — fetch, merge, resolve conflict
markers, push again — is something the agent has done thousands of times in training.

The mental model to hold: **the agent is a junior developer on a repository with a
protected main branch.** It works on its own branch, it cannot rewrite history, it cannot
push straight to `main`, and it is its own responsibility to arrive at something mergeable.
Reviewers do not fix your conflicts; you do.

This replaces an earlier idea of having the orchestrator diff raw file trees and hand the
agent two versions of a file to reconcile. That would work, and it avoids git internals
entirely, but it invents a bespoke conflict format where a universally understood one
already exists.

## Repository layout

**One bare repository** at `/srv/lore/knowledge.git`. This is the permanent source of truth.
It is not mounted into any sandbox.

Branches:

- `main` — the knowledge base. Protected.
- `session/<id>` — one per session. The only branch that session may write.

## Git smart HTTP

There is no separate git server. The orchestrator serves the bare repo itself over git's
smart HTTP protocol, by spawning git's built-in `git http-backend` as a CGI process for
every request under `/git/<git-token>/knowledge.git/`. No extra software, no extra port.

For each request the orchestrator validates the token, maps it to its session, and runs
`http-backend` with the standard CGI variables plus:

```
GIT_PROJECT_ROOT=/srv/lore
GIT_HTTP_EXPORT_ALL=1
PATH_INFO=/knowledge.git/<rest of path>
REMOTE_USER=<session-id>
```

`http-backend` permits push whenever `REMOTE_USER` is set, so no `http.receivepack`
configuration is needed, and it passes `REMOTE_USER` through to `receive-pack` and so to
the hook. Everything that constrains what a push may do lives in the `pre-receive` hook.

The orchestrator **serializes pushes**: every `git-receive-pack` POST runs under a single
in-process lock, so only one push is being checked and landed at any time. Fetches are not
locked. This is what makes landing on `main` race-free (see below), and it is cheap because
every push passes through this route anyway.

This is the trade against running Gitea or similar. Gitea would provide branch protection,
pull requests, and a web UI as configuration. The rules we need fit in a short script, so
the lighter option wins. If the rule set grows complicated, revisit.

Because every push passes through the orchestrator, it records push events — accepted or
rejected, with the hook's stderr — in the audit log directly, and writes that row before
the push response completes, so a `session log` read straight after a push already shows it.

### Identity

Each session gets a random git token at creation; the sandbox's `origin` remote is
`http://lore-server:8080/git/<git-token>/knowledge.git`. The orchestrator stores only a
hash of the token, maps it to the session ID, and sets that ID as `REMOTE_USER`. The hook
reads `$REMOTE_USER`. A token is dead once its session closes.

Token-in-URL is weaker than SSH with one key per session, and adequate: all sessions are
our own agents, the token is unguessable, and it is reachable only on the internal network.

## The pre-receive hook

Lives at `/srv/lore/knowledge.git/hooks/pre-receive`. Runs on the receiving side. **The agent
cannot read, edit, or disable it** — it is not in the workspace and not reachable from the
sandbox. This is the entire enforcement layer.

The shipped hook is `packages/server/src/modules/git/hook.ts` (rules in `hook-rules.ts`,
unit-tested), installed by the orchestrator on every boot as a shell shim under `hooks/`
(it runs inside the orchestrator container, where Node exists). The bash listing below is
the reference for what it enforces.

It receives, on stdin, one line per ref being updated: `<old-sha> <new-sha> <ref-name>`.
Exit non-zero and the whole push is rejected; anything written to stderr is shown to the
pusher, so error messages should be written for an agent to act on.

```bash
#!/usr/bin/env bash
set -euo pipefail

SESSION="${REMOTE_USER:-}"
ZERO="0000000000000000000000000000000000000000"

if [[ -z "$SESSION" ]]; then
  echo "lore: no session identity on this push; refusing." >&2
  exit 1
fi

while read -r oldsha newsha ref; do

  # 1. Only session branches may be pushed. No direct writes to main.
  if [[ "$ref" != "refs/heads/session/"* ]]; then
    echo "lore: '$ref' is not writable. Push to refs/heads/session/$SESSION instead." >&2
    exit 1
  fi

  # 2. A session may only push its own branch, and may not delete it.
  if [[ "$ref" != "refs/heads/session/$SESSION" ]]; then
    echo "lore: session '$SESSION' may not push to '$ref'." >&2
    exit 1
  fi
  if [[ "$newsha" == "$ZERO" ]]; then
    echo "lore: branch deletion is not permitted." >&2
    exit 1
  fi

  # 3. No history rewriting: new commit must descend from old.
  if [[ "$oldsha" != "$ZERO" ]]; then
    if ! git merge-base --is-ancestor "$oldsha" "$newsha"; then
      echo "lore: non-fast-forward push rejected; do not rewrite history." >&2
      echo "lore: run: git fetch origin && git merge origin/session/$SESSION, then push again." >&2
      exit 1
    fi
  fi

  # 4. Must contain current main.
  MAIN=$(git rev-parse refs/heads/main)
  if ! git merge-base --is-ancestor "$MAIN" "$newsha"; then
    echo "lore: your branch is behind main and would not fast-forward." >&2
    echo "lore: run: git fetch origin && git merge origin/main" >&2
    echo "lore: resolve any conflicts, commit, and push again." >&2
    exit 1
  fi

  echo "lore: accepted $ref." >&2

done

exit 0
```

Rule 4 is the important one. Requiring the session branch to contain current `main` as an
ancestor means the agent must integrate other people's changes before landing, which is
precisely where conflicts surface, in the agent's own workspace, with normal conflict
markers.

### Landing on main

Once `pre-receive` has accepted the push, a `post-receive` hook fast-forwards `main` to the
pushed commit:

```bash
#!/usr/bin/env bash
set -euo pipefail
while read -r oldsha newsha ref; do
  git update-ref refs/heads/main "$newsha" "$(git rev-parse refs/heads/main)"
  echo "lore: landed; main is now $newsha." >&2
done
```

The race this design has to close is `main` moving between rule 4's check and the
fast-forward — two sessions pushing at once, each containing the `main` it saw. It is
closed by the push lock in the orchestrator, not by the hook: pushes are checked and landed
one at a time, so the `main` rule 4 checked against is still `main` when `post-receive`
runs, and the fast-forward cannot fail. If it ever does, the orchestrator logs an error and
retries the fast-forward itself after `http-backend` exits, as a backstop.

Landing cannot be done inside `pre-receive` itself: git quarantines the pushed objects
until `pre-receive` has passed, so an `update-ref` to `main` from there fails every time.
Do not reintroduce a compare-and-swap in `pre-receive`.

Integration is merge-only. Rule 3 forbids rewriting a pushed session branch, so every
rejection message says "fetch and merge", never "rebase".

### No content validation

The hook deliberately validates nothing about content: no frontmatter checks, no directory
allowlist, no size limit. OKF is young, and a hook that encodes its current shape would be
the first thing a revision breaks; humans and agents may write anything a text editor can
produce; and, per the non-goal on review gates, mistakes are fixed after the fact, with git
history making them recoverable. Enforcement is about branches, not documents.

## Conflicts

Entirely the agent's problem, which is the point.

1. Agent pushes. Hook rejects with the message from rule 4.
2. Agent runs `git fetch origin && git merge origin/main`.
3. Git writes conflict markers into the affected files.
4. Agent reads both sides and decides what the merged document should say. For markdown
   prose, this is a task an LLM is genuinely well suited to — better than for code.
5. Agent commits the resolution and pushes again.

The orchestrator is not involved at any point.

## Read access to other branches

A sandbox with a valid git token can fetch all branches, including other sessions'.
`http-backend` has no per-branch read permission, and none is added.

This is acceptable. Every session is our own agent working on our own knowledge; there is no
confidentiality boundary between them, and seeing what a concurrent session is doing is
occasionally useful.

Write access is strictly one session, one branch, enforced by rules 1 and 2 above. That
restriction exists to prevent accidents — an agent stomping on a concurrent session's
in-progress work is a subtle and annoying failure — not to prevent malice.

If read isolation is ever wanted, the mechanism is not hooks. It is to stop giving sandboxes
a general git remote and have the orchestrator seed each workspace with only the current
state of `main`.

## Optional GitHub mirror

Entirely separate from the agent workflow, purely for backup and browsing:

```bash
git --git-dir=/srv/lore/knowledge.git push --mirror github
```

Run from a cron job or the orchestrator. Nothing in the system depends on it existing.
