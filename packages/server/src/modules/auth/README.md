# auth

Hides who a caller is. Users (with an admin flag), the tokens they mint for their agents, and
how a request becomes a `Principal` (user, token, client IP): by its bearer token, or, when
`LORE_AUTH_TRUSTED_HEADER` is configured, by the identity header a trusted proxy sets. The global
`BearerAuthGuard` runs on every route unless marked `@Public()`; `AdminGuard` narrows a route
to admins. Also owns the identifier and secret primitives (`shortId`, `newSecret`, `hashSecret`)
because tokens are the first thing that needed them; sessions reuse them for git tokens.

Public surface: `AuthModule`, `AuthService`, `TokensService`, `UsersService`, `AdminGuard`,
`Public`, `CurrentPrincipal`, `clientIp`, the id helpers, and the row types.

An admin may mint a token for any user; that is how a new user receives their first one.

Invariants: a token's plaintext is returned once at creation and never stored; only its hash is.
A revoked token fails authentication immediately.

Trusted header (spec 04): the header is honoured only when the connecting peer, never a
forwarded-for header, is in `LORE_AUTH_TRUSTED_PROXIES`; from any other peer its presence is a
401, whatever else the request carries. A trusted request without it falls back to the bearer
token. The named user is created on first sight, once, without admin, and acts through one
`proxy` credential per user (a token row whose hash is a marker no secret hashes to, so it can
never be presented as a bearer token); revoking it refuses that user through the proxy. A
malformed proxy list fails the boot.
