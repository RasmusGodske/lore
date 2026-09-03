# api

Hides how the HTTP contract is rendered: the `{ error: { code, message } }` envelope with transport
codes 100–104 (spec 04, "two vocabularies"), zod validation of every body and query, response
serialization, OpenAPI generation, request logging, and `/health`.

Public surface: `ApiModule`, the `TransportError` family, `zodDto` (the DTO factory every module
uses; it also carries the nullable-field workaround for the swagger integration), and
`buildOpenApiDocument`, and the `@Public()` route marker that the auth guard honours.

This module depends on no other module, so every module may import it without cycles.

Invariant: a command that ran and exited non-zero is never an error at this layer; only requests
that did not reach or complete in a sandbox produce a transport code.
