import type { ModelRef, ThinkingLevel, TokenUsage } from "../providers";
import { cloneSerializableValue } from "../runtime/runtime-compat";

/**
 * Current schema version used for persisted runtime session data.
 */
export const RUNTIME_SESSION_DATA_VERSION = 1;

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
export type AssistantContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock;

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
export interface CustomMessage<TType extends string = string, TDetails = unknown> {
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
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

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
export interface BranchSummaryEntry<TDetails = unknown> extends SessionEntryBase {
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

function cloneValue<T>(value: T): T {
  return cloneSerializableValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModelRefRecord(value: unknown): value is ModelRef {
  return isRecord(value) && typeof value.id === "string";
}

export function createRuntimeSessionData(metadata?: Record<string, unknown>): RuntimeSessionData {
  return {
    version: RUNTIME_SESSION_DATA_VERSION,
    headEntryId: null,
    entries: [],
    metadata,
  };
}

export function cloneRuntimeSessionData(data: RuntimeSessionData): RuntimeSessionData {
  return cloneValue(data);
}

export function createMessageEntry(input: Omit<MessageEntry, "type">): MessageEntry {
  return { ...input, type: "message" };
}

export function createModelChangeEntry(input: Omit<ModelChangeEntry, "type">): ModelChangeEntry {
  return { ...input, type: "model_change" };
}

export function createThinkingLevelChangeEntry(
  input: Omit<ThinkingLevelChangeEntry, "type">,
): ThinkingLevelChangeEntry {
  return { ...input, type: "thinking_level_change" };
}

export function createCompactionEntry(input: Omit<CompactionEntry, "type">): CompactionEntry {
  return { ...input, type: "compaction" };
}

export function createBranchSummaryEntry(input: Omit<BranchSummaryEntry, "type">): BranchSummaryEntry {
  return { ...input, type: "branch_summary" };
}

export function createHostDataEntry(input: Omit<HostDataEntry, "type">): HostDataEntry {
  return { ...input, type: "host_data" };
}

export function getSessionEntry(
  data: RuntimeSessionData,
  entryId: string | null | undefined,
): SessionEntry | null {
  if (!entryId) {
    return null;
  }

  return data.entries.find((entry) => entry.id === entryId) ?? null;
}

export function getSessionEntryLineage(
  data: RuntimeSessionData,
  entryId: string | null | undefined = data.headEntryId,
): SessionEntry[] {
  if (!entryId) {
    return [];
  }

  const entryMap = new Map(data.entries.map((entry) => [entry.id, entry]));
  const lineage: SessionEntry[] = [];
  let current = entryMap.get(entryId) ?? null;

  while (current) {
    lineage.unshift(current);
    current = current.parentId ? (entryMap.get(current.parentId) ?? null) : null;
  }

  return lineage;
}

export function appendSessionEntry(data: RuntimeSessionData, entry: SessionEntry): RuntimeSessionData {
  if (entry.parentId && !getSessionEntry(data, entry.parentId)) {
    throw new Error(`Unknown parent entry: ${entry.parentId}`);
  }

  if (getSessionEntry(data, entry.id)) {
    throw new Error(`Duplicate session entry: ${entry.id}`);
  }

  return {
    ...cloneRuntimeSessionData(data),
    entries: [...data.entries, cloneValue(entry)],
    headEntryId: entry.id,
  };
}

export function extractBranchSessionData(data: RuntimeSessionData, headEntryId: string): RuntimeSessionData {
  const branchEntries = getSessionEntryLineage(data, headEntryId);
  if (branchEntries.length === 0) {
    throw new Error(`Session entry not found: ${headEntryId}`);
  }

  return {
    version: data.version,
    headEntryId,
    entries: cloneValue(branchEntries),
    metadata: cloneValue(data.metadata),
  };
}

function createCompactionSummaryMessage(entry: CompactionEntry): CustomMessage<"compaction_summary"> {
  return {
    role: "custom",
    customType: "compaction_summary",
    content: entry.summary,
    display: false,
    timestamp: Date.parse(entry.timestamp),
    metadata: {
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
    },
  };
}

function createBranchSummaryMessage(entry: BranchSummaryEntry): CustomMessage<"branch_summary"> {
  return {
    role: "custom",
    customType: "branch_summary",
    content: entry.summary,
    display: false,
    timestamp: Date.parse(entry.timestamp),
    metadata: {
      fromId: entry.fromId,
      details: entry.details,
    },
  };
}

export function buildRuntimeSessionView(
  data: RuntimeSessionData,
  defaults: {
    model: ModelRef;
    thinkingLevel: ThinkingLevel;
  },
): RuntimeSessionView {
  const lineage = getSessionEntryLineage(data, data.headEntryId);
  let model = cloneValue(defaults.model);
  let thinkingLevel = defaults.thinkingLevel;
  let messages: AgentMessage[] = [];

  for (const entry of lineage) {
    switch (entry.type) {
      case "message":
        messages = [...messages, cloneValue(entry.message)];
        break;
      case "model_change":
        if (isModelRefRecord(entry.model)) {
          model = cloneValue(entry.model);
          break;
        }

        if (typeof entry.modelId === "string") {
          const nextModel = cloneValue(model) as ModelRef & { provider?: unknown };
          nextModel.id = entry.modelId;
          delete nextModel.provider;
          model = nextModel;
        }
        break;
      case "thinking_level_change":
        thinkingLevel = entry.thinkingLevel;
        break;
      case "compaction":
        messages = [createCompactionSummaryMessage(entry)];
        break;
      case "branch_summary":
        messages = [...messages, createBranchSummaryMessage(entry)];
        break;
      case "host_data":
        break;
      default:
        break;
    }
  }

  return {
    messages,
    model,
    thinkingLevel,
    headEntryId: data.headEntryId,
  };
}

export function isRuntimeSessionData(value: unknown): value is RuntimeSessionData {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.version !== "number") {
    return false;
  }

  if (!(typeof value.headEntryId === "string" || value.headEntryId === null)) {
    return false;
  }

  if (!Array.isArray(value.entries)) {
    return false;
  }

  return value.entries.every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    if (
      typeof entry.id !== "string" ||
      !(typeof entry.parentId === "string" || entry.parentId === null) ||
      typeof entry.timestamp !== "string" ||
      typeof entry.type !== "string"
    ) {
      return false;
    }

    switch (entry.type) {
      case "message":
        return "message" in entry;
      case "model_change":
        return isModelRefRecord(entry.model) || typeof entry.modelId === "string";
      case "thinking_level_change":
        return typeof entry.thinkingLevel === "string";
      case "compaction":
        return (
          typeof entry.summary === "string" &&
          typeof entry.firstKeptEntryId === "string" &&
          typeof entry.tokensBefore === "number"
        );
      case "branch_summary":
        return typeof entry.fromId === "string" && typeof entry.summary === "string";
      case "host_data":
        return typeof entry.key === "string";
      default:
        return false;
    }
  });
}
