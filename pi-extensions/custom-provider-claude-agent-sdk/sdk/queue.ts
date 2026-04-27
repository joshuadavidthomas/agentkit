import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export type SdkUserMessage = SDKUserMessage;

const KEEP_ALIVE_TEXT = "[SYSTEM: Session is active. Continue autonomous work if you have outstanding tasks to complete. Do not hand back to the user until you are finished.]";

const KEEP_ALIVE_MESSAGE: SDKUserMessage = {
  type: "user",
  message: { role: "user", content: KEEP_ALIVE_TEXT },
  parent_tool_use_id: null,
  shouldQuery: false,
};

const DEFAULT_KEEP_ALIVE_MS = 15_000;

export class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  push(message: SDKUserMessage): boolean {
    if (this.closed) return false;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: message, done: false });
      return true;
    }

    this.pending.push(message);
    return true;
  }

  startKeepAlive(intervalMs?: number): void {
    if (this.keepAliveTimer) return;
    this.keepAliveTimer = setInterval(() => {
      this.push(KEEP_ALIVE_MESSAGE);
    }, intervalMs ?? DEFAULT_KEEP_ALIVE_MS);
    this.keepAliveTimer.unref?.();
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  close() {
    if (this.closed) return;

    this.stopKeepAlive();
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.pending.shift();
        if (message) return Promise.resolve({ value: message, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
