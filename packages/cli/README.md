# @rasmusgodske/lore

`lore`, the command-line client for the knowledge-base orchestrator. Used by people and by agents
alike; what a caller may do is decided by the token, not by the tool. No runtime dependencies:
plain `fetch` and types generated from `../../openapi.json`.

```
lore login <url> --token T    save server and token to ~/.config/lore/config.json
lore me                       who the current token belongs to
lore session <cmd>            create | list | show | close | log
lore exec [ID] -- <cmd...>    run a command in a session; stdin is streamed when piped
lore token <cmd>              create | list | revoke
lore user <cmd>               create | list | token          (admin only)
lore mirror <cmd>           status | sync            (whether main is mirrored to a git host)
lore mcp                    MCP server over stdio, relaying to the logged-in server
```

`lore mcp` lets any MCP client use the saved login: `claude mcp add lore -- lore mcp`. Each
JSON-RPC message becomes one request to the server's `/mcp` endpoint; the tool definitions live
in the server, the CLI only relays.

`LORE_URL` and `LORE_TOKEN` override the config file. `LORE_SESSION` is the default session id.
Output is JSON when stdout is not a terminal, readable otherwise; `--json` forces JSON.

Exit codes: the command's own pass through; 100 connection, 101 auth, 102 no such session,
103 timeout, 104 usage. Transport failures always carry a `lore:` prefix on stderr; a command's
own stderr never does.

```bash
npm run generate   # regenerate src/generated/api.d.ts from ../../openapi.json
npm run build
npm test
```
