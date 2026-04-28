import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import type { RuntimeSessionData } from "../src/types/session";
import type { RuntimeEvent, UndoResult } from "../src/types/runtime";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createSequenceLlmProvider,
  createStaticTools,
} from "./runtime-test-helpers";

function createTestRuntime(responseCount: number) {
  const responses = Array.from({ length: responseCount }, (_, i) =>
    createAssistantTextMessage(`answer ${i + 1}`),
  );
  const storage = new IndexedDbAgentStorage<RuntimeSessionData>({
    dbName: `undo-redo-${crypto.randomUUID()}`,
  });
  return {
    storage,
    runtime: createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider(responses),
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    }),
  };
}

describe("undo", () => {
  it("undoes the last user message and returns its content", async () => {
    const { runtime: runtimePromise } = createTestRuntime(2);
    const runtime = await runtimePromise;

    await runtime.prompt("question one");
    await runtime.prompt("question two");

    expect(runtime.state.messages).toHaveLength(4); // user, assistant, user, assistant

    // Find the second user message id
    const secondUserMsg = runtime.state.messages.find(
      (m, i) => m.role === "user" && i === 2,
    );
    expect(secondUserMsg?.id).toBeDefined();

    const result: UndoResult = await runtime.undo(secondUserMsg!.id!);

    expect(result.userMessage.role).toBe("user");
    expect(result.userMessage.content).toBe("question two");
    // After undo: only the first user+assistant pair remains
    expect(runtime.state.messages).toHaveLength(2);
    expect(runtime.state.messages[0].role).toBe("user");
    expect(runtime.state.messages[1].role).toBe("assistant");
  });

  it("undoes the first user message leaving an empty session", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;

    await runtime.prompt("only question");
    expect(runtime.state.messages).toHaveLength(2);

    const userMsg = runtime.state.messages.find((m) => m.role === "user");
    const result = await runtime.undo(userMsg!.id!);

    expect(result.userMessage.content).toBe("only question");
    expect(runtime.state.messages).toHaveLength(0);
  });

  it("emits undo_applied event", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    await runtime.prompt("hello");
    const userMsg = runtime.state.messages.find((m) => m.role === "user");
    await runtime.undo(userMsg!.id!);

    const undoEvent = events.find((e) => e.type === "undo_applied");
    expect(undoEvent).toBeDefined();
    expect(undoEvent!.type === "undo_applied" && undoEvent!.messageId).toBe(
      userMsg!.id,
    );
  });

  it("throws when message id is not found", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;
    await runtime.prompt("hello");

    await expect(runtime.undo("nonexistent-id")).rejects.toThrow(
      "Session entry not found",
    );
  });

  it("throws when message id refers to an assistant message", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;
    await runtime.prompt("hello");

    const assistantMsg = runtime.state.messages.find(
      (m) => m.role === "assistant",
    );
    await expect(runtime.undo(assistantMsg!.id!)).rejects.toThrow(
      "not a user message",
    );
  });

  it("persists undo to storage", async () => {
    const { storage, runtime: runtimePromise } = createTestRuntime(2);
    const runtime = await runtimePromise;

    await runtime.prompt("q1");
    await runtime.prompt("q2");

    const sessionId = runtime.state.session!.id;
    const secondUserMsg = runtime.state.messages[2];
    await runtime.undo(secondUserMsg.id!);

    // Verify storage was updated
    const stored = await storage.loadSessionData(sessionId);
    expect(stored).not.toBeNull();
    // The entries should still all exist, but headEntryId should point to before Q2
    expect(stored!.data.entries.length).toBe(4); // all entries preserved
  });
});

describe("redo", () => {
  it("redoes after a single undo", async () => {
    const { runtime: runtimePromise } = createTestRuntime(2);
    const runtime = await runtimePromise;

    await runtime.prompt("q1");
    await runtime.prompt("q2");
    expect(runtime.state.messages).toHaveLength(4);

    const secondUserMsg = runtime.state.messages[2];
    await runtime.undo(secondUserMsg.id!);
    expect(runtime.state.messages).toHaveLength(2);

    await runtime.redo();
    expect(runtime.state.messages).toHaveLength(4);
  });

  it("redoes after multiple undos", async () => {
    const { runtime: runtimePromise } = createTestRuntime(2);
    const runtime = await runtimePromise;

    await runtime.prompt("q1");
    await runtime.prompt("q2");

    // Undo q2
    const secondUserMsg = runtime.state.messages[2];
    await runtime.undo(secondUserMsg.id!);
    expect(runtime.state.messages).toHaveLength(2);

    // Undo q1
    const firstUserMsg = runtime.state.messages[0];
    await runtime.undo(firstUserMsg.id!);
    expect(runtime.state.messages).toHaveLength(0);

    // Redo goes all the way back to latest
    await runtime.redo();
    expect(runtime.state.messages).toHaveLength(4);
  });

  it("emits redo_applied event", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => events.push(e));

    await runtime.prompt("hello");
    const userMsg = runtime.state.messages.find((m) => m.role === "user");
    await runtime.undo(userMsg!.id!);
    await runtime.redo();

    const redoEvent = events.find((e) => e.type === "redo_applied");
    expect(redoEvent).toBeDefined();
  });

  it("throws when already at latest (no redo available)", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;
    await runtime.prompt("hello");

    // No undo was performed, redo should fail
    await expect(runtime.redo()).rejects.toThrow("No redo target available");
  });

  it("redo becomes unavailable after new input on undone branch", async () => {
    const { runtime: runtimePromise } = createTestRuntime(3);
    const runtime = await runtimePromise;

    await runtime.prompt("q1");
    await runtime.prompt("q2");

    const secondUserMsg = runtime.state.messages[2];
    await runtime.undo(secondUserMsg.id!);
    expect(runtime.state.messages).toHaveLength(2);

    // New input creates a branch
    await runtime.prompt("q3 alternative");
    expect(runtime.state.messages).toHaveLength(4);

    // Undo back to see both branches
    const altUserMsg = runtime.state.messages[2];
    await runtime.undo(altUserMsg.id!);

    // Now there are two children from entry-2 (assistant "answer one")
    // → the original q2 branch and the new q3 branch
    // So redo should fail
    await expect(runtime.redo()).rejects.toThrow("No redo target available");
  });
});

describe("message ids", () => {
  it("assigns stable ids to messages from session entries", async () => {
    const { runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;

    await runtime.prompt("hello");

    for (const msg of runtime.state.messages) {
      expect(msg.id).toBeDefined();
      expect(typeof msg.id).toBe("string");
      expect(msg.id!.length).toBeGreaterThan(0);
    }
  });

  it("preserves message ids across session reopen", async () => {
    const { storage, runtime: runtimePromise } = createTestRuntime(1);
    const runtime = await runtimePromise;

    await runtime.prompt("hello");
    const originalIds = runtime.state.messages.map((m) => m.id);
    const sessionId = runtime.state.session!.id;

    // Reopen session
    const runtime2 = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([]),
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });
    await runtime2.sessions.open(sessionId);

    const reopenedIds = runtime2.state.messages.map((m) => m.id);
    expect(reopenedIds).toEqual(originalIds);
  });
});
