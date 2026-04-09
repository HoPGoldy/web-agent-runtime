import { describe, expect, it } from "vitest";
import type { AgentRuntime } from "../src/runtime/contracts";
import { createAgentRuntime } from "../src/runtime/agent-runtime";
import { IndexedDbAgentStorage } from "../src/storage/indexed-db-agent-storage";
import type { AgentMessage } from "../src/session/session-types";
import {
  createAssistantTextMessage,
  createAssistantToolCallMessage,
  createSequenceLlmProvider,
  createStaticToolProvider,
} from "./runtime-test-helpers";

function createStorage(name: string) {
  return new IndexedDbAgentStorage({ dbName: name });
}

function readUserText(message: AgentMessage) {
  if (message.role !== "user") {
    return null;
  }

  return typeof message.content === "string"
    ? message.content
    : message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
}

describe("agent loop semantics", () => {
  it("injects steering after tool execution and before the next model call", async () => {
    const requests: Array<{ messages: AgentMessage[] }> = [];
    const llmProvider = createSequenceLlmProvider(
      [
        createAssistantToolCallMessage({
          type: "toolCall",
          id: "tool-call-1",
          name: "read",
          arguments: { key: "app.ts" },
        }),
        createAssistantTextMessage("done"),
      ],
      requests as never,
    );
    let runtimeRef: AgentRuntime | undefined;
    const toolProvider = createStaticToolProvider([
      {
        name: "read",
        description: "read",
        inputSchema: { type: "object" },
        async execute({ signal }) {
          expect(signal.aborted).toBe(false);
          await runtimeRef?.steer("steered");
          return {
            content: [{ type: "text", text: "tool result" }],
          };
        },
      },
    ]);
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider,
      storage: createStorage(`agent-loop-steer-${crypto.randomUUID()}`),
      toolProvider,
      systemPrompt: "System prompt",
    });
    runtimeRef = runtime;

    await runtime.prompt("start");

    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.map(readUserText).filter(Boolean)).toContain("steered");
  });

  it("delivers follow-up only after the agent would otherwise stop", async () => {
    const requests: Array<{ messages: AgentMessage[] }> = [];
    const llmProvider = createSequenceLlmProvider(
      [
        createAssistantToolCallMessage({
          type: "toolCall",
          id: "tool-call-2",
          name: "read",
          arguments: { key: "app.ts" },
        }),
        createAssistantTextMessage("intermediate"),
        createAssistantTextMessage("after follow-up"),
      ],
      requests as never,
    );
    let runtimeRef: AgentRuntime | undefined;
    const toolProvider = createStaticToolProvider([
      {
        name: "read",
        description: "read",
        inputSchema: { type: "object" },
        async execute() {
          await runtimeRef?.followUp("queued follow-up");
          return {
            content: [{ type: "text", text: "tool result" }],
          };
        },
      },
    ]);
    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider,
      storage: createStorage(`agent-loop-followup-${crypto.randomUUID()}`),
      toolProvider,
      systemPrompt: "System prompt",
    });
    runtimeRef = runtime;

    await runtime.prompt("start");

    expect(requests).toHaveLength(3);
    expect(requests[1]?.messages.map(readUserText).filter(Boolean)).not.toContain(
      "queued follow-up",
    );
    expect(requests[2]?.messages.map(readUserText).filter(Boolean)).toContain(
      "queued follow-up",
    );
  });
});