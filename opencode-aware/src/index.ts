import { homedir, platform } from "os"
import { join } from "path"
import { Database } from "bun:sqlite"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

function resolveDbPath(): string {
  const os = platform()
  if (os === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode", "opencode.db")
  }
  if (os === "win32") {
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "opencode", "opencode.db")
  }
  // Linux / other XDG-compliant systems
  const xdg = process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share")
  return join(xdg, "opencode", "opencode.db")
}

const DB_PATH = resolveDbPath()

function queryLiveSchema(db: Database): string {
  const rows = db
    .query<{ name: string; sql: string }, []>(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%' ORDER BY name"
    )
    .all()
  return rows.map((r) => r.sql).join("\n\n")
}

function querySessionContext(db: Database, sessionID: string): { project_id: string; directory: string } {
  const row = db
    .query<{ project_id: string; directory: string }, [string]>(
      "SELECT project_id, directory FROM session WHERE id = ? LIMIT 1"
    )
    .get(sessionID)
  return row ?? { project_id: "", directory: "" }
}

const getSessionDbInfoTool = tool({
  description: [
    "Returns the OpenCode SQLite database path, its live schema, and the current session context (session_id, project_id, directory).",
    "Call this tool once before constructing any SQL query against the session history.",
    "IMPORTANT: always add LIMIT to every SELECT query (recommended: LIMIT 20, max: 100) to avoid overloading the context window with large result sets.",
  ].join(" "),
  args: {},
  async execute(_args, context) {
    const db = new Database(DB_PATH, { readonly: true })
    try {
      return JSON.stringify({
        db_path: DB_PATH,
        schema: queryLiveSchema(db),
        session_id: context.sessionID,
        ...querySessionContext(db, context.sessionID),
      })
    } finally {
      db.close()
    }
  },
})

const getSessionIdTool = tool({
  description: "Returns the current OpenCode session ID so the AI is aware of which session it is running in.",
  args: {},
  async execute(_args, context) {
    return context.sessionID
  },
})

export const OpencodeAwarePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-aware", level: "info", message: "plugin loaded" } })

  const { client } = input

  const getContextInfoTool = tool({
    description:
      "Returns the current session's context window limit, token usage (input/output/reasoning/total), and usage ratio. Call this to understand how much context has been consumed and how much remains.",
    args: {},
    async execute(_args, context) {
      // Fetch all messages for this session
      const msgsResp = await client.session.messages({ path: { id: context.sessionID } })
      const messages: Array<{ info: { role: string; tokens?: { input: number; output: number; reasoning: number }; modelID?: string; providerID?: string } }> =
        (msgsResp as any)?.data ?? (msgsResp as any) ?? []

      // Aggregate tokens across all assistant messages
      let inputTokens = 0
      let outputTokens = 0
      let reasoningTokens = 0
      let modelID = ""
      let providerID = ""

      for (const { info } of messages) {
        if (info.role === "assistant" && info.tokens) {
          inputTokens += info.tokens.input
          outputTokens += info.tokens.output
          reasoningTokens += info.tokens.reasoning
          if (info.modelID) modelID = info.modelID
          if (info.providerID) providerID = info.providerID
        }
      }

      const usedTokens = inputTokens + outputTokens

      // Look up context window and output limit for the active model
      let contextWindow = 0
      let outputLimit = 0

      if (modelID && providerID) {
        const cfgResp = await client.config.providers()
        const providers: Array<{ id: string; models?: Record<string, { limit?: { context: number; output: number } }> }> =
          (cfgResp as any)?.data?.providers ?? (cfgResp as any)?.providers ?? []

        for (const p of providers) {
          if (p.id === providerID && p.models?.[modelID]?.limit) {
            contextWindow = p.models[modelID].limit!.context
            outputLimit = p.models[modelID].limit!.output
            break
          }
        }
      }

      const usageRatio = contextWindow > 0 ? usedTokens / contextWindow : null

      return JSON.stringify({
        session_id: context.sessionID,
        model_id: modelID,
        provider_id: providerID,
        context_window: contextWindow,
        output_limit: outputLimit,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          reasoning: reasoningTokens,
          used: usedTokens,
        },
        usage_ratio: usageRatio,
        usage_percent: usageRatio !== null ? `${(usageRatio * 100).toFixed(1)}%` : null,
      })
    },
  })

  return {
    tool: {
      get_session_id: getSessionIdTool,
      get_session_db_info: getSessionDbInfoTool,
      get_context_info: getContextInfoTool,
    },
  }
}

export default OpencodeAwarePlugin
