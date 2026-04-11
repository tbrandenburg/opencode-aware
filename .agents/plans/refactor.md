# Refactor Plan: nudge plugin → self-awareness plugin

## Goal

Replace the current nudge/idle-handler plugin with a minimal self-awareness plugin
that registers a single OpenCode tool: `get_session_id`. No hooks, no event listeners,
no state management. Pure tool registration only.

## Motivation

The original plugin ("opencode-aware") watched for idle sessions and injected a
continuation prompt on behalf of the user. This introduced complex state, rate-limiting,
two-phase idle detection, and E2E tests requiring a live AI provider.

The new direction: give the AI itself a tool to query its own session ID. This is the
minimal, correct foundation for self-awareness — the AI knows which session it is in
without any side effects or background monitoring.

## Key insight from OpenCode docs

The `tool()` helper from `@opencode-ai/plugin` exposes `context.sessionID` in the
`execute` function natively. No hooks, no SDK client calls, no event subscriptions
are needed. One tool, one return value, zero side effects.

Reference: https://opencode.ai/docs/custom-tools/

## Files to DELETE

| File | Reason |
|---|---|
| `opencode-aware/src/idle-handler.ts` | Nudge logic — entirely removed |
| `opencode-aware/src/idle-handler.test.ts` | Tests for deleted module |
| `opencode-aware/src/throttle.ts` | Rate-limiting state — no longer needed |
| `opencode-aware/src/throttle.test.ts` | Tests for deleted module |
| `opencode-aware/src/types.ts` | SessionState, nudge constants, shared state map — nudge-only |
| `opencode-aware/src/e2e.test.ts` | E2E for idle injection — tests non-existent behavior |

## Files to REWRITE

### `opencode-aware/src/index.ts`

Strip all hooks. Register one tool via the plugin `tool` return key:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const OpencodeAwarePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-aware", level: "info", message: "plugin loaded" } })

  return {
    tool: {
      get_session_id: tool({
        description: "Returns the current OpenCode session ID so the AI is aware of which session it is running in.",
        args: {},
        async execute(_args, context) {
          return context.sessionID
        },
      }),
    },
  }
}
```

### `opencode-aware/src/index.test.ts` (new file)

Unit test that verifies the tool's execute function returns the session ID from context:

```ts
import { describe, it, expect } from "bun:test"

describe("get_session_id tool", () => {
  it("returns the sessionID from context", async () => {
    const context = { sessionID: "test-session-123", agent: "build", messageID: "msg-1", directory: "/tmp", worktree: "/tmp" }
    const result = await execute({}, context)
    expect(result).toBe("test-session-123")
  })
})
```

The execute function is extracted and tested directly — no plugin machinery needed.

## Files to UPDATE

### `opencode-aware/package.json`

- `description`: "OpenCode plugin that registers a get_session_id tool for AI self-awareness"
- `version`: `0.3.0`
- Remove `@opencode-ai/sdk` from `devDependencies` (only used for E2E which is removed)

### `README.md`

- Title and description: self-awareness plugin, not nudge plugin
- Remove "Why" section about nudging
- Remove rate-limits table
- Add section documenting the `get_session_id` tool
- Update dev commands: remove `make test-e2e` and `make validate` references to E2E

### `Makefile`

- Remove `test-e2e` target entirely
- Update `test` target: point at `src/index.test.ts`
- Simplify `validate`: `lint test` only (no E2E)
- Remove pre-push hook reference to `make test-e2e` if present

## Verification

After all changes:

```bash
make validate   # typecheck + unit tests must pass with 0 failures
make build      # dist/ must compile cleanly
```
