import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createSequenceLlmProvider,
  createStaticTools,
} from "./runtime-test-helpers";

function createStorage(name: string) {
  return new IndexedDbAgentStorage({ dbName: name });
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
});
