import { describe, expect, it, vi } from "vitest";
import { createAiSdkLlmProvider } from "../src/llm/create-ai-sdk-llm-caller";
import type { LlmProvider } from "../src/providers";
import type { AssistantMessage, UserMessage } from "../src/session/session-types";

function createUserMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: 1,
  };
}

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    provider: "proxy",
    model: "claude-test",
    timestamp: 2,
  };
}

describe("LLM provider contract", () => {
  it("normalizes backend event payloads into a result stream", async () => {
    const assistantMessage = createAssistantMessage("hello");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeTruthy();
      expect(JSON.parse(String(init?.body))).toEqual({
        id: "session-1",
        systemPrompt: "System prompt",
        messages: [createUserMessage("hello")],
        tools: [],
      });

      return new Response(
        JSON.stringify({
          events: [
            { type: "start", partial: createAssistantMessage("") },
            {
              type: "text_delta",
              contentIndex: 0,
              delta: "hello",
              partial: assistantMessage,
            },
            { type: "done", message: assistantMessage, reason: "stop" },
          ],
        }),
      );
    });
    const provider = createAiSdkLlmProvider({
      api: "/api/chat",
      fetch: fetchMock,
    }) as LlmProvider<unknown>;

    const stream = await provider.stream({
      model: { provider: "proxy", id: "claude-test" },
      sessionId: "session-1",
      context: {
        systemPrompt: "System prompt",
        messages: [createUserMessage("hello")],
        tools: [],
      },
    });
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(await stream.result()).toEqual(assistantMessage);
  });

  it("falls back to a single final message payload when events are omitted", async () => {
    const assistantMessage = createAssistantMessage("fallback");
    const provider = createAiSdkLlmProvider({
      api: "/api/chat",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: assistantMessage,
            }),
          ),
      ),
    }) as LlmProvider<unknown>;

    const stream = await provider.stream({
      model: { provider: "proxy", id: "claude-test" },
      context: {
        systemPrompt: "System prompt",
        messages: [createUserMessage("fallback")],
      },
    });
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", partial: assistantMessage },
      { type: "done", message: assistantMessage, reason: assistantMessage.stopReason },
    ]);
  });
});
