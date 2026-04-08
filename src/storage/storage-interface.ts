import type { UIMessage } from "ai";
import type {
  AgentSession,
  AgentSessionCreateInput,
  AgentSessionUpdateInput,
} from "../types";

export interface StorageInterface<UI_MESSAGE extends UIMessage = UIMessage> {
  createSession(input?: AgentSessionCreateInput): Promise<AgentSession>;
  getSession(id: string): Promise<AgentSession | null>;
  listSessions(): Promise<AgentSession[]>;
  updateSession(
    id: string,
    patch: AgentSessionUpdateInput,
  ): Promise<AgentSession>;
  deleteSession(id: string): Promise<void>;
  loadMessages(id: string): Promise<UI_MESSAGE[]>;
  saveMessages(id: string, messages: UI_MESSAGE[]): Promise<void>;
}
