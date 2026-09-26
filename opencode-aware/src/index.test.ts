import { afterEach, describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import type { AgentInfo, ModelInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createTools, lookupModel, OpencodeAwarePlugin, resolveActiveModel } from "./index.js"
import { resolveDbPath } from "./db.js"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function makeDatabase(schema: string): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-aware-v2-"))
  temporaryDirectories.push(directory)
  const path = join(directory, "opencode.db")
  const db = new Database(path)
  db.exec(schema)
  db.close()
  return path
}

const model = {
  id: "model-a",
  modelID: "model-a",
  providerID: "provider-a",
  name: "Model A",
  settings: { reasoning: true, temperature: 0.2, apiKey: "fixture-key" },
  capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [{ input: 2, output: 8, cache: { read: 0.2, write: 2 } }],
  status: "active",
  enabled: true,
  limit: { context: 100_000, output: 4_096 },
} as unknown as ModelInfo

const agent = {
  id: "build",
  name: "Build",
  mode: "primary",
  description: "Build agent",
  system: "Build carefully",
  request: { settings: {}, headers: { authorization: "fixture-auth" }, body: { temperature: 0.2, top_p: 0.8 } },
  model: { id: "model-a", providerID: "provider-a" },
  permissions: [{ action: "edit", resource: "*", effect: "allow" }],
  hidden: false,
  steps: 12,
} as unknown as AgentInfo

function assistantMessage(input: number, output: number, reasoning: number): SessionMessageInfo {
  return {
    id: "msg-a",
    type: "assistant",
    agent: "build",
    model: { id: "model-a", providerID: "provider-a" },
    content: [],
    tokens: { input, output, reasoning, cache: { read: 0, write: 0 } },
    time: { created: 1 },
  } as SessionMessageInfo
}

const session = {
  id: "ses_test",
  projectID: "project-a",
  location: { directory: "/workspace/project" },
} as SessionInfo

function makeContext(messages: SessionMessageInfo[] = [assistantMessage(100, 20, 5)]): Context {
  const data = new Map<string, unknown>()
  const context = {
    session: {
      get: async () => session,
      context: async () => messages,
    },
    agent: {
      get: async () => ({ location: {}, data: agent }),
      list: async () => ({ location: {}, data: [agent] }),
    },
    model: { list: async () => ({ location: {}, data: [model] }) },
    storage: {
      get: async (key: string) => data.get(key),
      set: async (key: string, value: unknown) => void data.set(key, value),
      remove: async (key: string) => void data.delete(key),
      scan: async () => ({ entries: [] }),
    },
  }
  return context as unknown as Context
}

function toolContext(): ToolContext {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => {},
  } as unknown as ToolContext
}

function textContent(result: { content?: string | readonly unknown[] }): string {
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return result.content
      .flatMap((item) => {
        if (typeof item !== "object" || item === null || !("type" in item) || !("text" in item)) return []
        return typeof item.text === "string" ? [item.text] : []
      })
      .join("\n")
  }
  return ""
}

async function execute(name: string, ctx = makeContext(), dbPath?: string) {
  const definitions = createTools(ctx, () => dbPath ?? "")
  const definition = definitions.find((tool) => tool.name === name)
  if (!definition) throw new Error(`Tool ${name} was not registered`)
  return definition.execute({}, toolContext())
}

