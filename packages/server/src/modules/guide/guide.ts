/**
 * The guide: how lore works, for an agent or a person meeting it for the first time.
 * One text, served three ways (MCP initialize instructions, GET /guide, `lore guide`).
 * It covers the mechanism only. What to write and where is the knowledge repository's own
 * business, kept in that repository by its owners.
 */
export const GUIDE = `# How lore works

lore is a knowledge base kept as plain markdown files in a git repository, following the
Open Knowledge Format. People and AI agents read and write it the same way: through a
session, which is a sandboxed shell in a private checkout of the repository.

This guide explains the mechanism so you can start without anyone explaining it to you. Read
it once. A team that uses lore seriously then writes its own conventions, in its repository
(an AGENTS.md, a skill, a CONTRIBUTING file): the directory layout it wants, the document
types it uses, when to write. After that, those conventions are what to follow; this guide
only gets you to that point.

## Sessions

- Create a session for a task; it gives you /workspace, a clone of the current main on a
  branch of your own (session/<id>). Nothing you do there is visible to anyone until you push.
- Run ordinary shell commands in it: rg, cat, ls, sed, awk, jq, python3, git. The sandbox has
  no network access; everything you need is in the checkout.
- Close the session when the task is done. Idle sessions are removed after a day, and their
  unpushed work is discarded.

## Reading

Start with index.md at the root, then the index.md of the directory you need. Index files are
the map; read documents only when the map points at them. Search with rg before assuming
something is not there. The repository may keep its own conventions in a file such as
AGENTS.md or CONTRIBUTING.md; if it does, read that before writing.

## Writing and landing

Edit files with ordinary tools, then land the change with git:

    git add -A && git commit -m "what you concluded" && git push origin HEAD

An accepted push lands on main immediately. There is no review step; mistakes are corrected
by a later change, and git history keeps everything. The server enforces only the branch
rules: you can push only your own session branch, only fast-forward, and only commits that
already contain the current main. It never judges content.

If the push is rejected because main moved:

    git fetch origin && git merge origin/main

resolve any conflict markers in the files, commit, and push again. Never rebase or force-push.

## The format

Documents follow the Open Knowledge Format, which asks for little:

- Every document starts with a YAML frontmatter block, and that block has a type.
- index.md is the table of contents of its directory and carries no frontmatter, except the
  root one, which declares okf_version.
- log.md is reserved for a chronological history of changes.
- Optional fields record where facts came from and how fresh they are: sources, generated,
  verified, stale_after, status.

You do not have to read the full specification, but it is one step away whenever you want it:
the lore_guide tool with topic "okf" (MCP), /usr/share/lore/OKF-SPEC.md inside any session,
\`lore guide okf\` (CLI), or GET /guide/okf (HTTP). Nothing is validated by the server; the
format is a convention readers rely on, not a gate.

## Bulk data

Command output is capped at 1 MB. To move files in, use the lore command-line client on the
machine you run on (not inside the sandbox), which streams stdin into a command:

    tar -c . | lore exec <session_id> -- 'tar -x'

## Audit

Every command, its exit code, and its output are recorded per session, together with who ran
it and from where. Anyone with access can read any session's log; only the session's owner or
an admin can run commands in it or close it.
`;
