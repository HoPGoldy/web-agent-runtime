import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import {
  createAssistantTextMessage,
  createAssistantToolCallMessage,
  createSequenceLlmProvider,
  createStaticToolProvider,
} from "./runtime-test-helpers";

describe("agent runtime errors", () => {
  it("rejects continue without an active session", async () => {
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("unused")]),
      storage: new IndexedDbAgentStorage({
        dbName: `runtime-errors-continue-${crypto.randomUUID()}`,
      }),
      toolProvider: createStaticToolProvider([]),
      systemPrompt: "System prompt",
    });

    await expect(runtime.continue()).rejects.toThrow(
      "Cannot continue without an active session",
    );
  });

  it("surfaces codec failures without overwriting stored session data", async () => {
    const storage = new IndexedDbAgentStorage<never, Record<string, unknown>>({
      dbName: `runtime-errors-codec-${crypto.randomUUID()}`,
    });
    const session = await storage.createSession({ id: "session-1" });
    await storage.saveSessionData(
      session.id,
      { invalid: true },
      { expectedRevision: session.revision },
    );
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("unused")]),
      storage,
      sessionDataCodec: {
        async serialize(data) {
          return data as Record<string, unknown>;
        },
        async deserialize() {
          throw new Error("bad codec");
        },
      },
      toolProvider: createStaticToolProvider([]),
      systemPrompt: "System prompt",
    });

    await expect(runtime.sessions.open(session.id)).rejects.toThrow("bad codec");
    expect(await storage.loadSessionData(session.id)).toEqual({
      session: expect.objectContaining({ id: "session-1" }),
      data: { invalid: true },
    });
  });

  it("surfaces revision conflicts when runtime state is stale", async () => {
    const storage = new IndexedDbAgentStorage({
      dbName: `runtime-errors-revision-${crypto.randomUUID()}`,
    });
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([
        createAssistantTextMessage("answer one"),
        createAssistantTextMessage("answer two"),
      ]),
      storage,
      toolProvider: createStaticToolProvider([]),
      systemPrompt: "System prompt",
    });

    await runtime.prompt("question one");
    const stored = await storage.loadSessionData(runtime.state.session!.id);
    if (!stored) {
      throw new Error("Missing stored session data");
    }
    await storage.saveSessionData(runtime.state.session!.id, stored.data, {
      expectedRevision: runtime.state.session!.revision,
    });

    await expect(runtime.prompt("question two")).rejects.toThrow(
      `Revision conflict for session: ${runtime.state.session!.id}`,
    );
  });

  it("emits tool errors when a tool is aborted", async () => {
    const eventTypes: string[] = [];
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([
        createAssistantToolCallMessage({
          type: "toolCall",
          id: "tool-call-1",
          name: "read",
          arguments: { key: "app.ts" },
        }),
        createAssistantTextMessage("final"),
      ]),
      storage: new IndexedDbAgentStorage({
        dbName: `runtime-errors-abort-${crypto.randomUUID()}`,
      }),
      toolProvider: createStaticToolProvider([
        {
          name: "read",
          description: "read",
          inputSchema: { type: "object" },
          async execute({ signal }) {
            await new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => {
                reject(new Error("Tool aborted"));
              });
              setTimeout(resolve, 50);
            });
            return {
              content: [{ type: "text", text: "should not happen" }],
            };
          },
        },
      ]),
      systemPrompt: "System prompt",
    });

    runtime.subscribe((event) => {
      eventTypes.push(event.type);
    });

    const promptPromise = runtime.prompt("start");
    runtime.abort();
    await promptPromise;

    expect(eventTypes).toContain("tool_execution_end");
  });
});