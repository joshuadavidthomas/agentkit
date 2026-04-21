import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
  type SDKSession,
  type SDKSessionOptions,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { PromptBlock } from "./types.js";

export interface OpenSessionParams {
  readonly model: string;
  readonly resumeId?: string;
  readonly options: SDKSessionOptions;
}

export class ClaudeSession {
  static open({ model, resumeId, options }: OpenSessionParams): ClaudeSession {
    const handle = resumeId
      ? unstable_v2_resumeSession(resumeId, options)
      : unstable_v2_createSession(options);
    return new ClaudeSession(handle, model);
  }

  private constructor(
    private readonly handle: SDKSession,
    readonly model: string,
  ) {}

  async send(prompt: string | PromptBlock[]): Promise<void> {
    if (typeof prompt === "string") {
      await this.handle.send(prompt);
      return;
    }
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      shouldQuery: true,
    };
    await this.handle.send(message);
  }

  messages(): AsyncGenerator<SDKMessage, void> {
    return this.handle.stream();
  }

  // SDK throws when sessionId is read before the session is initialized.
  // Fresh sessions only expose it after the first message; resumed sessions
  // expose it immediately.
  get sessionId(): string | undefined {
    try {
      return this.handle.sessionId;
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.handle.close();
  }
}
