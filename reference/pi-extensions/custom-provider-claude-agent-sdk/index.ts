import { appendFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type AccountInfo,
  type CanUseTool,
  type McpServerStatus,
  type SDKControlGetContextUsageResponse,
  type SDKControlInitializeResponse,
  type SDKControlReloadPluginsResponse,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSession,
  type SDKSessionOptions,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  buildSessionContext,
  type ExtensionAPI,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ThinkingContent,
} from "@mariozechner/pi-ai";
import { type TUI } from "@mariozechner/pi-tui";
import { ClaudeAgentWidget } from "./components.js";
import { PROVIDER_ID, SESSION_ENTRY_TYPE, WIDGET_KEY } from "./constants.js";
import { getSdkModelId, refreshClaudeProviderModels, registerClaudeProvider } from "./models.js";
import { loadPersistedState, savePersistedState, saveSessionId } from "./persistence.js";
import { completeToolArgs, ensureTool, finishTool, toPiToolView, updateToolArgs, updateToolProgress } from "./tools.js";
import type {
  ActiveTurn,
  ClaudeExtensionState,
  ClaudeQueryHandle,
  PromptImageBlock,
  PromptTextBlock,
  UiHandle,
} from "./types.js";

const runtimeState: ClaudeExtensionState = {
  cwd: process.cwd(),
  turnQueue: Promise.resolve(),
};

function ensureDebugLogPath(): string {
  if (runtimeState.debugLogPath) return runtimeState.debugLogPath;

  const dir = join(tmpdir(), "pi-claude-agent-sdk-provider");
  mkdirSync(dir, { recursive: true });
  runtimeState.debugLogPath = join(dir, `claude-agent-sdk-${Date.now()}.log`);
  return runtimeState.debugLogPath;
}

function logDebug(message: string, details?: unknown) {
  const line = `[${new Date().toISOString()}] ${message}${details === undefined ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`}\n`;
  try {
    appendFileSync(ensureDebugLogPath(), line);
  } catch {
    // Ignore logging failures.
  }
}

function describeSdkMessage(message: SDKMessage): string {
  if (message.type === "system") {
    return `${message.type}:${message.subtype}`;
  }
  if (message.type === "result") {
    return `${message.type}:${message.subtype}`;
  }
  if (message.type === "tool_progress") {
    return `${message.type}:${message.tool_name}`;
  }
  return message.type;
}

function invalidateWidget() {
  runtimeState.widget?.invalidate();
}

function clearTurn() {
  runtimeState.turn = undefined;
  invalidateWidget();
}

function beginTurn(modelId: string) {
  runtimeState.turn = {
    running: true,
    model: modelId,
    sessionId: runtimeState.sdkSessionId,
    tools: [],
    startedAt: Date.now(),
  };
  invalidateWidget();
}

function endTurn() {
  if (!runtimeState.turn) return;
  runtimeState.turn.running = false;
  runtimeState.turn.finishedAt = Date.now();
  invalidateWidget();
}

function createEmptyOutput(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function updateUsage(model: Model<Api>, output: AssistantMessage, result: SDKResultMessage) {
  const usage = result.usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  output.usage.input = usage.input_tokens ?? 0;
  output.usage.output = usage.output_tokens ?? 0;
  output.usage.cacheRead = usage.cache_read_input_tokens ?? 0;
  output.usage.cacheWrite = usage.cache_creation_input_tokens ?? 0;
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((item) => stringifyUnknown(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (Array.isArray(record.content)) return stringifyUnknown(record.content);
    if (record.file && typeof record.file === "object") return stringifyUnknown(record.file);
    if (record.results && Array.isArray(record.results)) return stringifyUnknown(record.results);
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      parts.push("[Image attached]");
      continue;
    }

    if (block.type === "toolCall") {
      const name = typeof block.name === "string" ? block.name : "tool";
      const args = block.arguments ? truncateText(JSON.stringify(block.arguments), 800) : "{}";
      parts.push(`[Tool call ${name} ${args}]`);
    }
  }

  return parts.join("\n").trim();
}

function formatAgentMessageForHandoff(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  const role = entry.role;

  if (role === "user") {
    const text = extractContentText(entry.content);
    return text ? `User:\n${truncateText(text, 4000)}` : undefined;
  }

  if (role === "assistant") {
    const text = extractContentText(entry.content);
    return text ? `Assistant:\n${truncateText(text, 4000)}` : undefined;
  }

  if (role === "toolResult") {
    const toolName = typeof entry.toolName === "string" ? entry.toolName : "tool";
    const text = extractContentText(entry.content);
    const prefix = entry.isError ? `Tool result (${toolName}, error):` : `Tool result (${toolName}):`;
    return text ? `${prefix}\n${truncateText(text, 4000)}` : prefix;
  }

  if (role === "bashExecution") {
    const command = typeof entry.command === "string" ? entry.command : "";
    const output = typeof entry.output === "string" ? entry.output : "";
    return truncateText(`Ran \`${command}\`\n\n${output || "(no output)"}`, 4000);
  }

  if (role === "custom") {
    const text = extractContentText(entry.content);
    return text ? `Context:\n${truncateText(text, 4000)}` : undefined;
  }

  if (role === "compactionSummary" && typeof entry.summary === "string") {
    return `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  if (role === "branchSummary" && typeof entry.summary === "string") {
    return `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  return undefined;
}

