# guide

Hides the one explanation of how lore works: sessions, reading, landing changes, conflicts,
bulk data, audit. The text lives here once and is served three ways: as the MCP server's
initialize instructions, at `GET /guide` (public, markdown), and through `lore guide`. It
describes the mechanism only; what a team writes and where is that team's own convention,
kept in their knowledge repository, which lore never dictates.

Also carries a vendored copy of the OKF specification (`okf-spec.ts`, Apache-2.0, pinned to a
version), served at `GET /guide/okf` and by `lore guide okf`, so the format is readable from
inside a sandbox or without a network.
