import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export type SdkUserMessage = SDKUserMessage;

export class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

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

  close() {
    if (this.closed) return;

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
