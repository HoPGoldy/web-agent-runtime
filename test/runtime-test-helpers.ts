import type {
  ToolDefinition,
  ToolProvider,
  ToolProviderContext,
} from "../src/providers";
import type { AssistantMessage, ToolCallBlock, UserMessage } from "../src/session/session-types";
import { createResultStream } from "../src/llm/llm-provider-interface";
import type { LlmProvider } from "../src/llm/llm-provider-interface";

export function createUserMessage(text: string, timestamp = Date.now()): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp,
  };
}

export function createAssistantTextMessage(
  text: string,
  timestamp = Date.now(),
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    provider: "proxy",
    model: "claude-test",
    timestamp,
  };
}

export function createAssistantToolCallMessage(
  toolCall: ToolCallBlock,
  timestamp = Date.now(),
): AssistantMessage {
  return {
    role: "assistant",
    content: [toolCall],
    stopReason: "toolUse",
    provider: "proxy",
    model: "claude-test",
    timestamp,
  };
}

export function createSequenceLlmProvider(
  responses: AssistantMessage[],
  requests: Array<{ messages: unknown[] }> = [],
): LlmProvider<AssistantMessage> {
  let index = 0;

  return {
    async stream(request) {
      requests.push({ messages: request.context.messages });
      const message = responses[index] ?? responses[responses.length - 1];
      index += 1;
      return createResultStream(
        [
          { type: "start", partial: message },
          { type: "done", message, reason: message.stopReason },
        ],
        message,
      );
    },
  };
}

export function createStaticToolProvider<THostContext = unknown>(
  tools: Array<ToolDefinition<unknown, unknown, unknown, THostContext>>,
): ToolProvider<unknown, unknown, THostContext> {
  return {
    async getTools(
      _context: ToolProviderContext<unknown, THostContext>,
    ) {
      return tools;
    },
  };
}