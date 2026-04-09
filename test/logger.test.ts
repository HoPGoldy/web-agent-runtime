import { describe, expect, it } from "vitest";
import { createAgentRuntime, IndexedDbAgentStorage, LogLevel } from "../src";
import {
  createAssistantTextMessage,
  createAssistantToolCallMessage,
  createSequenceLlmProvider,
  createStaticTools,
} from "./runtime-test-helpers";

describe("logger", () => {
  it("emits runtime and storage logs through explicit logger options", async () => {
    const entries: Array<{ level: LogLevel; message: string }> = [];
    const loggerOptions = {
      logLevel: LogLevel.Verbose,
      loggerCallback: (level: LogLevel, message: string) => {
        entries.push({ level, message });
      },
    };

    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([createAssistantTextMessage("hello back")]),
      storage: new IndexedDbAgentStorage({
        dbName: `logger-runtime-${crypto.randomUUID()}`,
        loggerOptions,
      }),
      loggerOptions,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtime.prompt("hello");

    expect(
      entries.some(
        (entry) => entry.level === LogLevel.Info && entry.message.includes("runtime:prompt:start"),
      ),
    ).toBe(true);
    expect(entries.some((entry) => entry.message.includes("storage:indexeddb:create-session:start"))).toBe(
      true,
    );
  });

  it("filters verbose logs but preserves warnings when logLevel is warning", async () => {
    const entries: Array<{ level: LogLevel; message: string }> = [];
    const loggerOptions = {
      logLevel: LogLevel.Warning,
      loggerCallback: (level: LogLevel, message: string) => {
        entries.push({ level, message });
      },
    };

    const runtime = await createAgentRuntime({
      model: { provider: "proxy", id: "claude-test" },
      llmProvider: createSequenceLlmProvider([
        createAssistantToolCallMessage({
          type: "toolCall",
          id: "missing-tool-call",
          name: "missing_tool",
          arguments: {},
        }),
        createAssistantTextMessage("done"),
      ]),
      storage: new IndexedDbAgentStorage({
        dbName: `logger-warning-${crypto.randomUUID()}`,
        loggerOptions,
      }),
      loggerOptions,
      tools: createStaticTools([]),
      systemPrompt: "System prompt",
    });

    await runtime.prompt("hello");

    expect(entries.some((entry) => entry.message.includes("runtime:prompt:start"))).toBe(false);
    expect(
      entries.some(
        (entry) => entry.level === LogLevel.Warning && entry.message.includes("loop:tool-call:missing-tool"),
      ),
    ).toBe(true);
  });
});
