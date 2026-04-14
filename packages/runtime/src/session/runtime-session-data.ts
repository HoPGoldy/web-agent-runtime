import type { ModelRef, ThinkingLevel } from "../types/provider";
import type {
  AgentMessage,
  BranchSummaryEntry,
  CompactionEntry,
  CustomMessage,
  HostDataEntry,
  MessageEntry,
  ModelChangeEntry,
  RuntimeSessionData,
  RuntimeSessionView,
  SessionEntry,
  ThinkingLevelChangeEntry,
} from "../types/session";
import { cloneSerializableValue } from "../utils/runtime-compat";

/**
 * Current schema version used for persisted runtime session data.
 */
export const RUNTIME_SESSION_DATA_VERSION = 1;

function cloneValue<T>(value: T): T {
  return cloneSerializableValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModelRefRecord(value: unknown): value is ModelRef {
  return isRecord(value) && typeof value.id === "string";
}

export function createRuntimeSessionData(
  metadata?: Record<string, unknown>,
): RuntimeSessionData {
  return {
    version: RUNTIME_SESSION_DATA_VERSION,
    headEntryId: null,
    entries: [],
    metadata,
  };
}

export function cloneRuntimeSessionData(
  data: RuntimeSessionData,
): RuntimeSessionData {
  return cloneValue(data);
}

export function createMessageEntry(
  input: Omit<MessageEntry, "type">,
): MessageEntry {
  return { ...input, type: "message" };
}

export function createModelChangeEntry(
  input: Omit<ModelChangeEntry, "type">,
): ModelChangeEntry {
  return { ...input, type: "model_change" };
}

export function createThinkingLevelChangeEntry(
  input: Omit<ThinkingLevelChangeEntry, "type">,
): ThinkingLevelChangeEntry {
  return { ...input, type: "thinking_level_change" };
}

export function createCompactionEntry(
  input: Omit<CompactionEntry, "type">,
): CompactionEntry {
  return { ...input, type: "compaction" };
}

export function createBranchSummaryEntry(
  input: Omit<BranchSummaryEntry, "type">,
): BranchSummaryEntry {
  return { ...input, type: "branch_summary" };
}

export function createHostDataEntry(
  input: Omit<HostDataEntry, "type">,
): HostDataEntry {
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
    current = current.parentId
      ? (entryMap.get(current.parentId) ?? null)
      : null;
  }

  return lineage;
}

export function appendSessionEntry(
  data: RuntimeSessionData,
  entry: SessionEntry,
): RuntimeSessionData {
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

export function extractBranchSessionData(
  data: RuntimeSessionData,
  headEntryId: string,
): RuntimeSessionData {
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

function createCompactionSummaryMessage(
  entry: CompactionEntry,
): CustomMessage<"compaction_summary"> {
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

function createBranchSummaryMessage(
  entry: BranchSummaryEntry,
): CustomMessage<"branch_summary"> {
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
          const nextModel = cloneValue(model) as ModelRef & {
            provider?: unknown;
          };
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

export function isRuntimeSessionData(
  value: unknown,
): value is RuntimeSessionData {
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
        return (
          isModelRefRecord(entry.model) || typeof entry.modelId === "string"
        );
      case "thinking_level_change":
        return typeof entry.thinkingLevel === "string";
      case "compaction":
        return (
          typeof entry.summary === "string" &&
          typeof entry.firstKeptEntryId === "string" &&
          typeof entry.tokensBefore === "number"
        );
      case "branch_summary":
        return (
          typeof entry.fromId === "string" && typeof entry.summary === "string"
        );
      case "host_data":
        return typeof entry.key === "string";
      default:
        return false;
    }
  });
}
