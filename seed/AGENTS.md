# Working instructions for agents

This repository is the team's shared knowledge base: what we know about our systems, the
things we integrate with, and the questions that keep coming back, kept as plain markdown so
both people and agents can read and write it. You are on your own branch in a sandbox.
Nothing lands until you push, and a push is accepted only if it contains the latest `main`.

## The workflow

1. Orient: read `index.md`, then the `index.md` of the directory you need.
2. Search before you write: `rg -il '<subject or term>'`. Update the existing document for
   a subject rather than creating a near-duplicate next to it.
3. Write or edit files with ordinary tools (`cat > file`, `sed`, `python3`).
4. Land it:
   ```
   git add -A && git commit -m "Document how the nightly import handles retries" && git push origin HEAD
   ```
   If the push is rejected because `main` moved: `git fetch origin && git merge origin/main`,
   resolve conflict markers in the files, commit, push again. Never rebase, never force.
5. If you added a file, add a line for it in that directory's `index.md`.

## When to write

Write after you have concluded something that would cost the next person real effort to
rediscover:

- You worked out how a system or an integration actually behaves while answering a question.
- You resolved a recurring question and the answer or the reasoning is reusable.
- You found something non-obvious that anyone touching a piece of the system should know first.
- A decision was made that someone will later ask "why is it like this?" about.

Do not write after every session. A session that only read things has nothing to record.

## Where things go

| Content | Location |
|---|---|
| How a system, job, or integration works, its terminology, its gotchas | `topics/<slug>.md` |
| A subject with several documents | `topics/<slug>/index.md` plus files beside it |
| One investigation: the question, what was concluded, what was done | `topics/<slug>/history/YYYY-MM-DD-<slug>.md` |
| A durable decision and its reasoning | `decisions/YYYY-MM-DD-<slug>.md` |

Slugs are short and lowercase: `nightly-import`, not `The Nightly Import Job`.

## What a good document looks like

```markdown
---
title: Nightly import job
type: Topic
tags: [import, scheduling]
sources:
  - "Incident review, 2026-08-14"
  - "prod db: import_runs table"
generated:
  by: claude-code
  at: "2026-09-03T09:31:05Z"
stale_after: "2027-03-01"
status: stable
---

The nightly import pulls the previous day's records from the partner API at **02:00 UTC**,
retries each failed page up to three times, and writes one row per run to `import_runs`.

## How it is configured

- Schedule and page size live in `config/import.yml`; the partner credentials are in the
  secret store under `partner-api`, never in the repo.
- A run is considered failed only when the final retry fails; partial pages are re-fetched
  on the next run, which is why counts can differ between two consecutive days.

## Things to know

- The partner API returns HTTP 200 with an empty body when it is overloaded. The job treats
  that as "nothing to import", which hid an outage once (see `history/2026-08-14-empty-body.md`).
- Do not run two imports at once: the run table has no lock, and the second run double-counts.
```

Properties of that document: frontmatter with `title` and `type`; the answer in the first
paragraph; facts stated as facts with where they came from; pointers instead of copies for
anything a database answers authoritatively; `stale_after` on anything describing live
configuration or the state of an external system, so a reader a year from now is prompted
to re-verify.

## What not to write

- Summaries of the codebase. The code is the source of truth for the code.
- Speculation written as fact. If you are not sure, say so in the text or leave it out.
- Copies of data a database answers authoritatively. Record the query and what its result
  means instead.
- Chat transcripts. Record what was concluded, not the conversation.
- Secrets, credentials, or personal data beyond a contact's name and role.

## Frontmatter

Every document starts with YAML frontmatter. `title` and `type` are required; everything
else is optional and only worth adding when it says something true.

- `type`: free text describing the kind of document, e.g. `Topic`, `Decision`, `History`,
  `Index`.
- `tags`: list of lowercase slugs.
- `sources`: where the facts came from.
- `generated.by` / `generated.at`: who or what wrote it and when.
- `verified.by` / `verified.at`: the last human who confirmed it was right.
- `stale_after`: date after which the content should be re-verified before being trusted.
- `status`: `draft`, `stable`, or `deprecated`.
