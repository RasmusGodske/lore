# mcp

Hides the Model Context Protocol surface: a stateless streamable-HTTP endpoint at `/mcp` that
exposes exactly the session operations as four tools (`kb_session_create`, `kb_session_list`,
`kb_session_close`, `kb_shell`) bound to the authenticated principal. The tool descriptions are
where an agent learns the workflow; they add nothing the HTTP API cannot do.
