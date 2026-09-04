# config

Hides the environment. Every `LORE_*` variable is parsed and validated once at startup through one
zod schema, and the rest of the server reads typed values and derived paths (data dir, repo path,
workspace paths, the git remote URL a sandbox sees) from `ConfigService`. Unknown or malformed
values fail the boot, not a request later.
