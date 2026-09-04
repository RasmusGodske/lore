# 05 — Knowledge format

This document describes what lives inside the repository. It is largely independent of the
runtime and could be adopted on its own.

## Open Knowledge Format (OKF)

OKF is an open, vendor-neutral specification published by Google Cloud for representing
organisational knowledge as a directory of markdown files with YAML frontmatter. v0.1 was
published 12 June 2026; v0.2 followed on 25 July 2026.

Its character is deliberately minimal: no schema registry, no central authority, no required
tooling, no database, no build step. If you can `cat` a file you can read it; if you can
`git clone` a repo you can consume a bundle.

Two reasons to build on it rather than inventing a format:

1. It matches what we want structurally anyway — plain markdown, git-versioned, human- and
   agent-readable.
2. It has a serious backer, which makes it more likely to outlast any individual tool. The
   bet is on the format's durability, not on any particular implementation.

Important caveat: OKF is early, and Google frames v0.2 as a starting point rather than a
finished standard. Keep custom logic thin so a revision does not invalidate it.

## What v0.2 adds

v0.2 supersedes v0.1 and adds optional **trust signal** families: provenance, trust,
freshness, lifecycle, and attestation. The design choice worth noting is that OKF records
signals rather than computing a credibility score, on the grounds that a score is
subjective, does not port between consumers, and goes stale immediately.

Two migration-relevant changes: `generated.at` supersedes v0.1's `timestamp`, and
frontmatter `sources` supersedes a body-level `# Citations` list. v0.1 bundles remain
consumable; a v0.2 consumer may fall back to both legacy forms.

A bundle may declare its version in a root `index.md` frontmatter block with
`okf_version: "0.2"`.

The **freshness/lifecycle** fields are the directly useful ones here. A note about how an
external system is configured can carry a staleness horizon, so an agent reading it a year
later is prompted to verify rather than trusting it silently.

There is also a notion of **generator scripts**: a concept can record that it was produced
by running a specific script against a source, making it a reproducible derivation rather
than a static assertion. Relevant for anything computed from the production database, where
the durable knowledge is the query and its meaning rather than a snapshot of the answer.

## Consumer leniency

OKF instructs consumers not to reject a bundle for missing optional fields, unknown `type`
values, unknown frontmatter keys, broken cross-links, or missing `index.md` files. The
server-side hook goes further and validates nothing about content at all (see
`03-git-model.md`), so leniency is a property of readers, not of the write path. It buys
resilience as the wiki grows, at the cost of variable quality between documents.

## Directory layout

Starting structure. Expect it to change as usage reveals what is actually needed; the
session audit log is the intended signal for that (see `02-session-lifecycle.md`).

```
/
├── index.md                     # bundle root; declares okf_version
├── topics/
│   ├── index.md
│   ├── nightly-import/
│   │   ├── index.md             # how the job runs, what to know before touching it
│   │   └── history/
│   │       └── 2026-09-03-skipped-run-investigation.md
│   ├── partner-webhooks.md      # how the partner integration is configured, and why
│   └── <topic>.md               # one directory or file per subject
├── decisions/                   # durable decisions and their reasoning
│   └── 2026-09-03-<slug>.md
└── AGENTS.md                    # working instructions (see below)
```

`topics/` holds one directory or file per subject the team needs to remember: how a system
works, how a partner integration is configured, what was concluded about a recurring
question. A topic grows a `history/` directory when individual investigations are worth
keeping beside the current picture. `decisions/` holds durable decisions and their
reasoning, one dated file each. This is a company wiki, not a ticket tracker.

## Frontmatter

Minimum viable document:

```markdown
---
title: Nightly import job
type: Topic
tags: [import, scheduling]
---

The import runs at 02:00 UTC from a cron entry on the worker host...
```

With v0.2 trust signals where they earn their place:

```markdown
---
title: Nightly import job
type: Topic
tags: [import, scheduling]
sources:
  - "Incident review, 2026-08-14"
  - "prod db: import_runs table"
generated:
  by: "claude-code"
  at: "2026-09-03T09:31:05Z"
verified:
  by: "alice"
  at: "2026-08-20T00:00:00Z"
stale_after: "2027-03-01"
status: stable
---
```

Use `stale_after` on anything describing live configuration or the state of an external
system. That is the field that stops an agent confidently repeating a year-old setup as
current.

## What OKF reserves, and what is ours

OKF reserves exactly two filenames: `index.md` (the directory listing used for progressive
disclosure) and `log.md` (a chronological history of updates). Index files carry no
frontmatter, with one exception: the bundle-root `index.md` may declare `okf_version`. Every
other markdown file must have a frontmatter block with a non-empty `type`. The seed follows
this: index files are plain markdown, the root one declares the version, and `AGENTS.md`
carries `title` and `type: Guide` like any other document.

`AGENTS.md` itself is **not** part of OKF. It is this project's convention, borrowed from the
general `AGENTS.md` practice for agent instructions, and nothing enforces it: the hook validates
no content, the server never reads it, and the MCP tool description tells an agent to read
`index.md` and, if the repository has one, `AGENTS.md`. A team that prefers another name or no
instructions at all only edits its own repository.

## Progressive disclosure

An agent cannot read a few hundred files at session start. `index.md` files at each level
are the mechanism: a short catalogue of what is in that directory and when to look at it, so
an agent can orient cheaply and then read only what it needs.

Keep index files current. Generating them from frontmatter is the obvious automation and a
good candidate for a generator script. Remember that index files themselves carry no
frontmatter.

## AGENTS.md — the part that actually determines whether this works

Infrastructure is the easy half. Agents rarely decide to document things well unprompted,
and when they do write, they tend toward article-style summaries rather than the structured,
per-subject records that are actually useful. This has been observed directly in other
setups and should be treated as the expected failure mode, not a surprise.

`AGENTS.md` at the repository root carries the working instructions, and needs to be
specific about:

- **When to write.** After resolving a recurring question, after discovering something
  non-obvious about a system, after making a decision worth remembering. Not after every
  session.
- **Where things go.** Which directory, which filename convention.
- **What a good document looks like.** Concrete examples beat description. Include one.
- **What not to write.** No re-summarising the codebase. No speculation recorded as fact. No
  duplicating what the production database already answers authoritatively — record the
  query and its meaning instead.
- **Updating over appending.** Prefer editing the existing document for a topic over
  creating a near-duplicate.

Since it sits at the repo root, agents pick it up naturally, and it is versioned alongside
the knowledge it governs.

**OPEN** — this file's content is not specified here and is the highest-leverage remaining
piece of work.

## Human access

Nothing about the format requires the agent layer. The orchestrator keeps a read-only checkout
of `main` at `/srv/lore/main`, refreshed on boot and after every landed push, so the repository
can be opened in any editor, browsed with `rg` and `cat` over SSH, or mounted over SFTP and
opened in Obsidian, which handles markdown-with-frontmatter and wiki-links natively and gives
a readable graph view for free. Edits made there are overwritten on the next landing; writes
go through a session.

This is the property to protect: if this system is switched off tomorrow, the knowledge
remains fully usable.