function formatSessionEntryForHandoff(entry: SessionEntry): string | undefined {
  if (entry.type === "message") {
    return formatAgentMessageForHandoff(entry.message);
  }

  if (entry.type === "custom_message") {
    const text = extractContentText(entry.content);
    return text ? `Context:\n${truncateText(text, 4000)}` : undefined;
  }

  if (entry.type === "model_change") {
    return `Model switched to ${entry.provider}/${entry.modelId}.`;
  }

  if (entry.type === "compaction") {
    return `The Pi session compacted part of this interval into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  if (entry.type === "branch_summary") {
    return `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  return undefined;
}

function joinHandoffSections(title: string, sections: string[]): string | undefined {
  const cleaned = sections.map((section) => section.trim()).filter(Boolean);
  if (cleaned.length === 0) return undefined;

  const body = cleaned.join("\n\n");
  return truncateText(
    `${title}\n\nThis is continuity context only. Do not respond to this message directly; the user's actual message follows separately.\n\n${body}`,
    20000,
  );
}

function buildFreshSeedHandoff(currentPromptIndex: number): string | undefined {
  const sessionManager = runtimeState.sessionManager;
  if (!sessionManager) return undefined;

  const branch = sessionManager.getBranch();
  const targetLeafId = currentPromptIndex > 0 ? branch[currentPromptIndex - 1]?.id ?? null : null;
  const visible = buildSessionContext(sessionManager.getEntries(), targetLeafId).messages;
  const sections = visible.map((message) => formatAgentMessageForHandoff(message)).filter(Boolean) as string[];

  return joinHandoffSections("Pi session handoff for Claude Agent:", sections);
}

function buildDeltaHandoff(branch: SessionEntry[], currentPromptIndex: number): string | undefined {
  const syncedThroughEntryId = runtimeState.syncedThroughEntryId;
  if (!syncedThroughEntryId) return buildFreshSeedHandoff(currentPromptIndex);

  const endIndex = currentPromptIndex >= 0 ? currentPromptIndex : branch.length;
  const syncedIndex = branch.findIndex((entry) => entry.id === syncedThroughEntryId);
  const unsynced = branch.slice(syncedIndex + 1, endIndex);

  const sections: string[] = [];
  for (const entry of unsynced) {
    if (entry.type === "custom" && entry.customType === SESSION_ENTRY_TYPE) continue;

    const section = formatSessionEntryForHandoff(entry);
    if (!section) continue;

    if (entry.type === "compaction") {
      sections.length = 0;
    }

    sections.push(section);
  }

  return joinHandoffSections("Pi session handoff since Claude Agent last synced:", sections);
}

function buildPiSessionHandoff(): string | undefined {
  const sessionManager = runtimeState.sessionManager;
  if (!sessionManager) return undefined;

  const branch = sessionManager.getBranch();
  let currentPromptIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message.role === "user") {
      currentPromptIndex = i;
      break;
    }
  }

  if (!runtimeState.sdkSessionId) {
    return buildFreshSeedHandoff(currentPromptIndex);
  }

  return buildDeltaHandoff(branch, currentPromptIndex);
}

function extractLatestUserPrompt(context: Context): string | Array<PromptTextBlock | PromptImageBlock> {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i] as { role?: string; content?: unknown };
    if (message.role !== "user") continue;

    const content = message.content;
    if (typeof content === "string") return content;

    if (Array.isArray(content)) {
      const blocks: Array<PromptTextBlock | PromptImageBlock> = [];
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const block = item as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") {
          blocks.push({ type: "text", text: block.text });
          continue;
        }
        if (
          block.type === "image" &&
          typeof block.mimeType === "string" &&
          typeof block.data === "string" &&
          ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(block.mimeType)
        ) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: block.mimeType as PromptImageBlock["source"]["media_type"],
              data: block.data,
            },
          });
        }
      }
      if (blocks.length > 0) {
        const hasImage = blocks.some((block) => block.type === "image");
        if (!hasImage) {
          return blocks
            .filter((block): block is PromptTextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n");
        }
        return blocks;
      }
    }
  }

  throw new Error("No user prompt found in context");
}

function handleSdkUserMessage(message: Extract<SDKMessage, { type: "user" }>) {
  if ("isReplay" in message && message.isReplay) {
    return;
  }

  const directResult = message.tool_use_result as
    | { tool_use_id?: string; toolUseId?: string; is_error?: boolean; isError?: boolean; content?: unknown }
    | undefined;
  if (directResult) {
    const toolUseId = directResult.tool_use_id ?? directResult.toolUseId;
    if (toolUseId) {
      finishTool(
        runtimeState,
        invalidateWidget,
        toolUseId,
        stringifyUnknown(directResult.content ?? directResult),
        Boolean(directResult.is_error ?? directResult.isError),
      );
      return;
    }
  }

  const content = (message.message as { content?: unknown }).content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;
    if (item.type !== "tool_result") continue;
    const toolUseId = typeof item.tool_use_id === "string" ? item.tool_use_id : undefined;
    if (!toolUseId) continue;
    finishTool(runtimeState, invalidateWidget, toolUseId, stringifyUnknown(item.content), Boolean(item.is_error));
  }
}

async function handleAskUserQuestion(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ui = runtimeState.ui;
  if (!ui) {
    throw new Error("AskUserQuestion requested but no interactive UI is available");
  }

  const questions = Array.isArray(input.questions) ? input.questions : [];
  const answers: Record<string, string> = {};

  for (const item of questions) {
    if (!item || typeof item !== "object") continue;
    const question = item as {
      question?: string;
      options?: Array<{ label?: string }>;
      multiSelect?: boolean;
    };
    if (!question.question || !Array.isArray(question.options) || question.options.length === 0) continue;

    if (question.multiSelect) {
      const optionLabels = question.options
        .map((option, index) => `${index + 1}. ${option.label ?? `Option ${index + 1}`}`)
        .join("\n");
      const response = await ui.input(question.question, `Choose one or more options: ${optionLabels}`);
      if (!response) throw new Error(`No answer provided for: ${question.question}`);
      answers[question.question] = response;
      continue;
    }

    const labels = question.options.map((option, index) => option.label ?? `Option ${index + 1}`);
    const selected = await ui.select(question.question, labels);
    if (!selected) throw new Error(`No answer provided for: ${question.question}`);
    answers[question.question] = selected;
  }

  return { ...input, answers };
}

