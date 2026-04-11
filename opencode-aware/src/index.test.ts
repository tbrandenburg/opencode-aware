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

const mockInput = {
  client: {
    app: {
      log: () => Promise.resolve(),
    },
  },
} as any

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
