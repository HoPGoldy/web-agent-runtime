import { createAgentId } from "../utils/agent";
import type { LlmProvider, ModelRef, ThinkingLevel } from "../types/provider";
import {
  appendSessionEntry,
  createCompactionEntry,
  createRuntimeSessionData,
  getSessionEntryLineage,
} from "../session/runtime-session-data";
import type {
  AgentMessage,
  AssistantMessage,
  CompactionEntry,
  MessageEntry,
  RuntimeSessionData,
  SessionEntry,
} from "../types/session";
import type { CompactionOptions, CompactionResult } from "../types/runtime";

function extractTextFromMessage(message: AgentMessage) {
  switch (message.role) {
    case "user":
    case "custom":
      return typeof message.content === "string"
        ? message.content
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
    case "assistant":
      return message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
    case "toolResult":
      return message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
  }
}

function createCloneId() {
  return `entry-${createAgentId()}`;
}

function cloneEntryWithParent(entry: SessionEntry, id: string, parentId: string | null): SessionEntry {
  return {
    ...entry,
    id,
    parentId,
  };
}

async function summarizeMessages(options: {
  llmProvider: LlmProvider<unknown>;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  sessionId?: string;
  messages: AgentMessage[];
  customInstructions?: string;
}) {
  const prompt = [
    "Summarize the earlier conversation so the runtime can keep going with less context.",
    options.customInstructions ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const stream = await options.llmProvider.stream({
    model: options.model,
    reasoning: options.thinkingLevel,
    sessionId: options.sessionId,
    context: {
      systemPrompt: `${options.systemPrompt}\n\n${prompt}`,
      messages: options.messages,
      tools: [],
    },
  });
  const result = (await stream.result()) as AssistantMessage;
  const summary = result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ")
    .trim();

  return summary;
}

export async function compactRuntimeSession(options: {
  data: RuntimeSessionData;
  llmProvider: LlmProvider<unknown>;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  sessionId?: string;
  compactionOptions?: CompactionOptions;
}): Promise<{
  data: RuntimeSessionData;
  result: CompactionResult;
}> {
  const lineage = getSessionEntryLineage(options.data);
  const messageEntries = lineage.filter((entry): entry is MessageEntry => entry.type === "message");
  if (messageEntries.length === 0) {
    return {
      data: options.data,
      result: {
        summary: "",
        firstKeptEntryId: options.data.headEntryId ?? "",
        tokensBefore: 0,
      },
    };
  }

  const keepCount = messageEntries.length > 2 ? 2 : 1;
  const firstKeptMessage = messageEntries[messageEntries.length - keepCount]!;
  const firstKeptIndex = lineage.findIndex((entry) => entry.id === firstKeptMessage.id);
  const keptEntries = lineage.slice(firstKeptIndex);
  const summarizedMessages = messageEntries
    .slice(0, Math.max(0, messageEntries.length - keepCount))
    .map((entry) => entry.message);
  const summary = await summarizeMessages({
    llmProvider: options.llmProvider,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    systemPrompt: options.systemPrompt,
    sessionId: options.sessionId,
    messages:
      summarizedMessages.length > 0 ? summarizedMessages : messageEntries.map((entry) => entry.message),
    customInstructions: options.compactionOptions?.customInstructions,
  });
  const compactionEntry = createCompactionEntry({
    id: `entry-${createAgentId()}`,
    parentId: firstKeptMessage.parentId,
    timestamp: new Date().toISOString(),
    summary,
    firstKeptEntryId: firstKeptMessage.id,
    tokensBefore: summarizedMessages.map(extractTextFromMessage).join(" ").length,
  });

  let nextData = appendSessionEntry(options.data, compactionEntry);
  let previousId = compactionEntry.id;
  for (const entry of keptEntries) {
    const clonedEntry = cloneEntryWithParent(entry, createCloneId(), previousId);
    nextData = appendSessionEntry(nextData, clonedEntry);
    previousId = clonedEntry.id;
  }

  return {
    data: nextData,
    result: {
      summary,
      firstKeptEntryId: firstKeptMessage.id,
      tokensBefore: compactionEntry.tokensBefore,
    },
  };
}
