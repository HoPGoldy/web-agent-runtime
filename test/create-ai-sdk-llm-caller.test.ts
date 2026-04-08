import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { BuildAiSdkBodyOptions } from "../src/llm/create-ai-sdk-llm-caller";
import { createAiSdkLlmCaller } from "../src/llm/create-ai-sdk-llm-caller";

function createMessage(id: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  } as UIMessage;
}

function createTool(name: string) {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
      additionalProperties: false,
    },
    execute: vi.fn(),
  };
}

describe("createAiSdkLlmCaller", () => {
  it("builds the default request body from agent context", async () => {
    const tool = createTool("read");
    const caller = createAiSdkLlmCaller({ api: "/api/chat" });
    const transport = caller.createTransport({
      getSessionId: () => "session-1",
      getSystemPrompt: () => "You are a test agent.",
      getTools: () => [tool],
    }) as unknown as {
      api: string;
      prepareSendMessagesRequest: (options: {
        id: string;
        messages: UIMessage[];
      }) => Promise<{ body: Record<string, unknown> }>;
    };

    const request = await transport.prepareSendMessagesRequest({
      id: "chat-1",
      messages: [createMessage("message-1")],
    });

    expect(transport.api).toBe("/api/chat");
    expect(request).toEqual({
      body: {
        id: "session-1",
        systemPrompt: "You are a test agent.",
        messages: [createMessage("message-1")],
        tools: [
          {
            name: "read",
            description: "read tool",
            inputSchema: tool.inputSchema,
          },
        ],
      },
    });
  });

  it("delegates body creation to buildBody when provided", async () => {
    const tool = createTool("write");
    const buildBody = vi.fn(async (options: BuildAiSdkBodyOptions<UIMessage>) => ({
      chatId: options.chatId,
      toolCount: options.tools.length,
      custom: true,
    }));
    const caller = createAiSdkLlmCaller({
      api: "/api/chat",
      buildBody,
    });
    const transport = caller.createTransport({
      getSessionId: () => undefined,
      getSystemPrompt: () => "System prompt",
      getTools: () => [tool],
    }) as unknown as {
      prepareSendMessagesRequest: (options: {
        id: string;
        messages: UIMessage[];
      }) => Promise<{ body: Record<string, unknown> }>;
    };

    const request = await transport.prepareSendMessagesRequest({
      id: "chat-9",
      messages: [createMessage("message-9")],
    });

    expect(buildBody).toHaveBeenCalledWith({
      chatId: "chat-9",
      sessionId: undefined,
      systemPrompt: "System prompt",
      messages: [createMessage("message-9")],
      tools: [
        {
          name: "write",
          description: "write tool",
          inputSchema: tool.inputSchema,
        },
      ],
    });
    expect(request).toEqual({
      body: {
        chatId: "chat-9",
        toolCount: 1,
        custom: true,
      },
    });
  });
});
