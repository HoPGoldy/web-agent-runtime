import type { ModelRef, ThinkingLevel, TokenUsage } from "./provider";
import type { ForkSessionResult } from "./runtime";

/**
 * Metadata record persisted for each session.
 */
export interface SessionRecord {
  /** Stable session identifier. */
  id: string;
  /** Optional human-readable title for the session. */
  title?: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp for the latest persisted change. */
  updatedAt: string;
  /** Optimistic concurrency token for the current stored revision. */
  revision: string;
  /** Arbitrary host-defined metadata associated with the session. */
  metadata?: Record<string, unknown>;
}

/**
 * Session record bundled with its serialized session payload.
 */
export interface StoredSessionData<TSessionData = unknown> {
  /** Session metadata for the stored payload. */
  session: SessionRecord;
  /** Serialized runtime-specific session data. */
  data: TSessionData;
}

/**
 * Options controlling optimistic session mutations.
 */
export interface MutationOptions {
  /** Revision that must match before the mutation is applied. */
  expectedRevision?: string;
}

/**
 * Result returned after persisting session data.
 */
export interface CommitResult {
  /** Updated session metadata after the write succeeds. */
  session: SessionRecord;
  /** Revision generated for the successful write. */
  revision: string;
}

/**
 * Input for creating a new stored session.
 */
export interface CreateSessionInput {
  /** Optional custom session identifier. */
  id?: string;
  /** Optional session title. */
  title?: string;
  /** Arbitrary metadata to persist alongside the session. */
  metadata?: Record<string, unknown>;
}

/**
 * Partial update payload for stored session metadata.
 */
export interface UpdateSessionInput {
  /** Replacement title, when changing session labeling. */
  title?: string;
  /** Replacement metadata, typically merged by the caller before submission. */
  metadata?: Record<string, unknown>;
}

/**
 * Converts between runtime-native and persisted session data formats.
 */
export interface SessionDataCodec<
  TSessionData = unknown,
  TRuntimeSessionData = unknown,
> {
  /** Serializes runtime session data for storage. */
  serialize(data: TRuntimeSessionData): Promise<TSessionData> | TSessionData;
  /** Rehydrates runtime session data from its stored representation. */
  deserialize(
    data: TSessionData,
  ): Promise<TRuntimeSessionData> | TRuntimeSessionData;
}

/**
 * Persistence backend used by the runtime session store.
 */
export interface StorageProvider<TSessionData = unknown> {
  /** Creates and persists a new session record. */
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  /** Loads a single session record by id. */
  getSession(sessionId: string): Promise<SessionRecord | null>;
  /** Lists all sessions visible to the backend. */
  listSessions(): Promise<SessionRecord[]>;
  /** Updates persisted session metadata. */
  updateSession(
    sessionId: string,
    patch: UpdateSessionInput,
    options?: MutationOptions,
  ): Promise<SessionRecord>;
  /** Deletes a session and any associated stored payloads. */
  deleteSession(sessionId: string): Promise<void>;
  /** Loads the serialized payload for a session, if present. */
  loadSessionData(
    sessionId: string,
  ): Promise<StoredSessionData<TSessionData> | null>;
  /** Persists serialized session data for a session. */
  saveSessionData(
    sessionId: string,
    data: TSessionData,
    options?: MutationOptions,
  ): Promise<CommitResult>;
}

/**
 * Plain text content block stored in session history.
 */
export interface TextBlock {
  /** Discriminator for plain text content. */
  type: "text";
  /** Text payload shown to the user or model. */
  text: string;
}

/**
 * Inline image content stored in session history.
 */
export interface ImageBlock {
  /** Discriminator for inline image content. */
  type: "image";
  /** Image payload encoded as a string, typically base64 or a data URL body. */
  data: string;
  /** MIME type describing the image payload. */
  mimeType: string;
}

/**
 * Provider reasoning block attached to an assistant message.
 */
