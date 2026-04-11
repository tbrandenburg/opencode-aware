import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const getSessionIdTool = tool({
  description: "Returns the current OpenCode session ID so the AI is aware of which session it is running in.",
  args: {},
  async execute(_args, context) {
    return context.sessionID
  },
})

export const OpencodeAwarePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-aware", level: "info", message: "plugin loaded" } })

  return {
    tool: {
      get_session_id: getSessionIdTool,
    },
  }
}

export default OpencodeAwarePlugin
