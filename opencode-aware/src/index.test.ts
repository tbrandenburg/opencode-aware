import { describe, it, expect } from "bun:test"
import { homedir, platform } from "os"
import { join } from "path"
import type { ToolContext } from "@opencode-ai/plugin"
import { OpencodeAwarePlugin } from "./index.js"

function makeContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "build",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

// Helpers for building mock message responses
function assistantMsg(
  sessionID: string,
  modelID: string,
  providerID: string,
  tokens: { input: number; output: number; reasoning: number },
) {
  return { info: { role: "assistant", sessionID, modelID, providerID, tokens } }
}

function userMsg(sessionID: string) {
  return { info: { role: "user", sessionID } }
}

function makeMockInput(
  messages: ReturnType<typeof assistantMsg | typeof userMsg>[] = [],
  providers: Array<{ id: string; models?: Record<string, { limit?: { context: number; output: number } }> }> = [],
) {
  return {
    client: {
      app: { log: () => Promise.resolve() },
      session: {
        messages: () => Promise.resolve(messages),
      },
      config: {
        providers: () => Promise.resolve({ providers }),
      },
    },
  } as any
}

const mockInput = makeMockInput()

function expectedDbPath(): string {
  const os = platform()
  if (os === "darwin") return join(homedir(), "Library", "Application Support", "opencode", "opencode.db")
  if (os === "win32") {
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "opencode", "opencode.db")
  }
  const xdg = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share")
  return join(xdg, "opencode", "opencode.db")
}

describe("OpencodeAwarePlugin", () => {
  it("registers get_session_id tool", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    expect(hooks).toHaveProperty("tool")
    expect(hooks.tool).toHaveProperty("get_session_id")
  })

  it("get_session_id returns the sessionID from context", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const result = await hooks.tool!.get_session_id.execute({}, makeContext("test-session-123"))
    expect(result).toBe("test-session-123")
  })

  it("get_session_id returns different sessionID for different context", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const result = await hooks.tool!.get_session_id.execute({}, makeContext("other-session-456"))
    expect(result).toBe("other-session-456")
  })

  it("registers get_session_db_info tool", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    expect(hooks.tool).toHaveProperty("get_session_db_info")
  })

  it("get_session_db_info returns valid JSON with all expected keys", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_session_db_info.execute({}, makeContext("any-session"))
    const result = JSON.parse(raw)
    expect(result).toHaveProperty("db_path")
    expect(result).toHaveProperty("schema")
    expect(result).toHaveProperty("session_id")
    expect(result).toHaveProperty("project_id")
    expect(result).toHaveProperty("directory")
    expect(typeof result.db_path).toBe("string")
    expect(typeof result.schema).toBe("string")
    expect(typeof result.session_id).toBe("string")
    expect(typeof result.project_id).toBe("string")
    expect(typeof result.directory).toBe("string")
  })

  it("get_session_db_info db_path points to opencode.db on current platform", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_session_db_info.execute({}, makeContext("any-session"))
    const { db_path } = JSON.parse(raw)
    expect(db_path).toBe(expectedDbPath())
    expect(db_path).toEndWith("opencode.db")
  })

  it("get_session_db_info schema contains live CREATE TABLE statements for key tables", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_session_db_info.execute({}, makeContext("any-session"))
    const { schema } = JSON.parse(raw)
    expect(schema).toContain("CREATE TABLE")
    expect(schema).toContain("`session`")
    expect(schema).toContain("`message`")
    expect(schema).toContain("`part`")
    expect(schema).toContain("`project`")
  })

  it("get_session_db_info session_id matches context", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_session_db_info.execute({}, makeContext("ses_test-123"))
    const { session_id } = JSON.parse(raw)
    expect(session_id).toBe("ses_test-123")
  })

  it("get_session_db_info description contains LIMIT instruction", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    expect(hooks.tool!.get_session_db_info.description).toContain("LIMIT")
  })
})

