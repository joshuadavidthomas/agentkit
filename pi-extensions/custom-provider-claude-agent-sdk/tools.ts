import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeExtensionState, ToolRenderState } from "./types.js";

export type ToolView = {
  toolName: string;
  args: Record<string, unknown>;
};

type ToolState = Pick<ClaudeExtensionState, "turn">;

type Invalidate = () => void;

export function ensureTool(
  state: ToolState,
  invalidate: Invalidate,
  toolUseId: string,
  rawName: string,
): ToolRenderState {
  if (!state.turn) {
    state.turn = {
      running: true,
      tools: [],
      startedAt: Date.now(),
    };
  }

  let tool = state.turn.tools.find((item) => item.toolUseId === toolUseId);
  if (!tool) {
    tool = {
      toolUseId,
      rawName,
      args: {},
      partialJson: "",
      isError: false,
      isComplete: false,
    };
    state.turn.tools.push(tool);
    invalidate();
  }
  return tool;
}

export function updateToolArgs(
  state: ToolState,
  invalidate: Invalidate,
  toolUseId: string,
  rawName: string,
  partialJson: string,
) {
  const tool = ensureTool(state, invalidate, toolUseId, rawName);
  tool.partialJson += partialJson;
  try {
    tool.args = JSON.parse(tool.partialJson) as Record<string, unknown>;
  } catch {
    // Partial JSON is expected while the SDK is still streaming.
  }
  invalidate();
}

export function completeToolArgs(
  state: ToolState,
  invalidate: Invalidate,
  toolUseId: string,
  rawName: string,
) {
  const tool = ensureTool(state, invalidate, toolUseId, rawName);
  if (!tool.partialJson) return;
  try {
    tool.args = JSON.parse(tool.partialJson) as Record<string, unknown>;
  } catch {
    // Keep best-effort args if the payload never became valid JSON.
  }
  invalidate();
}

export function updateToolProgress(
  state: ToolState,
  invalidate: Invalidate,
  message: Extract<SDKMessage, { type: "tool_progress" }>,
) {
  const tool = ensureTool(state, invalidate, message.tool_use_id, message.tool_name);
  tool.elapsedSeconds = message.elapsed_time_seconds;
  invalidate();
}

export function finishTool(
  state: ToolState,
  invalidate: Invalidate,
  toolUseId: string,
  resultText: string,
  isError: boolean,
) {
  const tool = ensureTool(state, invalidate, toolUseId, "tool");
  tool.resultText = resultText;
  tool.isError = isError;
  tool.isComplete = true;
  invalidate();
}

export function toPiToolView(rawName: string, args: Record<string, unknown>): ToolView {
  switch (rawName.toLowerCase()) {
    case "read":
      return {
        toolName: "read",
        args: { path: args.file_path, offset: args.offset, limit: args.limit },
      };
    case "bash":
      return {
        toolName: "bash",
        args: { command: args.command, timeout: args.timeout },
      };
    case "edit":
      return {
        toolName: "edit",
        args: {
          path: args.file_path,
          edits: [{ oldText: args.old_string, newText: args.new_string }],
        },
      };
    case "write":
      return {
        toolName: "write",
        args: { path: args.file_path, content: args.content },
      };
    case "glob":
      return {
        toolName: "find",
        args: { pattern: args.pattern, path: args.path },
      };
    case "grep":
      return {
        toolName: "grep",
        args: { pattern: args.pattern, path: args.path, glob: args.glob },
      };
    default:
      return { toolName: rawName, args };
  }
}
