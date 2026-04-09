import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiCompatibleLlmProvider,
  type CreateOpenAiCompatibleLlmProviderOptions,
} from "../src/llm/create-openai-compatible-llm-provider";
import type { LlmProvider } from "../src/providers";
import type { AssistantMessage, UserMessage } from "../src/session/session-types";

function createUserMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: 1,
  };
}

function createEventStreamResponse(frames: string[]) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    },
  );
}

describe("createOpenAiCompatibleLlmProvider", () => {
  it("streams text deltas from an OpenAI-compatible SSE response", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "qwen-plus",
        messages: [
          { role: "system", content: "System prompt" },
          { role: "user", content: "hello" },
        ],
        max_tokens: 128,
        stream: true,
        stream_options: { include_usage: true },
      });

      return createEventStreamResponse([
        'data: {"id":"chatcmpl-1","model":"qwen-plus","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","model":"qwen-plus","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","model":"qwen-plus","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","model":"qwen-plus","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}\n\n',
        'data: {"id":"chatcmpl-1","model":"qwen-plus","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ]);
    });

    const provider = createOpenAiCompatibleLlmProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: fetchMock,
    }) as LlmProvider<unknown>;

    const stream = await provider.stream({
      model: { provider: "qwen", id: "qwen-plus" },
      maxTokens: 128,
      context: {
        systemPrompt: "System prompt",
        messages: [createUserMessage("hello")],
      },
    });

    const events = [] as Array<{ type: string }>;
    for await (const event of stream) {
      events.push({ type: event.type });
    }

    const message = (await stream.result()) as AssistantMessage;
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_delta",
      "text_end",
      "done",
    ]);
    expect(message).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      stopReason: "stop",
      provider: "qwen",
      model: "qwen-plus",
      timestamp: expect.any(Number),
      usage: {
        input: 5,
        output: 2,
        totalTokens: 7,
      },
    });
  });

  it("reconstructs tool calls from streamed function argument deltas", async () => {
    const fetchMock = vi.fn(async () =>
      createEventStreamResponse([
        'data: {"id":"chatcmpl-2","model":"qwen-plus","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"textarea_update","arguments":"{\\"text\\":\\""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-2","model":"qwen-plus","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"hello\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );

    const provider = createOpenAiCompatibleLlmProvider({
      apiKey: "test-key",
      fetch: fetchMock,
    } satisfies CreateOpenAiCompatibleLlmProviderOptions) as LlmProvider<unknown>;

    const stream = await provider.stream({
      model: { provider: "qwen", id: "qwen-plus" },
      context: {
        systemPrompt: "System prompt",
        messages: [createUserMessage("update the textarea")],
      },
    });

    const events = [] as Array<{ type: string }>;
    for await (const event of stream) {
      events.push({ type: event.type });
    }

    const message = (await stream.result()) as AssistantMessage;
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "toolcall_start",
      "toolcall_delta",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);
    expect(message.stopReason).toBe("toolUse");
    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "call_1",
        name: "textarea_update",
        arguments: {
          text: "hello",
        },
      },
    ]);
  });

  it("falls back to a buffered JSON response when the endpoint does not stream", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "gpt-4.1-mini",
            usage: {
              prompt_tokens: 4,
              completion_tokens: 3,
              total_tokens: 7,
            },
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "fallback",
                },
              },
            ],
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
    );

    const provider = createOpenAiCompatibleLlmProvider({
      apiKey: "test-key",
      fetch: fetchMock,
    }) as LlmProvider<unknown>;

    const stream = await provider.stream({
      model: { provider: "openai", id: "gpt-4.1-mini" },
      context: {
        systemPrompt: "System prompt",
        messages: [createUserMessage("hello")],
      },
    });

    const events = [] as Array<{ type: string }>;
    for await (const event of stream) {
      events.push({ type: event.type });
    }

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "done",
    ]);
    expect(await stream.result()).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "fallback" }],
      stopReason: "stop",
      provider: "openai",
      model: "gpt-4.1-mini",
      timestamp: expect.any(Number),
      usage: {
        input: 4,
        output: 3,
        totalTokens: 7,
      },
    });
  });
});
