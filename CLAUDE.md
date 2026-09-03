@AGENTS.md

Claude-specific notes:

- The maintainer prefers to be grilled on design before building (`/grill-me`), one question at a
  time with a recommended answer. Decisions from those sessions go into `spec/`.
- Do not initialise git or commit unless asked.
- The MCP server for the running stack is registered in Claude Code as `kb`
  (`http://localhost:8480/mcp`). Use it to test agent-facing behaviour for real.