function backfillAssistantContent(message: Extract<SDKMessage, { type: "assistant" }>, turn: ActiveTurn) {
  const blocks = (message.message as { content?: unknown }).content;
  if (!Array.isArray(blocks)) return;

  const hasTextBlock = turn.output.content.some((block) => block.type === "text");

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;

    if (item.type === "text" && typeof item.text === "string") {
      if (!hasTextBlock || turn.output.content.every((existing) => existing.type !== "text" || existing.text !== item.text)) {
        turn.output.content.push({ type: "text", text: item.text });
      }
      continue;
    }

    if (item.type === "thinking" && turn.output.content.length === 0) {
      turn.output.content.push({
        type: "thinking",
        thinking: typeof item.thinking === "string" ? item.thinking : "",
        thinkingSignature: typeof item.signature === "string" ? item.signature : "",
      } as ThinkingContent);
    }
  }
}

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);

const canUseTool: CanUseTool = async (toolName, input, options) => {
  if (toolName === "AskUserQuestion") {
    const updatedInput = await handleAskUserQuestion(input);
    return { behavior: "allow", updatedInput };
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    return { behavior: "allow" };
  }

  const ui = runtimeState.ui;
  if (!ui) {
    logDebug("permission request denied: no UI", { toolName, input, options });
    return { behavior: "deny", message: `${toolName} requires interactive approval, but no UI is available.` };
  }

  logDebug("permission request", { toolName, input, options });
  ui.notify(`Claude Agent is requesting permission for ${toolName}.`, "info");

  const title = `${toolName} permission`;
  const description = options.decisionReason ?? JSON.stringify(input, null, 2);
  const ok = await ui.confirm(title, description);
  if (!ok) {
    logDebug("permission denied by user", { toolName });
    return { behavior: "deny", message: `${toolName} denied by user` };
  }
  logDebug("permission allowed by user", { toolName });
  return { behavior: "allow" };
};

function buildSessionOptions(sdkModelId: string): SDKSessionOptions {
  return {
    model: sdkModelId,
    cwd: runtimeState.cwd,
    settingSources: [],
    allowedTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
    canUseTool,
    permissionMode: "default",
    debugFile: ensureDebugLogPath(),
    stderr: (data: string) => logDebug("sdk-stderr", data),
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "agentkit/pi-custom-provider-claude-agent-sdk",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
  } as SDKSessionOptions;
}

function closeActiveSession() {
  const current = runtimeState.session;
  runtimeState.session = undefined;
  if (!current) return;
  try {
    current.handle.close();
  } catch {
    // Ignore close failures.
  }
}

function getLiveClaudeQuery(): ClaudeQueryHandle | undefined {
  const session = runtimeState.session?.handle as SDKSession & {
    query?: ClaudeQueryHandle;
  };
  return session?.query;
}

function getKnownClaudeSessionId(): string | undefined {
  if (runtimeState.sdkSessionId) return runtimeState.sdkSessionId;
  const session = runtimeState.session?.handle;
  if (!session) return undefined;
  try {
    return session.sessionId;
  } catch {
    return undefined;
  }
}

function getReconnectClaudeModelId(ctx: { model?: Model<Api> }): string | undefined {
  if (runtimeState.session?.model) return runtimeState.session.model;
  if (runtimeState.lastClaudeModelId) return runtimeState.lastClaudeModelId;
  if (ctx.model?.provider === PROVIDER_ID) return ctx.model.id;
  return undefined;
}

