# admin

Hides the operator's view of a running server behind `/admin/*`, all admin-only: `status`
(version, uptime, sandbox runtime, session counts, mirror state), the remote's state, its fetch and landing log, and a forced refresh, and, from the auth module, user management under `/admin/users`. It
owns no data: every route reads through another module's public surface. This is the part of
the API an agent never uses and the CLI exposes as `lore admin ...`.
