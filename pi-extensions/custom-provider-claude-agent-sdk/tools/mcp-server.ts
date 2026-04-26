import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@mariozechner/pi-ai";
import { z } from "zod";
import { MCP_SERVER_NAME } from "./names.js";

type PiMcpToolHandler = (toolName: string) => Promise<CallToolResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  let base: z.ZodTypeAny;

  if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every((value) => typeof value === "string")) {
    base = z.enum(prop.enum as [string, ...string[]]);
  } else if (prop.const !== undefined && ["string", "number", "boolean"].includes(typeof prop.const)) {
    base = z.literal(prop.const as string | number | boolean);
  } else {
    switch (prop.type) {
      case "string":
        base = z.string();
        break;
      case "number":
      case "integer":
        base = z.number();
        break;
      case "boolean":
        base = z.boolean();
        break;
      case "array":
        base = isRecord(prop.items) ? z.array(jsonSchemaPropertyToZod(prop.items)) : z.array(z.unknown());
        break;
      case "object":
        base = z.record(z.string(), z.unknown());
        break;
      default:
        base = z.unknown();
        break;
    }
  }

  if (typeof prop.description === "string") {
    base = base.describe(prop.description);
  }

  return base;
}

function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) return {};

  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!isRecord(prop)) {
      shape[key] = required.has(key) ? z.unknown() : z.unknown().optional();
      continue;
    }

    const zodProp = jsonSchemaPropertyToZod(prop);
    shape[key] = required.has(key) ? zodProp : zodProp.optional();
  }

  return shape;
}

export function buildPiMcpServer(tools: Tool[] | undefined, handler: PiMcpToolHandler) {
  const mcpTools = (tools ?? []).map((piTool) =>
    tool(
      piTool.name,
      piTool.description,
      jsonSchemaToZodShape(piTool.parameters),
      async () => handler(piTool.name),
      { annotations: { readOnlyHint: piTool.name !== "bash" && piTool.name !== "edit" && piTool.name !== "write" } },
    ),
  );

  if (mcpTools.length === 0) return undefined;

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: "1.0.0",
    tools: mcpTools,
  });
}