export interface ThinkingBlock {
  /** Discriminator for reasoning content. */
  type: "thinking";
  /** Provider-emitted reasoning text. */
  text: string;
  /** Optional provider signature or verification token for the reasoning block. */
  signature?: string;
}

/**
 * Tool call requested by an assistant message.
 */
export interface ToolCallBlock {
  /** Discriminator for assistant tool calls. */
  type: "toolCall";
  /** Stable id for matching the tool call with its result message. */
  id: string;
  /** Tool name requested by the assistant. */
  name: string;
  /** Structured arguments supplied for the tool call. */
  arguments: Record<string, unknown>;
}

/**
 * Structured content variants allowed in user messages.
 */
export type UserContentBlock = TextBlock | ImageBlock;

/**
 * Structured content variants allowed in assistant messages.
 */
export type AssistantContentBlock =
  | TextBlock
  | ImageBlock
  | ThinkingBlock
  | ToolCallBlock;

/**
 * Structured content variants allowed in tool result messages.
 */
export type ToolResultContentBlock = TextBlock | ImageBlock;

/**
 * User-authored message stored in a runtime session.
 */
export interface UserMessage {
  /** Identifies this record as a user message. */
  role: "user";
  /** User-authored content, either plain text or structured blocks. */
  content: string | UserContentBlock[];
  /** Unix timestamp in milliseconds for when the message was created. */
  timestamp: number;
  /** Arbitrary host-defined metadata associated with the message. */
  metadata?: Record<string, unknown>;
}

/**
 * Assistant response stored in a runtime session.
 */
export interface AssistantMessage {
  /** Identifies this record as an assistant message. */
  role: "assistant";
  /** Structured assistant output blocks, including text, thinking, images, and tool calls. */
  content: AssistantContentBlock[];
  /** Reason the provider ended generation. */
  stopReason: "stop" | "length" | "toolUse" | "aborted" | "error";
  /** Model id that generated the message. */
  model: string;
  /** Token usage reported for the assistant response, when available. */
  usage?: TokenUsage;
  /** Error message associated with a failed or aborted generation, when present. */
  errorMessage?: string;
  /** Unix timestamp in milliseconds for when the message was finalized. */
  timestamp: number;
  /** Arbitrary host-defined metadata associated with the message. */
  metadata?: Record<string, unknown>;
}

/**
 * Message capturing the result of a tool execution.
 */
export interface ToolResultMessage<TDetails = unknown> {
  /** Identifies this record as a tool result message. */
  role: "toolResult";
  /** Tool call id that this result satisfies. */
  toolCallId: string;
  /** Tool name that produced the result. */
  toolName: string;
  /** User-visible content emitted by the tool. */
  content: ToolResultContentBlock[];
  /** Optional structured result details retained for host logic. */
  details?: TDetails;
  /** Indicates whether the tool result should be treated as an error. */
  isError: boolean;
  /** Unix timestamp in milliseconds for when the result was recorded. */
  timestamp: number;
  /** Arbitrary host-defined metadata associated with the result. */
  metadata?: Record<string, unknown>;
}

/**
 * Host-defined custom message stored alongside normal conversation messages.
 */
export interface CustomMessage<
  TType extends string = string,
  TDetails = unknown,
> {
  /** Identifies this record as a host-defined custom message. */
  role: "custom";
  /** Application-defined custom subtype. */
  customType: TType;
  /** Content rendered or stored for the custom message. */
  content: string | UserContentBlock[];
  /** Optional structured details retained for host logic. */
  details?: TDetails;
  /** Whether the custom message should be shown in user-facing transcripts. */
  display?: boolean;
  /** Unix timestamp in milliseconds for when the message was created. */
  timestamp: number;
  /** Arbitrary host-defined metadata associated with the message. */
  metadata?: Record<string, unknown>;
}

/**
 * Any message record that may appear in runtime session history.
 */
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CustomMessage;

/**
 * Common fields shared by all session entries.
 */
