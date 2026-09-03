# audit

Hides the append-only record of what every session did: creation, each command with its exit
code, timing, byte counts and the first 64 KB of stdin/stdout/stderr, pushes and their result,
close and reap snapshots, failures. Every row carries the token, user and client IP that acted.

Public surface: `AuditModule`, `AuditService.record()`, `AuditService.forSession()`, and the two
pure renderers `toEvent`/`toJsonl` that define the `kb session log` wire format.

Accepted data retention: command output and stdin heads are kept on purpose, so a person can
replay what an agent saw; retention is indefinite (spec 02, OPEN).
