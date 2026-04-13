import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import { DEFAULT_INDEXED_DB_STORAGE_NAME } from "../src/index";
import type { LlmProvider } from "../src/types/provider";
import type { AssistantMessage, RuntimeSessionData } from "../src/types/session";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createSequenceLlmProvider,
  createStaticTools,
} from "./runtime-test-helpers";

function createStorage(name: string) {
  return new IndexedDbAgentStorage<RuntimeSessionData>({ dbName: name });
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function readAssistantText(message: AssistantMessage | null) {
  if (!message) {
    return null;
  }

  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

function createStreamingLlmProvider(text: string): LlmProvider<AssistantMessage> {
  const finalMessage = createAssistantTextMessage(text, 3);
  const startMessage: AssistantMessage = {
    ...finalMessage,
    content: [],
    timestamp: 1,
  };
  const emptyTextMessage: AssistantMessage = {
    ...finalMessage,
    content: [{ type: "text", text: "" }],
    timestamp: 2,
  };
  const partialMessage: AssistantMessage = {
    ...finalMessage,
    content: [{ type: "text", text }],
    timestamp: 2,
  };

  return {
    async stream() {
      let iterationStarted = false;

      return {
        async *[Symbol.asyncIterator]() {
          iterationStarted = true;
          yield { type: "start", partial: startMessage };
          yield { type: "text_start", contentIndex: 0, partial: emptyTextMessage };
          yield { type: "text_delta", contentIndex: 0, delta: text, partial: partialMessage };
          yield { type: "text_end", contentIndex: 0, content: text, partial: partialMessage };
          yield { type: "done", message: finalMessage, reason: finalMessage.stopReason };
        },
        result() {
          const thenable: PromiseLike<AssistantMessage> = {
            then(onFulfilled, onRejected) {
              if (!iterationStarted) {
                throw new Error("result awaited before stream iteration started");
              }

              return Promise.resolve(finalMessage).then(onFulfilled, onRejected);
            },
          };

          return thenable as Promise<AssistantMessage>;
        },
      };
    },
  };
}

describe("agent runtime", () => {
  it("creates a session on first prompt, emits events, and persists session data", async () => {
    const storage = createStorage(`agent-runtime-${crypto.randomUUID()}`);
    const llmProvider = createSequenceLlmProvider([createAssistantTextMessage("hello back")]);
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider,
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });
    const eventTypes: string[] = [];

    runtime.subscribe((event) => {
      eventTypes.push(event.type);
    });

    await runtime.prompt("hello");

    expect(runtime.state.session).not.toBeNull();
    expect(runtime.state.messages).toHaveLength(2);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "session_created",
        "agent_start",
        "message_start",
        "message_update",
        "message_end",
        "agent_end",
      ]),
    );

    const stored = await storage.loadSessionData(runtime.state.session!.id);
    expect(stored?.data.entries).toHaveLength(2);
  });

  it("uses the default IndexedDB storage when storage is omitted", async () => {
    await deleteDatabase(DEFAULT_INDEXED_DB_STORAGE_NAME);

    const runtimeA = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("first answer")]),
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtimeA.prompt("first question");

    const runtimeB = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("second answer")]),
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtimeB.sessions.open(runtimeA.state.session!.id);

    expect(runtimeB.state.messages).toEqual(runtimeA.state.messages);
    expect(runtimeB.state.session?.id).toBe(runtimeA.state.session?.id);
  });

  it("rebuilds runtime state when reopening an existing session", async () => {
    const storage = createStorage(`agent-runtime-open-${crypto.randomUUID()}`);
    const runtimeA = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("first answer")]),
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtimeA.prompt("first question");

    const runtimeB = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("second answer")]),
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtimeB.sessions.open(runtimeA.state.session!.id);

    expect(runtimeB.state.messages).toEqual(runtimeA.state.messages);
    expect(runtimeB.state.session?.id).toBe(runtimeA.state.session?.id);
  });

  it("streams partial assistant updates before committing the final message", async () => {
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createStreamingLlmProvider("streamed"),
      storage: createStorage(`agent-runtime-stream-${crypto.randomUUID()}`),
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });
    const streamedTexts: string[] = [];

    runtime.subscribe((event) => {
      if (event.type === "state_changed") {
        const text = readAssistantText(event.state.streamMessage);
        if (text) {
          streamedTexts.push(text);
        }
      }
    });

    await runtime.prompt("hello");

    expect(streamedTexts).toContain("streamed");
    expect(runtime.state.messages.at(-1)).toEqual(createAssistantTextMessage("streamed", 3));
  });
});
