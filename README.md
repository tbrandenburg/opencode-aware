# opencode-aware

An OpenCode plugin that gives the AI a tool to query its own session ID.

## Why

For an AI agent to reason about its own execution context, it needs to know which
session it is operating in. This plugin registers a single `get_session_id` tool
that returns the current OpenCode session ID on demand — no hooks, no background
monitoring, no side effects.

## What it does

Registers one tool: `get_session_id`

| Tool | Description |
|---|---|
| `get_session_id` | Returns the current OpenCode session ID |

The AI can call this tool at any time to become aware of which session it is running
in. This is the minimal, correct foundation for session self-awareness.

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
