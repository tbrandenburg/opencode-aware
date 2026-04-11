import { describe, it, expect } from "bun:test"
import { spawnSync } from "child_process"
import { resolve } from "path"

// src/ -> opencode-aware/ -> repo root (where .opencode/plugins/ lives)
const REPO_ROOT = resolve(import.meta.dir, "../..")

interface ToolUseEvent {
  type: "tool_use"
  sessionID: string
  part: {
    tool: string
    state: {
      status: string
      input: Record<string, unknown>
      output: string
    }
  }
}

function parseJsonLines(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line))
}

describe("get_session_id e2e", () => {
  it("tool output matches the session ID of the running session", () => {
    const result = spawnSync(
      "opencode",
      ["run", "--format", "json", "Call get_session_id and return only the result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = events.find(
      (e): e is ToolUseEvent =>
        (e as ToolUseEvent).type === "tool_use" &&
        (e as ToolUseEvent).part?.tool === "get_session_id"
    )

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    // The tool must return the same session ID that all events carry
    const sessionID = toolEvent!.sessionID
    expect(sessionID).toMatch(/^ses_/)
    expect(toolEvent!.part.state.output).toBe(sessionID)
  })
})
