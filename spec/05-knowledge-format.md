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
this: the seed is a single root `index.md` declaring the version.

`AGENTS.md` is **not** part of OKF and not part of lore either. It is a common convention for
agent instructions; the guide tells an agent to read such a file if the repository keeps one.

## Progressive disclosure

An agent cannot read a few hundred files at session start. `index.md` files at each level
are the mechanism: a short catalogue of what is in that directory and when to look at it, so
an agent can orient cheaply and then read only what it needs.

Keep index files current. Generating them from frontmatter is the obvious automation and a
good candidate for a generator script. Remember that index files themselves carry no
frontmatter.

## Writing conventions belong to the team, not to lore

Infrastructure is the easy half. Agents rarely decide to document things well unprompted,
and when they do write, they tend toward article-style summaries rather than the structured,
per-subject records that are actually useful. Instructions that say when to write, where things
go, what a good document looks like, and what not to write are what makes the difference.

Those instructions are deliberately **not** part of lore. They describe a team's knowledge, so
they live in that team's repository, under whatever name the team chooses; `AGENTS.md` at the
root is the common convention, and the guide tells an agent to look for such a file before
writing. lore seeds a new repository with nothing but an OKF bundle root (`index.md` declaring
`okf_version`), and validates no content, so a team can organise its repository however it
likes.

lore also ships a vendored copy of the OKF specification (Apache-2.0), served at `GET /guide/okf`
and as `lore guide okf`, so the format is readable without a network. The guide summarises the
four rules that make a file valid OKF and points there for the rest.

What lore does explain, once and in one place, is its own mechanism: sessions, reading through
index files, landing changes, conflicts, bulk data, and the audit trail. That text is the
server's MCP instructions, `GET /guide`, and `lore guide`.

## Human access

Nothing about the format requires the agent layer. The orchestrator keeps a read-only checkout
of `main` at `/srv/lore/main`, refreshed on boot and after every landed push, so the repository
can be opened in any editor, browsed with `rg` and `cat` over SSH, or mounted over SFTP and
opened in Obsidian, which handles markdown-with-frontmatter and wiki-links natively and gives
a readable graph view for free. Edits made there are overwritten on the next landing; writes
go through a session.

This is the property to protect: if this system is switched off tomorrow, the knowledge
remains fully usable.
