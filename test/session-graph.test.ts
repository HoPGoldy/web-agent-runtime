import { describe, expect, it } from "vitest";
import type { ModelRef } from "../src/providers";
import {
  appendSessionEntry,
  buildRuntimeSessionView,
  createCompactionEntry,
  createMessageEntry,
  createModelChangeEntry,
  createRuntimeSessionData,
  createThinkingLevelChangeEntry,
  extractBranchSessionData,
  isRuntimeSessionData,
  type AssistantMessage,
  type UserMessage,
} from "../src/session/session-types";

function createUserMessage(id: string, content: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content,
    timestamp,
    metadata: { id },
  };
}

function createAssistantMessage(model: string, content: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: content }],
    stopReason: "stop",
    model,
    timestamp,
  };
}

describe("runtime session graph", () => {
  it("tracks entry lineage and rebuilds runtime view from branch head", () => {
    const initialModel: ModelRef = {
      provider: "test-provider",
      id: "model-a",
      reasoning: true,
    };
    const sessionData = createRuntimeSessionData();
    const withUser = appendSessionEntry(
      sessionData,
      createMessageEntry({
        id: "entry-user",
        parentId: null,
        timestamp: "2026-04-09T00:00:00.000Z",
        message: createUserMessage("user-1", "hello", 1),
      }),
    );
    const withModelChange = appendSessionEntry(
      withUser,
      createModelChangeEntry({
        id: "entry-model",
        parentId: "entry-user",
        timestamp: "2026-04-09T00:00:01.000Z",
        model: {
          id: "model-b",
          api: "responses",
          metadata: { tier: "test" },
        },
      }),
    );
    const withThinking = appendSessionEntry(
      withModelChange,
      createThinkingLevelChangeEntry({
        id: "entry-thinking",
        parentId: "entry-model",
        timestamp: "2026-04-09T00:00:02.000Z",
        thinkingLevel: "high",
      }),
    );
    const fullSession = appendSessionEntry(
      withThinking,
      createMessageEntry({
        id: "entry-assistant",
        parentId: "entry-thinking",
        timestamp: "2026-04-09T00:00:03.000Z",
        message: createAssistantMessage("model-b", "world", 2),
      }),
    );

    const view = buildRuntimeSessionView(fullSession, {
      model: initialModel,
      thinkingLevel: "minimal",
    });

    expect(fullSession.headEntryId).toBe("entry-assistant");
    expect(view.messages).toEqual([
      createUserMessage("user-1", "hello", 1),
      createAssistantMessage("model-b", "world", 2),
    ]);
    expect(view.model).toEqual({
      id: "model-b",
      api: "responses",
      metadata: { tier: "test" },
    });
    expect(view.thinkingLevel).toBe("high");
  });

  it("accepts legacy model change entries without consuming provider", () => {
    const legacyData = {
      version: 1,
      headEntryId: "entry-model",
      entries: [
        {
          id: "entry-model",
          parentId: null,
          timestamp: "2026-04-09T00:00:01.000Z",
          type: "model_change",
          provider: "legacy-provider",
          modelId: "model-b",
        },
      ],
    };

    expect(isRuntimeSessionData(legacyData)).toBe(true);

    const view = buildRuntimeSessionView(legacyData, {
      model: {
        provider: "legacy-provider",
        id: "model-a",
        reasoning: true,
      },
      thinkingLevel: "off",
    });

    expect(view.model).toEqual({
      id: "model-b",
      reasoning: true,
    });
  });

  it("extracts a forkable branch from a chosen source entry", () => {
    const base = createRuntimeSessionData();
    const first = appendSessionEntry(
      base,
      createMessageEntry({
        id: "entry-1",
        parentId: null,
        timestamp: "2026-04-09T00:00:00.000Z",
        message: createUserMessage("user-1", "first", 1),
      }),
    );
    const second = appendSessionEntry(
      first,
      createMessageEntry({
        id: "entry-2",
        parentId: "entry-1",
        timestamp: "2026-04-09T00:00:01.000Z",
        message: createAssistantMessage("model-a", "second", 2),
      }),
    );
    const third = appendSessionEntry(
      second,
      createMessageEntry({
        id: "entry-3",
        parentId: "entry-2",
        timestamp: "2026-04-09T00:00:02.000Z",
        message: createUserMessage("user-2", "third", 3),
      }),
    );

    const branch = extractBranchSessionData(third, "entry-2");

    expect(branch.headEntryId).toBe("entry-2");
    expect(branch.entries.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
  });

  it("treats compaction as a context reset before replaying kept entries", () => {
    const base = createRuntimeSessionData();
    const original = appendSessionEntry(
      appendSessionEntry(
        base,
        createMessageEntry({
          id: "entry-1",
          parentId: null,
          timestamp: "2026-04-09T00:00:00.000Z",
          message: createUserMessage("user-1", "first", 1),
        }),
      ),
      createMessageEntry({
        id: "entry-2",
        parentId: "entry-1",
        timestamp: "2026-04-09T00:00:01.000Z",
        message: createAssistantMessage("model-a", "second", 2),
      }),
    );

    const compacted = appendSessionEntry(
      original,
      createCompactionEntry({
        id: "entry-compact",
        parentId: "entry-2",
        timestamp: "2026-04-09T00:00:02.000Z",
        summary: "summary text",
        firstKeptEntryId: "entry-2",
        tokensBefore: 128,
      }),
    );

    const view = buildRuntimeSessionView(compacted, {
      model: { provider: "provider", id: "model-a" },
      thinkingLevel: "off",
    });

    expect(view.messages).toEqual([
      {
        role: "custom",
        customType: "compaction_summary",
        content: "summary text",
        display: false,
        timestamp: Date.parse("2026-04-09T00:00:02.000Z"),
        metadata: {
          firstKeptEntryId: "entry-2",
          tokensBefore: 128,
        },
      },
    ]);
  });
});
