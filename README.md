# opencode-aware

An OpenCode plugin that gives the AI tools to query its own session context.

<img align="center" width="640" alt="image" src="https://github.com/user-attachments/assets/b915476e-d59a-41de-afb0-2bd4863d8e4b" />

## Why

For an AI agent to reason about its own execution context, it needs to know which
session it is operating in, what history exists, and how much context window it has
consumed. This plugin registers lightweight tools for session self-awareness — no
hooks, no background monitoring, no side effects.

## What it does

Registers four tools:

| Tool | Description |
|---|---|
| `get_session_id` | Returns the current OpenCode session ID |
| `get_session_db_info` | Returns the SQLite DB path, live schema, and session context (project_id, directory) |
| `get_context_info` | Returns context window limit, token usage (input/output/reasoning/total), and usage ratio for the current session |
| `get_agent_info` | Returns the current agent definition and full model properties (capabilities, limits, cost) |

The AI can call these tools at any time to become aware of its execution context.

## Getting started

Register the plugin in your project's or global `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-aware"] // npm package, or absolute path to dist/index.js
}
```

More information: https://opencode.ai/docs/plugins/

## Development

```bash
git clone https://github.com/tbrandenburg/opencode-aware.git
cd opencode-aware
make install        # installs dependencies and builds the plugin
```

```bash
make install        # bun install + build + register git hooks
make build          # compile TypeScript to dist/
make clean          # remove dist/
make test           # unit tests
make typecheck      # tsc --noEmit
make validate       # typecheck + test
make publish        # interactive: bump version, publish to npm, push tag & GitHub release
```

## Docs

- [Debugging plugins with OpenCode](docs/debugging-plugins.md)

## License

MIT — see [LICENSE](LICENSE).
