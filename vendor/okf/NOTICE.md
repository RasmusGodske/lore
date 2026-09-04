# Open Knowledge Format specification

`SPEC.md` is the Open Knowledge Format specification, version 0.2, reproduced unchanged from
https://github.com/GoogleCloudPlatform/open-knowledge-format (Apache-2.0, Copyright Google LLC).
Copied 2026-09-04.

It is vendored so agents and people can read the format without a network: the server serves
it at `GET /guide/okf` and through the `lore_guide` MCP tool, the CLI prints it with
`lore guide okf`, and every sandbox has it at `/usr/share/lore/OKF-SPEC.md`.

To update: replace `SPEC.md`, bump the version here and in
`packages/server/src/modules/guide/okf-spec.ts`, then run `npm run vendor:okf` in
`packages/server` to regenerate the TypeScript copy the server embeds.
