import { homedir, platform } from "os"
import { join } from "path"
import { Database } from "bun:sqlite"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

// ─── DB helpers (get_session_db_info) ────────────────────────────────────────

function resolveDbPath(): string {
  const os = platform()
  if (os === "win32") {
    return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "opencode", "opencode.db")
  }
  // macOS and Linux both use XDG conventions
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

// ─── Shared model-resolution helpers (get_context_info, get_agent_info) ──────

type MessageInfo = {
  role: string
  modelID?: string
  providerID?: string
  tokens?: { input: number; output: number; reasoning: number }
}

type ModelLimit = { context: number; output: number }
type ModelCost = {
  input: number
  output: number
  cache: { read: number; write: number }
}
type ModelCapabilities = {
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }
}
type ModelInfo = {
  name: string
  status: string
  limit?: ModelLimit
  cost?: ModelCost
  capabilities?: ModelCapabilities
}
type ProviderEntry = {
  id: string
  models?: Record<string, ModelInfo>
}

/** Returns the modelID + providerID from the last AssistantMessage in a list. */
export function resolveActiveModel(
  messages: Array<{ info: MessageInfo }>,
): { modelID: string; providerID: string } {
  let modelID = ""
  let providerID = ""
  for (const { info } of messages) {
    if (info.role === "assistant") {
      if (info.modelID) modelID = info.modelID
      if (info.providerID) providerID = info.providerID
    }
  }
  return { modelID, providerID }
}

/** Finds a Model entry in the providers list. Returns undefined when not found. */
export function lookupModel(
  providers: ProviderEntry[],
  providerID: string,
  modelID: string,
): ModelInfo | undefined {
  for (const p of providers) {
    if (p.id === providerID && p.models?.[modelID]) {
      return p.models[modelID]
    }
  }
  return undefined
}

// ─── OpenCode docs sitemap ────────────────────────────────────────────────────

/**
 * Static markdown link list of all English OpenCode documentation pages.
 * Sourced from https://opencode.ai/sitemap.xml (English /docs/* paths only).
 * For a fully up-to-date list, fetch https://opencode.ai/sitemap.xml and filter
 * paths that start with /docs/ and have no locale segment (e.g. /docs/zh-cn/).
 */
const OPENCODE_DOCS_SITEMAP = `# OpenCode Documentation
> Sitemap source (always fresh): https://opencode.ai/sitemap.xml

- [Intro](https://opencode.ai/docs/)
- [Config](https://opencode.ai/docs/config)
- [Providers](https://opencode.ai/docs/providers)
- [Network](https://opencode.ai/docs/network)
- [Enterprise](https://opencode.ai/docs/enterprise)
- [Troubleshooting](https://opencode.ai/docs/troubleshooting)
- [Windows / WSL](https://opencode.ai/docs/windows-wsl)
- [Go](https://opencode.ai/docs/go)
- [TUI](https://opencode.ai/docs/tui)
- [CLI](https://opencode.ai/docs/cli)
- [Web](https://opencode.ai/docs/web)
- [IDE](https://opencode.ai/docs/ide)
- [Zen](https://opencode.ai/docs/zen)
- [Share](https://opencode.ai/docs/share)
- [GitHub](https://opencode.ai/docs/github)
- [GitLab](https://opencode.ai/docs/gitlab)
- [Tools](https://opencode.ai/docs/tools)
- [Rules](https://opencode.ai/docs/rules)
- [Agents](https://opencode.ai/docs/agents)
- [Models](https://opencode.ai/docs/models)
- [Themes](https://opencode.ai/docs/themes)
- [Keybinds](https://opencode.ai/docs/keybinds)
- [Commands](https://opencode.ai/docs/commands)
- [Formatters](https://opencode.ai/docs/formatters)
- [Permissions](https://opencode.ai/docs/permissions)
- [LSP Servers](https://opencode.ai/docs/lsp)
- [MCP Servers](https://opencode.ai/docs/mcp-servers)
- [ACP Support](https://opencode.ai/docs/acp)
- [Agent Skills](https://opencode.ai/docs/skills)
- [Custom Tools](https://opencode.ai/docs/custom-tools)
- [SDK](https://opencode.ai/docs/sdk)
- [Server](https://opencode.ai/docs/server)
- [Plugins](https://opencode.ai/docs/plugins)
- [Ecosystem](https://opencode.ai/docs/ecosystem)

## Source Code
- [GitHub: anomalyco/opencode](https://github.com/anomalyco/opencode)
`

// ─── Static tools (no client needed) ─────────────────────────────────────────

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

const getOpencodeDocsTool = tool({
  description: [
    "Returns a markdown list of all OpenCode documentation pages.",
    "Use this first when asked about any OpenCode feature, config, or usage —",
    "then fetch the relevant URL with WebFetch for full details.",
    "For a fully up-to-date list, fetch https://opencode.ai/sitemap.xml",
    "and filter paths starting with /docs/ that have no locale prefix (e.g. skip /docs/zh-cn/).",
  ].join(" "),
  args: {},
  async execute() {
    return OPENCODE_DOCS_SITEMAP
  },
})

// ─── Plugin factory ───────────────────────────────────────────────────────────

