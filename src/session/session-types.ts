import type { ModelRef, ThinkingLevel, TokenUsage } from "../providers";

export const RUNTIME_SESSION_DATA_VERSION = 1;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  signature?: string;
}

export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type UserContentBlock = TextBlock | ImageBlock;
export type AssistantContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock;
export type ToolResultContentBlock = TextBlock | ImageBlock;

export interface UserMessage {
  role: "user";
  content: string | UserContentBlock[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  stopReason: "stop" | "length" | "toolUse" | "aborted" | "error";
  provider: string;
  model: string;
  usage?: TokenUsage;
  errorMessage?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ToolResultContentBlock[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface CustomMessage<TType extends string = string, TDetails = unknown> {
  role: "custom";
  customType: TType;
  content: string | UserContentBlock[];
  details?: TDetails;
  display?: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;

export interface SessionEntryBase {
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: ThinkingLevel;
}

export interface CompactionEntry<TDetails = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: TDetails;
}

export interface BranchSummaryEntry<TDetails = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: TDetails;
}

export interface HostDataEntry<TData = unknown> extends SessionEntryBase {
  type: "host_data";
  key: string;
  data?: TData;
}

export type SessionEntry =
  | MessageEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | HostDataEntry;

export interface RuntimeSessionData {
  version: number;
  headEntryId: string | null;
  entries: SessionEntry[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeSessionView {
  messages: AgentMessage[];
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  headEntryId: string | null;
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
        model = {
          ...model,
          provider: entry.provider,
          id: entry.modelId,
        };
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
        return typeof entry.provider === "string" && typeof entry.modelId === "string";
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
