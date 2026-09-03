# auth

Hides who a caller is. Users (with an admin flag), the tokens they mint for their agents, and
how a bearer token on a request becomes a `Principal` (user, token, client IP). The global
`BearerAuthGuard` runs on every route unless marked `@Public()`; `AdminGuard` narrows a route
to admins. Also owns the identifier and secret primitives (`shortId`, `newSecret`, `hashSecret`)
because tokens are the first thing that needed them; sessions reuse them for git tokens.

Public surface: `AuthModule`, `AuthService`, `TokensService`, `UsersService`, `AdminGuard`,
`Public`, `CurrentPrincipal`, `clientIp`, the id helpers, and the row types.

An admin may mint a token for any user; that is how a new user receives their first one.

Invariants: a token's plaintext is returned once at creation and never stored; only its hash is.
A revoked token fails authentication immediately.
