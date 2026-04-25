import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { HandoffSessionReader } from "./handoff.js";
import { appendSessionEntry, loadSessionEntry, type SessionEntryData } from "./persistence.js";
import { ClaudeSession } from "./session.js";

// Pi can evaluate this extension more than once in the same process: explicit
// `-e` plus installed extension, reloads, parent sessions plus scouts/subagents.
// The model registry is shared, so a later instance must not overwrite the
// registered `streamSimple` function for an active parent turn; tool-result
// callbacks would then route to an instance with an empty session map. Keep one
// active Claude session manager as the owner of this provider registration.
const ACTIVE_CLAUDE_SESSION_MANAGER_KEY = Symbol.for("agentkit.claude-agent-sdk.active-session-manager");

type ClaudeSessionManagerGlobal = typeof globalThis & { [ACTIVE_CLAUDE_SESSION_MANAGER_KEY]?: ClaudeSessionManager };

export type PiSessionManager = HandoffSessionReader & {
  getSessionId(): string;
  getLeafId(): string | null | undefined;
};

export function claimClaudeSessionManager(pi: ExtensionAPI): ClaudeSessionManager | undefined {
  const state = globalThis as ClaudeSessionManagerGlobal;
  if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY]) return undefined;

  const manager = new ClaudeSessionManager((data) => appendSessionEntry(pi, data));
  state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
  return manager;
}

export class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly persistSessionEntry: (data: SessionEntryData) => void) {}

  hydrateSession(sessionManager: PiSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    this.sessions.get(piSessionId)?.close();

    const session = new ClaudeSession(piSessionId, loadSessionEntry(sessionManager), sessionManager, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  currentSession(sessionManager: PiSessionManager): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  createSession(piSessionId: string): ClaudeSession {
    const session = new ClaudeSession(piSessionId, undefined, undefined, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  getSession(piSessionId: string): ClaudeSession | undefined {
    return this.sessions.get(piSessionId);
  }

  resetSessionForStructuralChange(sessionManager: PiSessionManager) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.reset();
  }

  markSessionSynced(sessionManager: PiSessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.markSyncedThrough(leafId);
  }

  shutdownSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
    session?.close();
    this.sessions.delete(piSessionId);

    if (this.sessions.size === 0) {
      const state = globalThis as ClaudeSessionManagerGlobal;
      if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] === this) {
        delete state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY];
      }
    }
  }
}
