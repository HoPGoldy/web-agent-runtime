import type { UIMessage } from "ai";
import type {
  CommitResult,
  MutationOptions,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "../session";
import type { AgentSessionCreateInput } from "../types";

export interface StorageInterface<UI_MESSAGE extends UIMessage = UIMessage> extends Omit<
  StorageProvider<UI_MESSAGE[]>,
  "createSession" | "getSession" | "listSessions" | "updateSession"
> {
  createSession(input?: AgentSessionCreateInput): Promise<SessionRecord>;
  getSession(id: string): Promise<SessionRecord | null>;
  listSessions(): Promise<SessionRecord[]>;
  updateSession(id: string, patch: UpdateSessionInput, options?: MutationOptions): Promise<SessionRecord>;
  loadMessages(id: string): Promise<UI_MESSAGE[]>;
  saveMessages(id: string, messages: UI_MESSAGE[], options?: MutationOptions): Promise<void | CommitResult>;
}
