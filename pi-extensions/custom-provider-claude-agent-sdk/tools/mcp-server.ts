import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool as PiTool } from "@mariozechner/pi-ai";
import { MCP_SERVER_NAME } from "./names.js";

type PiMcpToolHandler = (toolName: string) => Promise<CallToolResult>;

function toolAnnotations(toolName: string): McpTool["annotations"] {
  return { readOnlyHint: toolName !== "bash" && toolName !== "edit" && toolName !== "write" };
}

function toMcpTool(tool: PiTool): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as McpTool["inputSchema"],
    annotations: toolAnnotations(tool.name),
  };
}

export function buildPiMcpServer(tools: PiTool[] | undefined, handler: PiMcpToolHandler) {
  const piTools = tools ?? [];
  if (piTools.length === 0) return undefined;

  const mcpTools = new Map(piTools.map((tool) => [tool.name, toMcpTool(tool)]));
  const server = new McpServer({ name: MCP_SERVER_NAME, version: "1.0.0" });

  server.server.registerCapabilities({ tools: { listChanged: true } });

  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...mcpTools.values()],
  }));

  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = mcpTools.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }

    return handler(tool.name);
  });

  return {
    type: "sdk" as const,
    name: MCP_SERVER_NAME,
    instance: server,
  };
}
