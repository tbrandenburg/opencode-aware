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

describe("get_context_info e2e", () => {
  it("tool output contains valid context info JSON with expected fields", () => {
    const result = spawnSync(
      "opencode",
      ["run", "--format", "json", "Call get_context_info and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = events.find(
      (e): e is ToolUseEvent =>
        (e as ToolUseEvent).type === "tool_use" &&
        (e as ToolUseEvent).part?.tool === "get_context_info"
    )

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolEvent!.part.state.output)

    // session_id must match the session all events carry
    expect(output.session_id).toBe(toolEvent!.sessionID)
    expect(output.session_id).toMatch(/^ses_/)

    // structural checks
    expect(typeof output.model_id).toBe("string")
    expect(typeof output.provider_id).toBe("string")
    expect(typeof output.context_window).toBe("number")
    expect(typeof output.output_limit).toBe("number")

    // token fields must be non-negative numbers
    expect(output.tokens.input).toBeGreaterThanOrEqual(0)
    expect(output.tokens.output).toBeGreaterThanOrEqual(0)
    expect(output.tokens.reasoning).toBeGreaterThanOrEqual(0)
    expect(output.tokens.used).toBe(output.tokens.input + output.tokens.output)

    // usage_ratio and usage_percent are either both null (model not in providers) or both present
    if (output.usage_ratio !== null) {
      expect(typeof output.usage_ratio).toBe("number")
      expect(output.usage_ratio).toBeGreaterThanOrEqual(0)
      expect(typeof output.usage_percent).toBe("string")
      expect(output.usage_percent).toMatch(/^\d+\.\d%$/)
    } else {
      expect(output.usage_percent).toBeNull()
    }
  })
})

describe("get_agent_info e2e", () => {
  it("tool output contains valid agent and model info", () => {
    const result = spawnSync(
      "opencode",
      ["run", "--format", "json", "Call get_agent_info and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = events.find(
      (e): e is ToolUseEvent =>
        (e as ToolUseEvent).type === "tool_use" &&
        (e as ToolUseEvent).part?.tool === "get_agent_info"
    )

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolEvent!.part.state.output)

    // top-level keys
    expect(output).toHaveProperty("agent")
    expect(output).toHaveProperty("model")

    // agent section
    const agent = output.agent
    expect(typeof agent.name).toBe("string")
    expect(agent.name.length).toBeGreaterThan(0)
    expect(typeof agent.mode).toBe("string")
    expect(typeof agent.builtIn).toBe("boolean")
    expect(typeof agent.tools).toBe("object")

    // model section
    const model = output.model
    expect(typeof model.model_id).toBe("string")
    expect(typeof model.provider_id).toBe("string")
    expect(typeof model.context_window).toBe("number")
    expect(typeof model.output_limit).toBe("number")
    expect(typeof model.cost).toBe("object")
    expect(typeof model.cost.input).toBe("number")
    expect(typeof model.cost.output).toBe("number")
    expect(typeof model.cost.cache).toBe("object")
    expect(typeof model.capabilities).toBe("object")
    expect(typeof model.capabilities.reasoning).toBe("boolean")
    expect(typeof model.capabilities.toolcall).toBe("boolean")
    expect(typeof model.capabilities.input).toBe("object")
  })
})

describe("get_all_agents e2e", () => {
  it("tool output contains a non-empty array of agents with expected fields", () => {
    const result = spawnSync(
      "opencode",
      ["run", "--format", "json", "Call get_all_agents and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = events.find(
      (e): e is ToolUseEvent =>
        (e as ToolUseEvent).type === "tool_use" &&
        (e as ToolUseEvent).part?.tool === "get_all_agents"
    )

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolEvent!.part.state.output)

    expect(Array.isArray(output)).toBe(true)
    expect(output.length).toBeGreaterThan(0)

    for (const agent of output) {
      expect(typeof agent.name).toBe("string")
      expect(agent.name.length).toBeGreaterThan(0)
      expect(typeof agent.mode).toBe("string")
      expect(typeof agent.builtIn).toBe("boolean")
      expect(typeof agent.tools).toBe("object")
      expect(typeof agent.permission).toBe("object")
    }
  })
})
