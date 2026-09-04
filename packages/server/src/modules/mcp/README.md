# mcp

Hides the Model Context Protocol surface: a stateless streamable-HTTP endpoint at `/mcp` that
exposes exactly the session operations as four tools (`lore_session_create`, `lore_session_list`,
`lore_session_close`, `lore_shell`) bound to the authenticated principal. The tool descriptions are
where an agent learns the workflow; they add nothing the HTTP API cannot do.