function ensureClaudeQueryForCommand(
  pi: ExtensionAPI,
  ctx: { model?: Model<Api> },
  reason: string,
): ClaudeQueryHandle | undefined {
  const existingQuery = getLiveClaudeQuery();
  if (existingQuery) return existingQuery;

  const reconnectModelId = getReconnectClaudeModelId(ctx);
  if (!reconnectModelId) {
    return undefined;
  }

  try {
    getOrCreateSession(pi, getSdkModelId(reconnectModelId));
    return getLiveClaudeQuery();
  } catch (error) {
    logDebug("claude-command-query-init-failed", {
      reason,
      reconnectModelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function getLiveClaudeContextUsage(reason: string): Promise<SDKControlGetContextUsageResponse | undefined> {
  const query = getLiveClaudeQuery();
  const getContextUsage = query?.getContextUsage;

  if (!getContextUsage) {
    logDebug("sdk-context-usage-unavailable", { reason });
    return undefined;
  }

  try {
    const usage = await getContextUsage.call(query);
    logDebug("sdk-context-usage", {
      reason,
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      model: usage.model,
    });
    return usage;
  } catch (error) {
    logDebug("sdk-context-usage-failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function formatClaudeTokenCount(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return "?";
  return tokens.toLocaleString();
}

function formatClaudePercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "?";
  return `${percent.toFixed(1)}%`;
}

function buildClaudeHelpLines(ctx: { model?: Model<Api> }): string[] {
  const currentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none";
  return [
    "Claude Agent runtime",
    `Current model: ${currentModel}`,
    `Live session: ${runtimeState.session ? "yes" : "no"}`,
    `Known session id: ${getKnownClaudeSessionId() ?? "none"}`,
    "",
    "Usage:",
    "/claude help",
    "/claude info",
    "/claude context",
    "/claude mcp",
    "/claude reload",
  ];
}

function notifyClaudeUnavailable(ctx: { ui: UiHandle; model?: Model<Api> }, subcommand: string) {
  const hint = ctx.model?.provider === PROVIDER_ID
    ? "Claude runtime is not ready yet. Send a Claude turn first or try again."
    : `Select a ${PROVIDER_ID} model first to talk to the Claude runtime.`;
  ctx.ui.notify(`/claude ${subcommand}: ${hint}`, "warning");
}

async function showClaudeInfo(pi: ExtensionAPI, ctx: { ui: UiHandle; model?: Model<Api> }) {
  const hasLiveSession = Boolean(runtimeState.session);
  const knownSessionId = getKnownClaudeSessionId();
  const query = ensureClaudeQueryForCommand(pi, ctx, "claude-info");

  let init: SDKControlInitializeResponse | undefined;
  let account: AccountInfo | undefined;
  if (query) {
    [init, account] = await Promise.all([
      query.initializationResult?.(),
      query.accountInfo?.(),
    ]);
  }
  const resolvedAccount = account ?? init?.account;

  const lines = [
    "Claude runtime info",
    `Live session: ${hasLiveSession ? "yes" : "no"}`,
    `Known session id: ${knownSessionId ?? "none"}`,
    `Pi model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}`,
    `Claude model: ${runtimeState.session?.model ?? "unknown"}`,
    `Runtime query: ${query ? "available" : "unavailable"}`,
  ];

  if (!query) {
    lines.push(
      "Account email: unknown",
      "Organization: unknown",
      "Subscription: unknown",
      "API provider: unknown",
      "Token source: unknown",
      "API key source: unknown",
    );
    if (ctx.model?.provider !== PROVIDER_ID) {
      lines.push(`Hint: select a ${PROVIDER_ID} model to inspect live Claude runtime details.`);
    }
    ctx.ui.notify(lines.join("\n"), knownSessionId ? "info" : "warning");
    return;
  }

  lines.push(
    `Account email: ${resolvedAccount?.email ?? "unknown"}`,
    `Organization: ${resolvedAccount?.organization ?? "unknown"}`,
    `Subscription: ${resolvedAccount?.subscriptionType ?? "unknown"}`,
    `API provider: ${resolvedAccount?.apiProvider ?? "unknown"}`,
    `Token source: ${resolvedAccount?.tokenSource ?? "unknown"}`,
    `API key source: ${resolvedAccount?.apiKeySource ?? "unknown"}`,
  );

  if (init) {
    lines.push(
      `Output style: ${init.output_style}`,
      `Available output styles: ${init.available_output_styles.length}`,
      `Available models: ${init.models.length}`,
      `Available commands: ${init.commands.length}`,
      `Available agents: ${init.agents.length}`,
    );
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

async function showClaudeContext(pi: ExtensionAPI, ctx: { ui: UiHandle; model?: Model<Api> }) {
  const query = ensureClaudeQueryForCommand(pi, ctx, "claude-context");
  if (!query?.getContextUsage) {
    notifyClaudeUnavailable(ctx, "context");
    return;
  }

  const usage = await query.getContextUsage();
  const lines = [
    "Claude context usage",
    `Session id: ${getKnownClaudeSessionId() ?? "not assigned yet"}`,
    `Model: ${usage.model}`,
    `Usage: ${formatClaudeTokenCount(usage.totalTokens)} / ${formatClaudeTokenCount(usage.maxTokens)} (${formatClaudePercent(usage.percentage)})`,
    `Auto-compact: ${usage.isAutoCompactEnabled ? "enabled" : "disabled"}${usage.autoCompactThreshold ? ` at ${formatClaudeTokenCount(usage.autoCompactThreshold)} tokens` : ""}`,
  ];

  const categories = [...usage.categories].sort((a, b) => b.tokens - a.tokens);
  if (categories.length > 0) {
    lines.push("", "Categories:");
    for (const category of categories.slice(0, 8)) {
      lines.push(`- ${category.name}: ${formatClaudeTokenCount(category.tokens)}${category.isDeferred ? " (deferred)" : ""}`);
    }
    if (categories.length > 8) {
      lines.push(`- … ${categories.length - 8} more`);
    }
  }

  if (usage.messageBreakdown) {
    lines.push(
      "",
      "Messages:",
      `- user: ${formatClaudeTokenCount(usage.messageBreakdown.userMessageTokens)}`,
      `- assistant: ${formatClaudeTokenCount(usage.messageBreakdown.assistantMessageTokens)}`,
      `- tool calls: ${formatClaudeTokenCount(usage.messageBreakdown.toolCallTokens)}`,
      `- tool results: ${formatClaudeTokenCount(usage.messageBreakdown.toolResultTokens)}`,
      `- attachments: ${formatClaudeTokenCount(usage.messageBreakdown.attachmentTokens)}`,
      `- redirected context: ${formatClaudeTokenCount(usage.messageBreakdown.redirectedContextTokens)}`,
      `- unattributed: ${formatClaudeTokenCount(usage.messageBreakdown.unattributedTokens)}`,
    );
  }

  if (usage.memoryFiles.length > 0) {
    lines.push("", "Memory files:");
    for (const memoryFile of usage.memoryFiles.slice(0, 5)) {
      lines.push(`- ${memoryFile.path} (${memoryFile.type}): ${formatClaudeTokenCount(memoryFile.tokens)}`);
    }
    if (usage.memoryFiles.length > 5) {
      lines.push(`- … ${usage.memoryFiles.length - 5} more`);
    }
  }

  if (usage.mcpTools.length > 0) {
    lines.push("", "MCP tools:");
    for (const tool of usage.mcpTools.slice(0, 5)) {
      lines.push(`- ${tool.serverName}/${tool.name}: ${formatClaudeTokenCount(tool.tokens)}${tool.isLoaded === false ? " (not loaded)" : ""}`);
    }
    if (usage.mcpTools.length > 5) {
      lines.push(`- … ${usage.mcpTools.length - 5} more`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

async function showClaudeMcp(pi: ExtensionAPI, ctx: { ui: UiHandle; model?: Model<Api> }) {
  const query = ensureClaudeQueryForCommand(pi, ctx, "claude-mcp");
  if (!query?.mcpServerStatus) {
    notifyClaudeUnavailable(ctx, "mcp");
    return;
  }

  const statuses = await query.mcpServerStatus();
  if (statuses.length === 0) {
    ctx.ui.notify("Claude MCP servers\nNo MCP servers configured.", "info");
    return;
  }

  const counts = statuses.reduce<Record<string, number>>((acc, status) => {
    acc[status.status] = (acc[status.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    "Claude MCP servers",
    `connected: ${counts.connected ?? 0}, failed: ${counts.failed ?? 0}, needs-auth: ${counts["needs-auth"] ?? 0}, pending: ${counts.pending ?? 0}, disabled: ${counts.disabled ?? 0}`,
  ];

  for (const status of statuses) {
    const parts: string[] = [status.status];
    if (status.scope) parts.push(`scope=${status.scope}`);
    if (status.serverInfo?.version) parts.push(`${status.serverInfo.name} ${status.serverInfo.version}`);
    if (status.tools?.length) parts.push(`${status.tools.length} tools`);
    if (status.error) parts.push(status.error);
    lines.push(`- ${status.name}: ${parts.join(" · ")}`);
  }

  ctx.ui.notify(lines.join("\n"), counts.failed ? "warning" : "info");
}

async function reloadClaudeRuntime(pi: ExtensionAPI, ctx: { ui: UiHandle; model?: Model<Api> }) {
  const query = ensureClaudeQueryForCommand(pi, ctx, "claude-reload");
  if (!query?.reloadPlugins) {
    notifyClaudeUnavailable(ctx, "reload");
    return;
  }

  const result = await query.reloadPlugins();
  await refreshClaudeProviderModels(
    pi,
    query,
    (model, context, options) => streamClaudeAgent(pi, model, context, options),
    logDebug,
    "claude-reload",
  );
  ctx.ui.notify(
    [
      "Claude runtime reloaded",
      `Commands: ${result.commands.length}`,
      `Agents: ${result.agents.length}`,
      `Plugins: ${result.plugins.length}`,
      `MCP servers: ${result.mcpServers.length}`,
      `Errors: ${result.error_count}`,
    ].join("\n"),
    result.error_count > 0 ? "warning" : "info",
  );
}

function closeLiveClaudeSession(reason: string) {
  logDebug("close-live-session", { reason, hasActiveTurn: Boolean(runtimeState.activeTurn), hasSession: Boolean(runtimeState.session) });
  closeActiveSession();
}

function invalidateClaudeLineage(pi: ExtensionAPI, reason: string) {
  logDebug("invalidate-lineage", { reason });
  closeLiveClaudeSession(reason);
  savePersistedState(runtimeState, pi, {
    sdkSessionId: undefined,
    syncedThroughEntryId: undefined,
    lastClaudeModelId: undefined,
  }, invalidateWidget);
}

function failActiveTurn(error: Error) {
  const turn = runtimeState.activeTurn;
  if (!turn || turn.finished) return;

  closeActiveSession();
  runtimeState.ui?.notify(`Claude Agent error: ${error.message}`, "error");
  turn.finished = true;
  endTurn();
  turn.output.stopReason = error.message.toLowerCase().includes("abort") ? "aborted" : "error";
  turn.output.errorMessage = error.message;
  turn.stream.push({ type: "error", reason: turn.output.stopReason, error: turn.output });
  turn.stream.end();
}

async function completeActiveTurn(result: SDKResultMessage) {
  const turn = runtimeState.activeTurn;
  if (!turn || turn.finished) return;

  logDebug("sdk-result", {
    subtype: result.subtype,
    isError: result.is_error,
    result: "result" in result ? result.result : undefined,
    errors: "errors" in result ? result.errors : undefined,
    numTurns: result.num_turns,
    stopReason: result.stop_reason,
  });

  turn.finished = true;
  updateUsage(turn.model, turn.output, result);
  const liveContextUsage = await getLiveClaudeContextUsage(
    result.is_error ? "completeActiveTurn:error" : "completeActiveTurn:success",
  );
  if (liveContextUsage?.totalTokens && liveContextUsage.totalTokens > 0) {
    turn.output.usage.totalTokens = liveContextUsage.totalTokens;
  }
  endTurn();

  if (result.is_error) {
    turn.output.stopReason = "error";
    turn.output.errorMessage = result.subtype === "success" ? "Unknown Claude Agent SDK error" : result.errors.join("\n");
    turn.stream.push({ type: "error", reason: "error", error: turn.output });
    turn.stream.end();
    return;
  }

  const hasVisibleText = turn.output.content.some((block) => block.type === "text" && block.text.trim().length > 0);

  if (!hasVisibleText && "result" in result && result.result.trim()) {
    turn.output.content = turn.output.content.filter((block) => block.type !== "thinking");
    turn.output.content.push({ type: "text", text: result.result });
  }

  if (!hasVisibleText && turn.startedWithPersistedSession && "result" in result && !result.result.trim()) {
    turn.finished = false;
    turn.output.stopReason = "stop";
    turn.shouldRetryFreshSession = true;
    logDebug("empty success on resumed session; will retry fresh session", { numTurns: result.num_turns });
    return;
  }

  turn.output.stopReason = "stop";
  turn.stream.push({ type: "done", reason: "stop", message: turn.output });
  turn.stream.end();
}

function handleStreamEvent(
  event: {
    type: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
  },
  turn: ActiveTurn,
) {
  if (event.type === "message_start") {
    turn.blockMap.clear();
    turn.toolNameByIndex.clear();
    turn.toolIdByIndex.clear();
    return;
  }

  if (event.type === "content_block_start" && typeof event.index === "number") {
    const blockType = event.content_block?.type;
    if (blockType === "text") {
      turn.output.content.push({ type: "text", text: "" });
      const outputIndex = turn.output.content.length - 1;
      turn.blockMap.set(event.index, outputIndex);
      turn.stream.push({ type: "text_start", contentIndex: outputIndex, partial: turn.output });
    } else if (blockType === "thinking") {
      turn.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as ThinkingContent);
      const outputIndex = turn.output.content.length - 1;
      turn.blockMap.set(event.index, outputIndex);
      turn.stream.push({ type: "thinking_start", contentIndex: outputIndex, partial: turn.output });
    } else if (blockType === "tool_use") {
      const toolUseId = event.content_block?.id ?? `tool-${event.index}`;
      const rawName = event.content_block?.name ?? "tool";
      turn.toolNameByIndex.set(event.index, rawName);
      turn.toolIdByIndex.set(event.index, toolUseId);
      ensureTool(runtimeState, invalidateWidget, toolUseId, rawName);
    }
    return;
  }

  if (event.type === "content_block_delta" && typeof event.index === "number") {
    const outputIndex = turn.blockMap.get(event.index);
    const deltaType = event.delta?.type;
    if (deltaType === "text_delta" && outputIndex !== undefined) {
      const block = turn.output.content[outputIndex] as TextContent;
      block.text += event.delta?.text ?? "";
      turn.stream.push({ type: "text_delta", contentIndex: outputIndex, delta: event.delta?.text ?? "", partial: turn.output });
    } else if (deltaType === "thinking_delta" && outputIndex !== undefined) {
      const block = turn.output.content[outputIndex] as ThinkingContent;
      block.thinking += event.delta?.thinking ?? "";
      turn.stream.push({ type: "thinking_delta", contentIndex: outputIndex, delta: event.delta?.thinking ?? "", partial: turn.output });
    } else if (deltaType === "input_json_delta") {
      const toolUseId = turn.toolIdByIndex.get(event.index);
      const rawName = turn.toolNameByIndex.get(event.index);
      if (toolUseId && rawName) {
        updateToolArgs(runtimeState, invalidateWidget, toolUseId, rawName, event.delta?.partial_json ?? "");
      }
    }
    return;
  }

  if (event.type === "content_block_stop" && typeof event.index === "number") {
    const outputIndex = turn.blockMap.get(event.index);
    if (outputIndex !== undefined) {
      const block = turn.output.content[outputIndex];
      if (block.type === "text") {
        turn.stream.push({ type: "text_end", contentIndex: outputIndex, content: block.text, partial: turn.output });
      } else if (block.type === "thinking") {
        turn.stream.push({ type: "thinking_end", contentIndex: outputIndex, content: block.thinking, partial: turn.output });
      }
    }

    const toolUseId = turn.toolIdByIndex.get(event.index);
    const rawName = turn.toolNameByIndex.get(event.index);
    if (toolUseId && rawName) {
      completeToolArgs(runtimeState, invalidateWidget, toolUseId, rawName);
    }
  }
}

function processSessionMessage(pi: ExtensionAPI, message: SDKMessage) {
  logDebug("sdk-message", describeSdkMessage(message));
  const sessionId = (message as { session_id?: unknown }).session_id;
  if (typeof sessionId === "string") {
    saveSessionId(runtimeState, pi, sessionId, invalidateWidget);
    if (runtimeState.turn) runtimeState.turn.sessionId = sessionId;
  }

  const turn = runtimeState.activeTurn;

  if (message.type === "tool_progress") {
    updateToolProgress(runtimeState, invalidateWidget, message);
    return;
  }

  if (!turn) {
    return;
  }

  if (message.type === "system" && message.subtype === "session_state_changed") {
    logDebug("session-state", message.state);
    return;
  }

  if (message.type === "stream_event") {
    handleStreamEvent(
      message.event as {
        type: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
      },
      turn,
    );
    return;
  }

  if (message.type === "user") {
    handleSdkUserMessage(message);
    return;
  }

  if (message.type === "assistant") {
    backfillAssistantContent(message, turn);
    return;
  }

  if (message.type === "result") {
    void completeActiveTurn(message);
  }
}

function getOrCreateSession(pi: ExtensionAPI, sdkModelId: string): SDKSession {
  const existing = runtimeState.session;
  if (existing && existing.model === sdkModelId) {
    return existing.handle;
  }

  if (existing) {
    closeActiveSession();
  }

  const options = buildSessionOptions(sdkModelId);
  const handle = runtimeState.sdkSessionId
    ? unstable_v2_resumeSession(runtimeState.sdkSessionId, options)
    : unstable_v2_createSession(options);

  runtimeState.session = {
    handle,
    model: sdkModelId,
  };

  try {
    saveSessionId(runtimeState, pi, handle.sessionId, invalidateWidget);
  } catch {
    // Fresh sessions may not expose sessionId until after initialization.
  }

  return handle;
}

function warmClaudeSession(pi: ExtensionAPI, modelId: string, reason: string) {
  const sdkModelId = getSdkModelId(modelId);
  runtimeState.lastClaudeModelId = modelId;
  try {
    getOrCreateSession(pi, sdkModelId);
    savePersistedState(runtimeState, pi, { lastClaudeModelId: modelId }, invalidateWidget);
    const query = getLiveClaudeQuery();
    if (query) {
      void refreshClaudeProviderModels(
        pi,
        query,
        (model, context, options) => streamClaudeAgent(pi, model, context, options),
        logDebug,
        `warm-session:${reason}`,
      );
    }
    logDebug("warm-session", {
      reason,
      modelId,
      sdkModelId,
      resumed: Boolean(runtimeState.sdkSessionId),
    });
  } catch (error) {
    logDebug("warm-session-failed", {
      reason,
      modelId,
      sdkModelId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function mergePromptWithHandoff(
  prompt: string | Array<PromptTextBlock | PromptImageBlock>,
  handoff: string | undefined,
): string | Array<PromptTextBlock | PromptImageBlock> {
  if (!handoff) return prompt;

  const handoffText = `${handoff}\n\nCurrent user message:\n`;

  if (typeof prompt === "string") {
    return `${handoffText}${prompt}`;
  }

  return [{ type: "text", text: handoffText }, ...prompt];
}

async function sendPrompt(session: SDKSession, prompt: string | Array<PromptTextBlock | PromptImageBlock>) {
  if (typeof prompt === "string") {
    await session.send(prompt);
    return;
  }

  const message: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    shouldQuery: true,
  };
  await session.send(message);
}

function streamClaudeAgent(
  pi: ExtensionAPI,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output = createEmptyOutput(model);
  const sdkModelId = getSdkModelId(model.id);
  const prompt = extractLatestUserPrompt(context);

  const activeTurn: ActiveTurn = {
    model,
    output,
    stream,
    blockMap: new Map(),
    toolNameByIndex: new Map(),
    toolIdByIndex: new Map(),
    startedWithPersistedSession: Boolean(runtimeState.sdkSessionId),
    shouldRetryFreshSession: false,
    finished: false,
  };

  const abort = () => {
    closeActiveSession();
    failActiveTurn(new Error("Claude Agent SDK request aborted"));
  };

  options?.signal?.addEventListener("abort", abort, { once: true });
  stream.push({ type: "start", partial: output });

  const runTurn = async () => {
    if (options?.signal?.aborted) {
      throw new Error("Claude Agent SDK request aborted");
    }

    beginTurn(model.id);
    runtimeState.activeTurn = activeTurn;
    logDebug("turn start", { model: model.id, sdkModelId, hasPersistedSession: Boolean(runtimeState.sdkSessionId) });

    let canRetryFreshSession = Boolean(runtimeState.sdkSessionId);

    while (true) {
      try {
        activeTurn.startedWithPersistedSession = Boolean(runtimeState.sdkSessionId);
        const session = getOrCreateSession(pi, sdkModelId);
        const handoff = buildPiSessionHandoff();
        const promptWithHandoff = mergePromptWithHandoff(prompt, handoff);
        logDebug("session ready", {
          sessionId: runtimeState.sdkSessionId,
          includedHandoff: Boolean(handoff),
          handoffLength: handoff?.length ?? 0,
          promptType: typeof promptWithHandoff === "string" ? "text" : "blocks",
          promptPreview:
            typeof promptWithHandoff === "string"
              ? truncateText(promptWithHandoff, 120)
              : promptWithHandoff.map((block) => (block.type === "text" ? truncateText(block.text, 120) : "[image]")).join(" | "),
        });
        await sendPrompt(session, promptWithHandoff);
        logDebug("prompt sent");

        for await (const message of session.stream()) {
          processSessionMessage(pi, message);
          if (activeTurn.finished) break;
        }

        if (!activeTurn.finished) {
          if (activeTurn.shouldRetryFreshSession) {
            throw new Error("Claude Agent resumed session returned an empty success result");
          }
          throw new Error("Claude Agent SDK session ended unexpectedly");
        }

        logDebug("turn complete", {
          stopReason: activeTurn.output.stopReason,
          contentBlocks: activeTurn.output.content.length,
          resultTextLength:
            activeTurn.output.content.length > 0 && activeTurn.output.content[0]?.type === "text"
              ? activeTurn.output.content[0].text.length
              : 0,
        });
        return;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (canRetryFreshSession) {
          canRetryFreshSession = false;
          closeActiveSession();
          savePersistedState(runtimeState, pi, { sdkSessionId: undefined, syncedThroughEntryId: undefined }, invalidateWidget);
          logDebug("resume failed; retrying fresh session", { error: err.message });
          logDebug("retrying fresh session after resume failure", { error: err.message });
          runtimeState.ui?.notify(
            `Claude Agent resume failed (${err.message}). Retrying with a fresh Claude session.`,
            "warning",
          );
          beginTurn(model.id);
          continue;
        }

        logDebug("turn failed", { error: err.message });
        failActiveTurn(err);
        return;
      }
    }
  };

  runtimeState.turnQueue = runtimeState.turnQueue.then(runTurn, runTurn).catch((error) => {
    failActiveTurn(error instanceof Error ? error : new Error(String(error)));
  }).finally(() => {
    options?.signal?.removeEventListener("abort", abort);
    if (runtimeState.activeTurn === activeTurn) {
      runtimeState.activeTurn = undefined;
    }
  });

  return stream;
}

export default function claudeAgentProviderExtension(pi: ExtensionAPI) {
  pi.on("session_before_switch", (event) => {
    logDebug("session_before_switch", { reason: event.reason, targetSessionFile: event.targetSessionFile });
    closeLiveClaudeSession(`session_before_switch:${event.reason}`);
  });

  pi.on("session_before_fork", (event) => {
    logDebug("session_before_fork", { entryId: event.entryId });
    closeLiveClaudeSession("session_before_fork");
  });

  pi.on("session_before_tree", (event) => {
    logDebug("session_before_tree", {
      targetId: event.preparation.targetId,
      oldLeafId: event.preparation.oldLeafId,
      commonAncestorId: event.preparation.commonAncestorId,
    });
    closeLiveClaudeSession("session_before_tree");
  });

  pi.on("session_before_compact", (event, ctx) => {
    logDebug("session_before_compact", {
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      hasLiveSession: Boolean(runtimeState.session),
      sdkSessionId: runtimeState.sdkSessionId,
      currentProvider: ctx.model?.provider,
      customInstructions: event.customInstructions,
    });

    if (ctx.model?.provider !== PROVIDER_ID) {
      return;
    }

    const compactCommand = event.customInstructions?.trim()
      ? `/compact ${event.customInstructions.trim()}`
      : "/compact";

    logDebug("redirecting-pi-compact-to-claude", {
      compactCommand,
      sdkSessionId: runtimeState.sdkSessionId,
      hasLiveSession: Boolean(runtimeState.session),
    });
    ctx.ui.notify("Redirecting compaction to Claude runtime.", "info");
    pi.sendUserMessage(compactCommand);
    return { cancel: true };
  });

  pi.on("session_start", (event, ctx) => {
    const sessionStart = event as { reason?: string; previousSessionFile?: string };
    runtimeState.cwd = ctx.cwd;
    runtimeState.sessionManager = ctx.sessionManager;
    runtimeState.debugLogPath = undefined;
    const logPath = ensureDebugLogPath();
    logDebug("session_start", {
      cwd: ctx.cwd,
      reason: sessionStart.reason,
      previousSessionFile: sessionStart.previousSessionFile,
    });
    runtimeState.ui = {
      select: (title, options) => ctx.ui.select(title, options),
      input: (title, placeholder) => ctx.ui.input(title, placeholder),
      confirm: (title, message) => ctx.ui.confirm(title, message),
      notify: (message, type) => ctx.ui.notify(message, type),
    };
    loadPersistedState(runtimeState, ctx);
    clearTurn();

    if (sessionStart.reason === "new" || sessionStart.reason === "fork") {
      invalidateClaudeLineage(pi, `session_start:${sessionStart.reason}`);
    }

    if (ctx.model?.provider === PROVIDER_ID) {
      warmClaudeSession(pi, ctx.model.id, `session_start:${sessionStart.reason ?? "unknown"}`);
    } else if (runtimeState.sdkSessionId && runtimeState.lastClaudeModelId) {
      warmClaudeSession(pi, runtimeState.lastClaudeModelId, `session_start:${sessionStart.reason ?? "unknown"}:resume_saved`);
    }

    if (ctx.hasUI) {
      ctx.ui.setWidget(
        WIDGET_KEY,
        (tui) => {
          runtimeState.widget = new ClaudeAgentWidget(
            tui,
            () => runtimeState.turn,
            () => runtimeState.cwd,
            toPiToolView,
          );
          return runtimeState.widget;
        },
        { placement: "aboveEditor" },
      );
    }
  });

  pi.on("session_shutdown", () => {
    logDebug("session_shutdown");
    closeLiveClaudeSession("session_shutdown");
    runtimeState.sessionManager = undefined;
    clearTurn();
  });

  pi.on("session_tree", (event, ctx) => {
    logDebug("session_tree", { oldLeafId: event.oldLeafId, newLeafId: event.newLeafId, fromExtension: event.fromExtension });
    if (ctx.model?.provider !== PROVIDER_ID) return;

    invalidateClaudeLineage(pi, "session_tree");
  });

  pi.on("session_compact", (event, ctx) => {
    logDebug("session_compact", {
      compactionEntryId: event.compactionEntry.id,
      fromExtension: event.fromExtension,
      hasLiveSession: Boolean(runtimeState.session),
      sdkSessionId: runtimeState.sdkSessionId,
      currentProvider: ctx.model?.provider,
    });
    if (ctx.model?.provider !== PROVIDER_ID) return;

    savePersistedState(runtimeState, pi, { syncedThroughEntryId: event.compactionEntry.id }, invalidateWidget);
  });

  pi.on("model_select", (event) => {
    if (event.previousModel?.provider === PROVIDER_ID && event.model.provider !== PROVIDER_ID) {
      const hadActiveTurn = Boolean(runtimeState.activeTurn);
      if (hadActiveTurn) {
        closeLiveClaudeSession("model_select_away_from_claude_agent_active_turn");
        failActiveTurn(new Error("Claude Agent request cancelled after switching models"));
        clearTurn();
      } else {
        logDebug("model_select_away_from_claude_agent", {
          nextProvider: event.model.provider,
          keptLiveSession: Boolean(runtimeState.session),
          sdkSessionId: runtimeState.sdkSessionId,
        });
      }
      return;
    }

    if (event.model.provider === PROVIDER_ID) {
      warmClaudeSession(pi, event.model.id, `model_select:${event.source}`);
    }
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;
    savePersistedState(runtimeState, pi, { syncedThroughEntryId: leafId }, invalidateWidget);
  });

  pi.registerCommand("claude", {
    description: "Claude Agent runtime controls. Subcommands: help, info, context, mcp, reload",
    getArgumentCompletions: (prefix) => {
      const subcommands = ["help", "info", "context", "mcp", "reload"];
      const parts = prefix.trimStart().split(/\s+/);
      if (parts.length > 1) return null;
      const partial = parts[0] ?? "";
      const matches = subcommands.filter((subcommand) => subcommand.startsWith(partial));
      return matches.map((subcommand) => ({ value: subcommand, label: subcommand }));
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = (parts[0] ?? "help").toLowerCase();

      try {
        switch (subcommand) {
          case "help":
            ctx.ui.notify(buildClaudeHelpLines(ctx).join("\n"), "info");
            return;
          case "info":
            await showClaudeInfo(pi, ctx);
            return;
          case "context":
            await showClaudeContext(pi, ctx);
            return;
          case "mcp":
            await showClaudeMcp(pi, ctx);
            return;
          case "reload":
            await reloadClaudeRuntime(pi, ctx);
            return;
          default:
            ctx.ui.notify(
              `Unknown /claude subcommand: ${subcommand}\n\n${buildClaudeHelpLines(ctx).join("\n")}`,
              "warning",
            );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logDebug("claude-command-failed", { subcommand, message });
        ctx.ui.notify(`/claude ${subcommand} failed: ${message}`, "error");
      }
    },
  });

  registerClaudeProvider(pi, (model, context, options) => streamClaudeAgent(pi, model, context, options));
}
