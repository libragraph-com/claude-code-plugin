# LibRAGraph for Claude Code

Connect Claude Code to your LibRAGraph vault. Search, browse, read, and organize your files, entities, notes, and media through natural language.

## Install

In Claude Code:

```
/plugin add libragraph-com/claude-code-plugin
```

## What you get

6 MCP tools:

| Tool | Purpose |
|------|---------|
| `profile` | Tenant discovery + content inventory |
| `search_meta` | Queryable fields per schema |
| `search` | FTS + parametric search |
| `search_graphql` | GraphQL queries/mutations |
| `describe_endpoint` | REST operation specs |
| `execute_endpoint` | Call any REST operation |

## Authentication

- **Local vault:** Create a PAT (`lg token create --name claude-mcp --scope read,search`) and configure in Claude Code settings
- **Cloud-connected:** OAuth discovery handles auth automatically (RFC 9728 → RFC 8414 → RFC 7591)

See [vault/docs/MCP.md](https://github.com/libragraph-com/vault/blob/main/docs/MCP.md) for full setup guide.

## Learn more

- [LibRAGraph](https://libragraph.com)
- [Vault documentation](https://github.com/libragraph-com/vault)
