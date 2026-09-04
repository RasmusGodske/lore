# mcp

Hides the Model Context Protocol surface: a stateless streamable-HTTP endpoint at `/mcp` that
exposes exactly the session operations as four tools (`lore_session_create`, `lore_session_list`,
`lore_session_close`, `lore_shell`) bound to the authenticated principal. The server hands clients the guide
as its initialize instructions, and the tool descriptions repeat the essentials; they add
nothing the HTTP API cannot do.
