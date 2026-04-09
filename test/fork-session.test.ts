import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import type { RuntimeSessionData } from "../src/session/session-types";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createSequenceLlmProvider,
  createStaticTools,
} from "./runtime-test-helpers";

describe("forked sessions", () => {
  it("creates a new session from a chosen source entry", async () => {
    const storage = new IndexedDbAgentStorage<never, RuntimeSessionData>({
      dbName: `fork-session-${crypto.randomUUID()}`,
    });
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([
        createAssistantTextMessage("answer one"),
        createAssistantTextMessage("answer two"),
      ]),
      storage,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtime.prompt("question one");
    await runtime.prompt("question two");

    const sourceSessionId = runtime.state.session!.id;
    const sourceData = await storage.loadSessionData(sourceSessionId);
    const forkPoint = sourceData?.data.entries[1]?.id;
    if (!forkPoint) {
      throw new Error("Missing fork point");
    }

    const result = await runtime.sessions.fork({
      sourceSessionId,
      fromEntryId: forkPoint,
      title: "Forked Session",
    });

    expect(result.session.id).not.toBe(sourceSessionId);
    expect(runtime.state.session?.title).toBe("Forked Session");
    expect(runtime.state.messages).toHaveLength(2);
  });
});