describe("v2 plugin tools", () => {
  it("registers all six expected tool names", () => {
    expect(createTools(makeContext(), () => "").map((tool) => tool.name)).toEqual([
      "get_session_id",
      "get_session_db_info",
      "get_context_info",
      "get_agent_info",
      "get_all_agents",
      "get_opencode_docs",
    ])
  })

  it("registers each tool through the v2 transform API", async () => {
    const registered: string[] = []
    const context = {
      ...makeContext(),
      tool: {
        transform: async (register: (editor: { add: (tool: { name: string }) => void }) => void) => {
          register({ add: (tool) => registered.push(tool.name) })
          return { dispose: async () => {} }
        },
      },
    }
    await OpencodeAwarePlugin.setup(context as unknown as Context)
    expect(registered).toEqual(createTools(makeContext(), () => "").map((tool) => tool.name))
  })

  it("returns the active session ID as tool content", async () => {
    expect(await execute("get_session_id")).toEqual({ content: "ses_test" })
  })

  it("returns active context usage and current model limits", async () => {
    const result = await execute("get_context_info")
    const value = JSON.parse(textContent(result))
    expect(value.session_id).toBe("ses_test")
    expect(value.model_id).toBe("model-a")
    expect(value.provider_id).toBe("provider-a")
    expect(value.context_window).toBe(100_000)
    expect(value.output_limit).toBe(4_096)
    expect(value.tokens).toEqual({ input: 100, output: 20, reasoning: 5, used: 120 })
    expect(value.usage_ratio).toBeCloseTo(0.0012)
    expect(value.usage_percent).toBe("0.1%")
  })

  it("reports null usage ratio when the active model is unavailable", async () => {
    const context = makeContext([assistantMessage(10, 2, 0)])
    const missingModelContext = {
      ...context,
      model: { list: async () => ({ location: {}, data: [] }) },
    } as unknown as Context
    const value = JSON.parse(textContent(await execute("get_context_info", missingModelContext)))
    expect(value.context_window).toBe(0)
    expect(value.usage_ratio).toBeNull()
    expect(value.usage_percent).toBeNull()
  })

  it("returns v2 agent and model properties", async () => {
    const value = JSON.parse(textContent(await execute("get_agent_info")))
    expect(value.agent.name).toBe("Build")
    expect(value.agent.prompt).toBe("Build carefully")
    expect(value.agent.maxSteps).toBe(12)
    expect(value.agent.builtIn).toBeNull()
    expect(value.agent.tools).toBeNull()
    expect(value.agent.permission).toHaveLength(1)
    expect(value.agent.request.headers.authorization).toBe("[redacted]")
    expect(value.model.options).toEqual({ reasoning: true, temperature: 0.2, apiKey: "[redacted]" })
    expect(value.model.cost).toEqual({ input: 2, output: 8, cache: { read: 0.2, write: 2 } })
    expect(value.model.cost_tiers).toHaveLength(1)
    expect(value.model.capabilities.toolcall).toBe(true)
    expect(value.model.capabilities.input.image).toBe(true)
  })

  it("lists all agents returned by the v2 agent API", async () => {
    const value = JSON.parse(textContent(await execute("get_all_agents")))
    expect(value).toHaveLength(1)
    expect(value[0].id).toBe("build")
    expect(value[0].permissions).toBeUndefined()
    expect(value[0].permission).toHaveLength(1)
  })

  it("returns OpenCode v2 documentation links", async () => {
    const result = await execute("get_opencode_docs")
    expect(textContent(result)).toContain("https://opencode.ai/v2/docs/build/plugins")
    expect(textContent(result)).toContain("https://opencode.ai/v2/docs/migrate-v1")
  })

  it("reads the v2 session schema and metadata read-only", async () => {
    const path = makeDatabase(`
      CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT);
      CREATE TABLE session_message (id TEXT, session_id TEXT, seq INTEGER, data TEXT);
      INSERT INTO session_v2 VALUES ('ses_test', 'project-a', '/workspace/project');
    `)
    const value = JSON.parse(textContent(await execute("get_session_db_info", makeContext(), path)))
    expect(value.db_path).toBe(path)
    expect(value.session_id).toBe("ses_test")
    expect(value.project_id).toBe("project-a")
    expect(value.directory).toBe("/workspace/project")
    expect(value.schema).toContain("session_message")
  })

  it("fails explicitly for a v1 or unknown database schema", async () => {
    const path = makeDatabase("CREATE TABLE session (id TEXT PRIMARY KEY);")
    await expect(execute("get_session_db_info", makeContext(), path)).rejects.toThrow(
      "Unsupported OpenCode database schema: missing session_v2 table",
    )
  })

  it("rejects v2 databases missing their session message table", async () => {
    const path = makeDatabase("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, directory TEXT);")
    await expect(execute("get_session_db_info", makeContext(), path)).rejects.toThrow(
      "Unsupported OpenCode database schema: missing session_message table",
    )
  })
})

describe("v2 data helpers", () => {
  it("resolves the database path through the v2 CLI", () => {
    const path = resolveDbPath((command, args) => {
      expect(command).toBe("opencode")
      expect(args).toEqual(["debug", "paths", "db"])
      return "/tmp/opencode.db\n"
    })
    expect(path).toBe("/tmp/opencode.db")
  })

  it("rejects an empty path from the CLI", () => {
    expect(() => resolveDbPath(() => " \n")).toThrow("OpenCode returned an empty database path")
  })

  it("resolves the most recent assistant model and ignores non-assistant messages", () => {
    const messages = [
      { id: "user", type: "user", text: "hello", time: { created: 0 } },
      assistantMessage(1, 1, 0),
    ] as SessionMessageInfo[]
    expect(resolveActiveModel(messages)).toEqual({ modelID: "model-a", providerID: "provider-a" })
  })

  it("finds a model by provider and model ID", () => {
    expect(lookupModel([model], "provider-a", "model-a")).toBe(model)
    expect(lookupModel([model], "other", "model-a")).toBeUndefined()
  })
})
