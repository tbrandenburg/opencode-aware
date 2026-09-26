import { execFileSync } from "child_process"
import { Plugin } from "@opencode/plugin"
import type { Context } from "@opencode/plugin/promise/plugin"
import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import type { Info as ToolInfo } from "@opencode/plugin/promise/tool"
import { getSessionDatabaseInfo, resolveDbPath, type CommandRunner } from "./db.js"
import { OPENCODE_DOCS } from "./docs.js"

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

function jsonResult(value: unknown): { content: string } {
  return { content: JSON.stringify(value) }
}

export function resolveActiveModel(messages: SessionMessageInfo[]): { modelID: string; providerID: string } {
  let modelID = ""
  let providerID = ""
  for (const message of messages) {
    if (message.type !== "assistant") continue
    modelID = message.model.id
    providerID = message.model.providerID
  }
  return { modelID, providerID }
}

export function lookupModel(
  models: ModelInfo[],
  providerID: string,
  modelID: string,
): ModelInfo | undefined {
  return models.find((model) => model.providerID === providerID && (model.id === modelID || model.modelID === modelID))
}

function modelData(messages: SessionMessageInfo[]): {
  modelID: string
  providerID: string
  input: number
  output: number
  reasoning: number
} {
  let input = 0
  let output = 0
  let reasoning = 0
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    input += message.tokens.input
    output += message.tokens.output
    reasoning += message.tokens.reasoning
  }
  return { ...resolveActiveModel(messages), input, output, reasoning }
}

function inputCapabilities(model: ModelInfo | undefined) {
  const inputs = model?.capabilities.input ?? []
  return {
    text: inputs.includes("text"),
    audio: inputs.includes("audio"),
    image: inputs.includes("image"),
    video: inputs.includes("video"),
    pdf: inputs.includes("pdf"),
  }
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValues)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /api.?key|secret|token|password|credential|authorization|cookie|private.?key/i.test(key)
        ? "[redacted]"
        : redactSensitiveValues(item),
    ]),
  )
}

function outputCost(model: ModelInfo | undefined) {
  const cost = model?.cost[0]
  return {
    input: cost?.input ?? 0,
    output: cost?.output ?? 0,
    cache: { read: cost?.cache.read ?? 0, write: cost?.cache.write ?? 0 },
  }
}

function agentProperties(agent: Awaited<ReturnType<Context["agent"]["list"]>>["data"][number] | undefined) {
  const body = agent?.request.body
  return {
    id: agent?.id ?? "",
    name: agent?.name ?? "",
    mode: agent?.mode ?? "",
    builtIn: null,
    description: agent?.description ?? null,
    prompt: agent?.system ?? null,
    temperature: typeof body?.temperature === "number" ? body.temperature : null,
    topP: typeof body?.top_p === "number" ? body.top_p : typeof body?.topP === "number" ? body.topP : null,
    maxSteps: agent?.steps ?? null,
    tools: null,
    permission: agent?.permissions ?? [],
    hidden: agent?.hidden ?? false,
    request: agent ? redactSensitiveValues(agent.request) : null,
  }
}

