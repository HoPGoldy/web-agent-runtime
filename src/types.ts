import type { UIMessage } from "ai";

export interface AgentSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionCreateInput {
  id?: string;
  title?: string;
}

export interface AgentSessionOpenOptions {
  createIfMissing?: boolean;
  title?: string;
}

export interface AgentSessionUpdateInput {
  title?: string;
  updatedAt?: string;
}

export type AgentStatus =
  | "ready"
  | "submitted"
  | "streaming"
  | "error"
  | "destroyed";

export interface AgentState<UI_MESSAGE extends UIMessage = UIMessage> {
  status: AgentStatus;
  messages: UI_MESSAGE[];
  error: Error | null;
  pendingToolCalls: Set<string>;
  session: AgentSession | null;
  isInitialized: boolean;
  systemPrompt: string;
}

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

export function createAgentId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