export interface SessionEntryBase {
  /** Stable identifier for the session entry. */
  id: string;
  /** Parent entry id in the branch lineage, or null for the root entry. */
  parentId: string | null;
  /** ISO 8601 timestamp for when the entry was created. */
  timestamp: string;
}

/**
 * Session entry that appends a conversation message.
 */
export interface MessageEntry extends SessionEntryBase {
  /** Discriminator for a conversation message entry. */
  type: "message";
  /** Message appended by this session entry. */
  message: AgentMessage;
}

/**
 * Session entry that records a model selection change.
 */
export interface ModelChangeEntry extends SessionEntryBase {
  /** Discriminator for a model selection change entry. */
  type: "model_change";
  /** Full model selection stored after this entry. */
  model?: ModelRef;
  /** Legacy provider value retained for backward compatibility. */
  provider?: string;
  /** Legacy model id retained for backward compatibility. */
  modelId?: string;
}

/**
 * Session entry that records a reasoning level change.
 */
export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  /** Discriminator for a reasoning level change entry. */
  type: "thinking_level_change";
  /** Reasoning level selected after this entry. */
  thinkingLevel: ThinkingLevel;
}

/**
 * Session entry that replaces older history with a compacted summary.
 */
export interface CompactionEntry<TDetails = unknown> extends SessionEntryBase {
  /** Discriminator for a compaction summary entry. */
  type: "compaction";
  /** Summary text retained in place of older history. */
  summary: string;
  /** First historical entry that was preserved after compaction. */
  firstKeptEntryId: string;
  /** Approximate token count or text budget before compaction. */
  tokensBefore: number;
  /** Optional host-defined details about the compaction operation. */
  details?: TDetails;
}

/**
 * Session entry that records a summary for a forked branch.
 */
export interface BranchSummaryEntry<
  TDetails = unknown,
> extends SessionEntryBase {
  /** Discriminator for a branch summary entry. */
  type: "branch_summary";
  /** Entry id from which the summarized branch diverged. */
  fromId: string;
  /** Summary text describing the summarized branch. */
  summary: string;
  /** Optional host-defined details about the branch summary. */
  details?: TDetails;
}

/**
 * Session entry for host-owned data that should follow the branch lineage.
 */
export interface HostDataEntry<TData = unknown> extends SessionEntryBase {
  /** Discriminator for a host-owned data entry. */
  type: "host_data";
  /** Application-defined key for the stored host data. */
  key: string;
  /** Optional host-defined payload that should follow session branching. */
  data?: TData;
}

/**
 * Any entry type that may be stored in runtime session history.
 */
export type SessionEntry =
  | MessageEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | HostDataEntry;

/**
 * Persisted data model for a runtime session branch.
 */
export interface RuntimeSessionData {
  /** Schema version for the serialized runtime session payload. */
  version: number;
  /** Current branch head entry id, or null for an empty session. */
  headEntryId: string | null;
  /** All session entries known to the runtime. */
  entries: SessionEntry[];
  /** Optional metadata associated with the runtime session payload itself. */
  metadata?: Record<string, unknown>;
}

/**
 * Materialized view of a runtime session at a specific head entry.
 */
export interface RuntimeSessionView {
  /** Materialized message list visible at the selected head entry. */
  messages: AgentMessage[];
  /** Effective model selection at the selected head entry. */
  model: ModelRef;
  /** Effective reasoning level at the selected head entry. */
  thinkingLevel: ThinkingLevel;
  /** Head entry id that produced this view. */
  headEntryId: string | null;
}

/**
 * Runtime session record paired with its hydrated session data.
 */
export interface LoadedRuntimeSession {
  session: SessionRecord;
  data: RuntimeSessionData;
}

/**
 * Result of forking a runtime session, including the forked branch data.
 */
export interface ForkedRuntimeSession extends ForkSessionResult {
  data: RuntimeSessionData;
}