export const OpencodeAwarePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-aware", level: "info", message: "plugin loaded" } })

  const { client } = input

  const getContextInfoTool = tool({
    description:
      "Returns the current session's context window limit, token usage (input/output/reasoning/total), and usage ratio. Call this to understand how much context has been consumed and how much remains.",
    args: {},
    async execute(_args, context) {
      const msgsResp = await client.session.messages({ path: { id: context.sessionID } })
      const messages: Array<{ info: MessageInfo }> =
        (msgsResp as any)?.data ?? (msgsResp as any) ?? []

      let inputTokens = 0
      let outputTokens = 0
      let reasoningTokens = 0

      for (const { info } of messages) {
        if (info.role === "assistant" && info.tokens) {
          inputTokens += info.tokens.input
          outputTokens += info.tokens.output
          reasoningTokens += info.tokens.reasoning
        }
      }

      const { modelID, providerID } = resolveActiveModel(messages)
      const usedTokens = inputTokens + outputTokens

      let contextWindow = 0
      let outputLimit = 0

      if (modelID && providerID) {
        const cfgResp = await client.config.providers()
        const providers: ProviderEntry[] =
          (cfgResp as any)?.data?.providers ?? (cfgResp as any)?.providers ?? []
        const model = lookupModel(providers, providerID, modelID)
        if (model?.limit) {
          contextWindow = model.limit.context
          outputLimit = model.limit.output
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

  const getAgentInfoTool = tool({
    description:
      "Returns the current agent definition and full model properties (capabilities, limits, cost). Use this to understand which agent is active, what tools it has enabled, and the capabilities and pricing of the connected model.",
    args: {},
    async execute(_args, context) {
      // Resolve agents list and find the active one
      const agentsResp = await client.app.agents()
      const agents: Array<{
        name: string
        description?: string
        mode: string
        builtIn: boolean
        model?: { modelID: string; providerID: string }
        prompt?: string
        temperature?: number
        topP?: number
        maxSteps?: number
        tools?: Record<string, boolean>
        permission?: Record<string, unknown>
      }> = (agentsResp as any)?.data ?? (agentsResp as any) ?? []

      const agent = agents.find((a) => a.name === context.agent) ?? null

      // Resolve modelID + providerID: prefer agent's pinned model, fall back to last AssistantMessage
      let modelID = agent?.model?.modelID ?? ""
      let providerID = agent?.model?.providerID ?? ""

      if (!modelID || !providerID) {
        const msgsResp = await client.session.messages({ path: { id: context.sessionID } })
        const messages: Array<{ info: MessageInfo }> =
          (msgsResp as any)?.data ?? (msgsResp as any) ?? []
        const resolved = resolveActiveModel(messages)
        if (!modelID) modelID = resolved.modelID
        if (!providerID) providerID = resolved.providerID
      }

      // Look up full Model object
      const cfgResp = await client.config.providers()
      const providers: ProviderEntry[] =
        (cfgResp as any)?.data?.providers ?? (cfgResp as any)?.providers ?? []
      const model = lookupModel(providers, providerID, modelID)

      return JSON.stringify({
        agent: {
          name: agent?.name ?? context.agent,
          mode: agent?.mode ?? "",
          builtIn: agent?.builtIn ?? false,
          description: agent?.description ?? null,
          prompt: agent?.prompt ?? null,
          temperature: agent?.temperature ?? null,
          topP: agent?.topP ?? null,
          maxSteps: agent?.maxSteps ?? null,
          tools: agent?.tools ?? {},
          permission: agent?.permission ?? {},
        },
        model: {
          model_id: modelID,
          provider_id: providerID,
          name: model?.name ?? "",
          status: model?.status ?? "",
          context_window: model?.limit?.context ?? 0,
          output_limit: model?.limit?.output ?? 0,
          cost: {
            input: model?.cost?.input ?? 0,
            output: model?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache?.read ?? 0,
              write: model?.cost?.cache?.write ?? 0,
            },
          },
          capabilities: {
            reasoning: model?.capabilities?.reasoning ?? false,
            attachment: model?.capabilities?.attachment ?? false,
            toolcall: model?.capabilities?.toolcall ?? false,
            input: {
              text: model?.capabilities?.input?.text ?? false,
              audio: model?.capabilities?.input?.audio ?? false,
              image: model?.capabilities?.input?.image ?? false,
              video: model?.capabilities?.input?.video ?? false,
              pdf: model?.capabilities?.input?.pdf ?? false,
            },
          },
        },
      })
    },
  })

  const getAllAgentsTool = tool({
    description:
      "Returns all configured agents with their definitions and properties. Use this to see every available agent, their modes, descriptions, tools, and permissions.",
    args: {},
    async execute(_args, _context) {
      const agentsResp = await client.app.agents()
      const agents: Array<{
        name: string
        description?: string
        mode: string
        builtIn: boolean
        model?: { modelID: string; providerID: string }
        prompt?: string
        temperature?: number
        topP?: number
        maxSteps?: number
        tools?: Record<string, boolean>
        permission?: Record<string, unknown>
      }> = (agentsResp as any)?.data ?? (agentsResp as any) ?? []

      return JSON.stringify(
        agents.map((a) => ({
          name: a.name,
          mode: a.mode,
          builtIn: a.builtIn,
          description: a.description ?? null,
          prompt: a.prompt ?? null,
          temperature: a.temperature ?? null,
          topP: a.topP ?? null,
          maxSteps: a.maxSteps ?? null,
          tools: a.tools ?? {},
          permission: a.permission ?? {},
          model: a.model ?? null,
        })),
      )
    },
  })

  return {
    tool: {
      get_session_id: getSessionIdTool,
      get_session_db_info: getSessionDbInfoTool,
      get_context_info: getContextInfoTool,
      get_agent_info: getAgentInfoTool,
      get_all_agents: getAllAgentsTool,
      get_opencode_docs: getOpencodeDocsTool,
    },
  }
}

export default OpencodeAwarePlugin
