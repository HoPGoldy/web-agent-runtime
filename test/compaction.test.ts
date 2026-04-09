import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createSequenceLlmProvider,
  createStaticToolProvider,
} from "./runtime-test-helpers";

describe("compaction", () => {
  it("persists a compaction entry and rebuilds active context", async () => {
    const storage = new IndexedDbAgentStorage({
      dbName: `compaction-${crypto.randomUUID()}`,
    });
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([
        createAssistantTextMessage("answer one"),
        createAssistantTextMessage("answer two"),
        createAssistantTextMessage("answer three"),
        createAssistantTextMessage("summary"),
      ]),
      storage,
      toolProvider: createStaticToolProvider([]),
      systemPrompt: "System prompt",
    });

    await runtime.prompt("question one");
    await runtime.prompt("question two");
    await runtime.prompt("question three");

    const result = await runtime.compact();
    const stored = await storage.loadSessionData(runtime.state.session!.id);

    expect(result.summary).toBe("summary");
    expect(runtime.state.messages[0]).toMatchObject({
      role: "custom",
      customType: "compaction_summary",
    });
    expect(runtime.state.messages).toHaveLength(3);
    expect(
      stored?.data.entries.some((entry) => entry.type === "compaction"),
    ).toBe(true);
  });
});