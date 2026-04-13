import type { UIMessage } from "ai";

/**
 * Describes the session metadata exposed by the high-level agent API.
 */
export interface AgentSession {
  /** Stable identifier for the session. */
  id: string;
  /** Human-readable session title. */
  title: string;
  /** ISO 8601 timestamp indicating when the session was created. */
  createdAt: string;
  /** ISO 8601 timestamp indicating when the session was last updated. */
  updatedAt: string;
}

/**
 * Input accepted when creating a new agent session.
 */
export interface AgentSessionCreateInput {
  /** Optional custom session identifier. */
  id?: string;
  /** Optional title to assign to the new session. */
  title?: string;
}

/**
 * Options for opening an existing session through the agent facade.
 */
export interface AgentSessionOpenOptions {
  /** Creates the session automatically when it does not already exist. */
  createIfMissing?: boolean;
  /** Title to use if a missing session needs to be created. */
  title?: string;
}

/**
 * Partial update payload for agent-managed session metadata.
 */
export interface AgentSessionUpdateInput {
  /** Replacement title for the session. */
  title?: string;
  /** Explicit updated timestamp, typically managed by storage implementations. */
  updatedAt?: string;
}

/**
 * Lifecycle states reported by the high-level agent.
 */
export type AgentStatus = "ready" | "submitted" | "streaming" | "error" | "destroyed";

/**
 * Snapshot of the current high-level agent state.
 */
export interface AgentState<UI_MESSAGE extends UIMessage = UIMessage> {
  /** Current lifecycle status for the agent. */
  status: AgentStatus;
  /** Conversation messages currently held in memory. */
  messages: UI_MESSAGE[];
  /** Last runtime error surfaced by the chat stack, if any. */
  error: Error | null;
  /** Tool call ids that have started but not completed yet. */
  pendingToolCalls: Set<string>;
  /** Currently opened session, or null before initialization. */
  session: AgentSession | null;
  /** Whether the agent has opened or created its backing session. */
  isInitialized: boolean;
  /** System prompt currently supplied to the model transport. */
  systemPrompt: string;
}

/**
 * Events emitted through the high-level agent subscription API.
 */
export type AgentEvent<UI_MESSAGE extends UIMessage = UIMessage> =
  | { type: "state-changed"; state: AgentState<UI_MESSAGE> }
  | { type: "session-opened"; session: AgentSession }
  | { type: "session-created"; session: AgentSession }
  | { type: "session-updated"; session: AgentSession }
  | { type: "session-deleted"; sessionId: string }
  | {
      type: "tool-execution-start";
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      type: "tool-execution-update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool-execution-end";
      toolCallId: string;
      toolName: string;
      result?: unknown;
      error?: string;
      isError: boolean;
    }
  | { type: "destroyed" };
