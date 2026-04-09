import type { UIMessage } from "ai";
import type {
  CommitResult,
  MutationOptions,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "../session";
import type { AgentSessionCreateInput } from "../types";

/**
 * High-level storage contract used by the legacy Agent facade.
 */
export interface StorageInterface<UI_MESSAGE extends UIMessage = UIMessage> extends Omit<
  StorageProvider<UI_MESSAGE[]>,
  "createSession" | "getSession" | "listSessions" | "updateSession"
> {
  /** Creates a new session record for the high-level Agent facade. */
  createSession(input?: AgentSessionCreateInput): Promise<SessionRecord>;
  /** Loads a single session by id. */
  getSession(id: string): Promise<SessionRecord | null>;
  /** Lists all stored sessions. */
  listSessions(): Promise<SessionRecord[]>;
  /** Updates session metadata using optional optimistic concurrency. */
  updateSession(id: string, patch: UpdateSessionInput, options?: MutationOptions): Promise<SessionRecord>;
  /** Loads all chat messages for the given session id. */
  loadMessages(id: string): Promise<UI_MESSAGE[]>;
  /** Persists the complete message list for the given session id. */
  saveMessages(id: string, messages: UI_MESSAGE[], options?: MutationOptions): Promise<void | CommitResult>;
}
