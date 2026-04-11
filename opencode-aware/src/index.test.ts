import { describe, it, expect } from "bun:test"
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
})