export function createTools(context: Context, commandRunner: CommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
): ToolInfo[] {
  const getSessionId: ToolInfo = {
    name: "get_session_id",
    description: "Returns the current OpenCode session ID so the AI is aware of its execution context.",
    input: EMPTY_OBJECT_SCHEMA,
    async execute(_input, toolContext) {
      return { content: toolContext.sessionID }
    },
  }

  const getSessionDbInfo: ToolInfo = {
    name: "get_session_db_info",
    description: [
      "Returns the OpenCode SQLite database path, live schema, and current session context.",
      "Call this once before constructing SQL queries against session history.",
      "Always add LIMIT to SELECT queries (recommended 20, maximum 100).",
    ].join(" "),
    input: EMPTY_OBJECT_SCHEMA,
    async execute(_input, toolContext) {
      const dbPath = resolveDbPath(commandRunner)
      return jsonResult(getSessionDatabaseInfo(toolContext.sessionID, dbPath))
    },
  }

  const getContextInfo: ToolInfo = {
    name: "get_context_info",
    description:
      "Returns active context token usage after the last compaction, the model context limit, output limit, and usage ratio.",
    input: EMPTY_OBJECT_SCHEMA,
    async execute(_input, toolContext) {
      const session = await context.session.get({ sessionID: toolContext.sessionID })
      const messages = await context.session.context({ sessionID: toolContext.sessionID })
      const usage = modelData(messages)
      const models = await context.model.list({ location: { directory: session.location.directory } })
      const model = lookupModel(models.data, usage.providerID, usage.modelID)
      const usedTokens = usage.input + usage.output
      const contextWindow = model?.limit.context ?? 0
      const usageRatio = contextWindow > 0 ? usedTokens / contextWindow : null
      return jsonResult({
        session_id: toolContext.sessionID,
        model_id: usage.modelID,
        provider_id: usage.providerID,
        context_window: contextWindow,
        output_limit: model?.limit.output ?? 0,
        tokens: { input: usage.input, output: usage.output, reasoning: usage.reasoning, used: usedTokens },
        usage_ratio: usageRatio,
        usage_percent: usageRatio === null ? null : `${(usageRatio * 100).toFixed(1)}%`,
      })
    },
  }

  const getAgentInfo: ToolInfo = {
    name: "get_agent_info",
    description:
      "Returns the active agent definition and model properties. V2 fields unavailable from OpenCode are reported as null.",
    input: EMPTY_OBJECT_SCHEMA,
    async execute(_input, toolContext) {
      const session = await context.session.get({ sessionID: toolContext.sessionID })
      const location = { directory: session.location.directory }
      const [agentResponse, messages, models] = await Promise.all([
        context.agent.get({ agentID: toolContext.agent, location }),
        context.session.context({ sessionID: toolContext.sessionID }),
        context.model.list({ location }),
      ])
      const agent = agentResponse.data
      const activeModel = resolveActiveModel(messages)
      const modelID = agent?.model?.id ?? activeModel.modelID
      const providerID = agent?.model?.providerID ?? activeModel.providerID
      const model = lookupModel(models.data, providerID, modelID)
      return jsonResult({
        agent: { ...agentProperties(agent), name: agent?.name ?? toolContext.agent },
        model: {
          model_id: modelID,
          provider_id: providerID,
          name: model?.name ?? "",
          status: model?.status ?? "",
          context_window: model?.limit.context ?? 0,
          output_limit: model?.limit.output ?? 0,
          options: redactSensitiveValues(model?.settings ?? {}),
          cost: outputCost(model),
          cost_tiers: model?.cost ?? [],
          capabilities: {
            reasoning: model?.settings?.reasoning === true,
            attachment: inputCapabilities(model).image || inputCapabilities(model).audio || inputCapabilities(model).pdf,
            toolcall: model?.capabilities.tools ?? false,
            input: inputCapabilities(model),
            output: model?.capabilities.output ?? [],
          },
        },
      })
    },
  }

  const getAllAgents: ToolInfo = {
    name: "get_all_agents",
    description:
      "Returns agents enumerated by the OpenCode v2 API. That API may omit configured agents; fields not exposed by v2 are null.",
    input: EMPTY_OBJECT_SCHEMA,
    async execute(_input, toolContext) {
      const session = await context.session.get({ sessionID: toolContext.sessionID })
      const agents = await context.agent.list({ location: { directory: session.location.directory } })
      return jsonResult(agents.data.map((agent) => agentProperties(agent)))
    },
  }

  const getOpenCodeDocs: ToolInfo = {
    name: "get_opencode_docs",
    description:
      "Returns key OpenCode v2 documentation links. Use these v2 docs for current plugin, configuration, API, CLI, and agent behavior.",
    input: EMPTY_OBJECT_SCHEMA,
    async execute() {
      return { content: OPENCODE_DOCS }
    },
  }

  return [getSessionId, getSessionDbInfo, getContextInfo, getAgentInfo, getAllAgents, getOpenCodeDocs]
}

export const OpencodeAwarePlugin = Plugin.define({
  id: "opencode-aware",
  async setup(context) {
    const tools = createTools(context)
    await context.tool.transform((editor) => {
      for (const definition of tools) editor.add(definition)
    })
  },
})

export default OpencodeAwarePlugin