describe("get_context_info tool", () => {
  it("is registered on the plugin", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    expect(hooks.tool).toHaveProperty("get_context_info")
  })

  it("returns valid JSON with all expected keys", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_context_info.execute({}, makeContext("ses_abc"))
    const result = JSON.parse(raw)
    expect(result).toHaveProperty("session_id")
    expect(result).toHaveProperty("model_id")
    expect(result).toHaveProperty("provider_id")
    expect(result).toHaveProperty("context_window")
    expect(result).toHaveProperty("output_limit")
    expect(result).toHaveProperty("tokens")
    expect(result.tokens).toHaveProperty("input")
    expect(result.tokens).toHaveProperty("output")
    expect(result.tokens).toHaveProperty("reasoning")
    expect(result.tokens).toHaveProperty("used")
    expect(result).toHaveProperty("usage_ratio")
    expect(result).toHaveProperty("usage_percent")
  })

  it("session_id in result matches context", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    const raw = await hooks.tool!.get_context_info.execute({}, makeContext("ses_my-session"))
    const { session_id } = JSON.parse(raw)
    expect(session_id).toBe("ses_my-session")
  })

  it("sums tokens across multiple assistant messages and ignores user messages", async () => {
    const input = makeMockInput([
      userMsg("ses_1"),
      assistantMsg("ses_1", "claude-x", "anthropic", { input: 1000, output: 200, reasoning: 50 }),
      userMsg("ses_1"),
      assistantMsg("ses_1", "claude-x", "anthropic", { input: 500, output: 100, reasoning: 10 }),
    ])
    const hooks = await OpencodeAwarePlugin(input)
    const { tokens, model_id, provider_id } = JSON.parse(
      await hooks.tool!.get_context_info.execute({}, makeContext("ses_1")),
    )
    expect(tokens.input).toBe(1500)
    expect(tokens.output).toBe(300)
    expect(tokens.reasoning).toBe(60)
    expect(tokens.used).toBe(1800)
    expect(model_id).toBe("claude-x")
    expect(provider_id).toBe("anthropic")
  })

  it("computes usage_ratio and usage_percent correctly", async () => {
    const input = makeMockInput(
      [assistantMsg("ses_2", "claude-x", "anthropic", { input: 10000, output: 2000, reasoning: 0 })],
      [{ id: "anthropic", models: { "claude-x": { limit: { context: 200000, output: 8192 } } } }],
    )
    const hooks = await OpencodeAwarePlugin(input)
    const { tokens, context_window, output_limit, usage_ratio, usage_percent } = JSON.parse(
      await hooks.tool!.get_context_info.execute({}, makeContext("ses_2")),
    )
    expect(tokens.used).toBe(12000)
    expect(context_window).toBe(200000)
    expect(output_limit).toBe(8192)
    expect(usage_ratio).toBeCloseTo(0.06, 5)
    expect(usage_percent).toBe("6.0%")
  })

  it("returns usage_ratio null and usage_percent null when context_window is 0 (model not found)", async () => {
    const input = makeMockInput(
      [assistantMsg("ses_3", "unknown-model", "unknown-provider", { input: 500, output: 100, reasoning: 0 })],
      [], // no providers
    )
    const hooks = await OpencodeAwarePlugin(input)
    const { context_window, usage_ratio, usage_percent } = JSON.parse(
      await hooks.tool!.get_context_info.execute({}, makeContext("ses_3")),
    )
    expect(context_window).toBe(0)
    expect(usage_ratio).toBeNull()
    expect(usage_percent).toBeNull()
  })

  it("returns zeros and nulls for a session with no assistant messages", async () => {
    const input = makeMockInput([userMsg("ses_4")])
    const hooks = await OpencodeAwarePlugin(input)
    const result = JSON.parse(await hooks.tool!.get_context_info.execute({}, makeContext("ses_4")))
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.used).toBe(0)
    expect(result.usage_ratio).toBeNull()
    expect(result.usage_percent).toBeNull()
  })

  it("description does not mention LIMIT (not a DB query tool)", async () => {
    const hooks = await OpencodeAwarePlugin(mockInput)
    expect(hooks.tool!.get_context_info.description).not.toContain("LIMIT")
  })
})
