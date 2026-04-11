# opencode-aware

An OpenCode plugin that nudges the AI to continue work after 5 minutes of session idle time.

## Install

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-aware"]
}
```

OpenCode installs npm plugins automatically via Bun on startup.

## Installation (from source)

1. Clone the [opencode-aware](https://github.com/tbrandenburg/opencode-aware) repo.
2. Run `make install` from the repo root — this installs dependencies and builds the plugin.
3. Register the plugin in your project's `.opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-aware/opencode-aware/dist/index.js"]
}
```

The path must be absolute.

## How it works

- Listens for `session.idle` events from OpenCode.
- Tracks how long the session has been idle using wall-clock time since the last user message.
- After **5 minutes** of continuous idle, injects a single continuation prompt.
- The AI receives: *"Please assess if there's any additional work needed and continue if appropriate."*
- If the AI decides there is nothing left to do, it says so and stops.
- Any new user message resets the idle timer.

## Rate limits

| Limit | Value |
|---|---|
| Idle threshold before first prompt | 5 minutes |
| Minimum gap between prompts | 10 minutes |
| Maximum prompts per hour | 3 |

## Development

```bash
make install        # bun install + register git hooks
make test           # unit tests (~50 ms)
make test-e2e       # full E2E against a real OpenCode session (~20 s, requires AI provider)
make typecheck      # tsc --noEmit
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_IDLE_THRESHOLD_MS` | `300000` (5 min) | Override idle threshold — useful for testing |

## Caveats

- State is in-memory. Restarting OpenCode resets all counters.
- The plugin path in `opencode.jsonc` must be an absolute path specific to each machine.
