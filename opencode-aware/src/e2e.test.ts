import { beforeAll, describe, it, expect } from "bun:test"
import { spawnSync } from "child_process"
import { resolve } from "path"

// src/ -> opencode-aware/ -> repo root (where .opencode/plugins/ lives)
const REPO_ROOT = resolve(import.meta.dir, "../..")
const OPENCODE_RUN_TIMEOUT = 120_000
const OPENCODE_BINARY = process.env["OPENCODE_BINARY"] ?? "opencode"

interface ToolUseEvent {
  type: "tool_use"
  sessionID: string
  part: {
    tool: string
    state: {
      status: string
      input: Record<string, unknown>
      content?: string | Array<{ type: string; text?: string }>
      output?: string
      metadata?: { metadata?: { toolCalls?: Array<{ tool: string }> } }
    }
  }
}

beforeAll(() => {
  const version = spawnSync(OPENCODE_BINARY, ["--version"], { encoding: "utf8", timeout: 10_000 })
  expect(version.status).toBe(0)
  expect(version.stdout).toMatch(/v?2\.\d+\.\d+/)
})

function parseJsonLines(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line))
}

function toolOutput(event: ToolUseEvent): string {
  const content = event.part.state.content
  if (typeof content === "string") return content
  if (content) return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n")
  return event.part.state.output ?? ""
}

function findToolEvent(events: unknown[], name: string): ToolUseEvent | undefined {
  return events.find((event): event is ToolUseEvent => {
    const candidate = event as ToolUseEvent
    if (candidate.type !== "tool_use") return false
    if (candidate.part.tool === name) return true
    return candidate.part.state.metadata?.metadata?.toolCalls?.some((call) => call.tool === name) ?? false
  })
}

describe("get_session_id e2e", () => {
  it("tool output matches the session ID of the running session", () => {
    const result = spawnSync(
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_session_id and return only the result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = findToolEvent(events, "get_session_id")

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    // The tool must return the same session ID that all events carry
    const sessionID = toolEvent!.sessionID
    expect(sessionID).toMatch(/^ses_/)
    expect(toolOutput(toolEvent!)).toBe(sessionID)
  })
})

describe("get_session_db_info e2e", () => {
  it("returns the v2 database path, schema, and active session", () => {
    const result = spawnSync(
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_session_db_info and return its full raw JSON result without changing or summarizing it."],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT },
    )

    expect(result.status).toBe(0)
    const toolEvent = findToolEvent(parseJsonLines(result.stdout), "get_session_db_info")
    expect(toolEvent).toBeDefined()
    const output = JSON.parse(toolOutput(toolEvent!))
    expect(output.session_id).toBe(toolEvent!.sessionID)
    expect(output.db_path).toContain("opencode.db")
    expect(output.schema).toContain("session_v2")
    expect(output.schema).toContain("session_message")
  })
})

describe("get_context_info e2e", () => {
  it("tool output contains valid context info JSON with expected fields", () => {
    const result = spawnSync(
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_context_info and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = findToolEvent(events, "get_context_info")

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolOutput(toolEvent!))

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
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_agent_info and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = findToolEvent(events, "get_agent_info")

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolOutput(toolEvent!))

    // top-level keys
    expect(output).toHaveProperty("agent")
    expect(output).toHaveProperty("model")

    // agent section
    const agent = output.agent
    expect(typeof agent.name).toBe("string")
    expect(agent.name.length).toBeGreaterThan(0)
    expect(typeof agent.mode).toBe("string")
    expect(agent.builtIn).toBeNull()
    expect(agent.tools).toBeNull()

    // model section
    const model = output.model
    expect(typeof model.model_id).toBe("string")
    expect(typeof model.provider_id).toBe("string")
    expect(typeof model.context_window).toBe("number")
    expect(typeof model.output_limit).toBe("number")
    expect(typeof model.options).toBe("object")
    expect(typeof model.cost).toBe("object")
    expect(typeof model.cost.input).toBe("number")
    expect(typeof model.cost.output).toBe("number")
    expect(typeof model.cost.cache).toBe("object")
    expect(typeof model.capabilities).toBe("object")
    expect(typeof model.capabilities.reasoning).toBe("boolean")
    expect(typeof model.capabilities.toolcall).toBe("boolean")
    expect(typeof model.capabilities.input).toBe("object")
    expect(JSON.stringify(output)).not.toContain('"apiKey":"public"')
  })
})

describe("get_all_agents e2e", () => {
  it("tool output contains an array of agents with expected fields", () => {
    const result = spawnSync(
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_all_agents and return only the raw JSON result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = findToolEvent(events, "get_all_agents")

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = JSON.parse(toolOutput(toolEvent!))

    expect(Array.isArray(output)).toBe(true)
    expect(output.some((agent: { id: string }) => agent.id === "build")).toBe(true)
    expect(output.some((agent: { id: string }) => agent.id === "review")).toBe(true)

    for (const agent of output) {
      expect(typeof agent.name).toBe("string")
      expect(agent.name.length).toBeGreaterThan(0)
      expect(typeof agent.mode).toBe("string")
      expect(agent.builtIn).toBeNull()
      expect(agent.tools).toBeNull()
      expect(typeof agent.permission).toBe("object")
    }
  })
})

describe("get_opencode_docs e2e", () => {
  it("tool output contains OpenCode v2 documentation links", () => {
    const result = spawnSync(
      OPENCODE_BINARY,
      ["run", "--format", "json", "Call get_opencode_docs and return only the result"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: OPENCODE_RUN_TIMEOUT }
    )

    expect(result.status).toBe(0)

    const events = parseJsonLines(result.stdout)

    const toolEvent = findToolEvent(events, "get_opencode_docs")

    expect(toolEvent).toBeDefined()
    expect(toolEvent!.part.state.status).toBe("completed")

    const output = toolOutput(toolEvent!)

    expect(typeof output).toBe("string")
    expect(output.length).toBeGreaterThan(0)

    expect(output).toContain("[Plugins](https://opencode.ai/v2/docs/build/plugins)")
    expect(output).toContain("[Migration from v1](https://opencode.ai/v2/docs/migrate-v1)")
  })
})
