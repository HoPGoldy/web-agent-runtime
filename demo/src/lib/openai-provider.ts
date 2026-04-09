import {
  createResultStream,
  type AgentMessage,
  type AssistantMessage,
  type AssistantStreamEvent,
  type LlmProvider,
  type LlmStreamRequest,
  type ThinkingLevel,
  type ToolCallBlock,
  type ToolResultContentBlock,
} from "web-agent-runtime";

export interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  project?: string;
  organization?: string;
}

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

interface OpenAiCompletionResponse {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  choices: Array<{
    finish_reason: string | null;
    message: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}

let didWarnAboutBrowserKey = false;

export function createOpenAiLlmProvider(options: OpenAiProviderOptions): LlmProvider<AssistantMessage> {
  if (!didWarnAboutBrowserKey) {
    console.warn(
      "[web-agent demo] VITE_OPENAI_API_KEY is being sent from the browser to an OpenAI-compatible endpoint. This is only acceptable for a local demo. In production, move the API key to a backend proxy.",
    );
    didWarnAboutBrowserKey = true;
  }

  return {
    async stream(request) {
      const requestUrl = resolveChatCompletionsUrl(options.baseUrl);
      const requestBody = JSON.stringify(buildRequestBody(request));
      const response = await fetch(requestUrl, {
        method: "POST",
        headers: buildHeaders(options.apiKey, options.organization, options.project),
        body: requestBody,
        signal: request.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
          `OpenAI request failed: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ""}`,
        );
      }

      const payload = (await response.json()) as OpenAiCompletionResponse;
      const assistantMessage = toAssistantMessage(request, payload);
      const events = buildAssistantEvents(assistantMessage);
      return createResultStream(events, assistantMessage);
    },
  };
}

function resolveChatCompletionsUrl(baseUrl?: string) {
  if (!baseUrl) {
    return "https://api.openai.com/v1/chat/completions";
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "https://api.openai.com/v1/chat/completions";
  }

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed.replace(/\/+$/, "")}/chat/completions`;
}

function buildHeaders(apiKey: string, organization?: string, project?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (organization) {
    headers["OpenAI-Organization"] = organization;
  }

  if (project) {
    headers["OpenAI-Project"] = project;
  }

  return headers;
}

function buildRequestBody(request: LlmStreamRequest<AssistantMessage>) {
  return {
    model: request.model.id,
    messages: [
      {
        role: "system",
        content: request.context.systemPrompt,
      },
      ...toOpenAiMessages(request.context.messages as AgentMessage[]),
    ],
    tools: request.context.tools?.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    tool_choice: request.context.tools?.length ? "auto" : undefined,
    parallel_tool_calls: request.context.tools?.length ? true : undefined,
    max_completion_tokens: request.maxTokens,
    reasoning_effort: toReasoningEffort(request.reasoning),
  };
}

function toReasoningEffort(reasoning: ThinkingLevel | undefined) {
  switch (reasoning) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return undefined;
  }
}

function toOpenAiMessages(messages: AgentMessage[]): OpenAiMessage[] {
  return messages.reduce<OpenAiMessage[]>((accumulator, message) => {
    switch (message.role) {
      case "user":
        accumulator.push({
          role: "user",
          content: serializeMaybeRichContent(message.content),
        });
        return accumulator;
      case "assistant": {
        const textContent = serializeAssistantText(message);
        const toolCalls = message.content
          .filter((block): block is ToolCallBlock => block.type === "toolCall")
          .map((toolCall) => ({
            id: toolCall.id,
            type: "function" as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          }));
        accumulator.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        return accumulator;
      }
      case "toolResult":
        accumulator.push({
          role: "tool",
          tool_call_id: message.toolCallId,
          content: serializeToolResultContent(message.content),
        });
        return accumulator;
      case "custom":
        accumulator.push({
          role: "user",
          content: `[${message.customType}] ${serializeMaybeRichContent(message.content)}`,
        });
        return accumulator;
      default:
        return accumulator;
    }
  }, []);
}

function serializeAssistantText(message: AssistantMessage) {
  return message.content
    .flatMap((block) => {
      if (block.type === "text") {
        return [block.text];
      }

      if (block.type === "thinking") {
        return [`[thinking]\n${block.text}`];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

function serializeMaybeRichContent(
  content: string | Array<{ type: string; text?: string; mimeType?: string }>,
) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text ?? "";
      }

      if (block.type === "image") {
        return `[image:${block.mimeType ?? "unknown"}]`;
      }

      return `[${block.type}]`;
    })
    .join("\n")
    .trim();
}

function serializeToolResultContent(content: ToolResultContentBlock[]) {
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      return `[image:${block.mimeType}]`;
    })
    .join("\n")
    .trim();
}

function toAssistantMessage(
  request: LlmStreamRequest<AssistantMessage>,
  payload: OpenAiCompletionResponse,
): AssistantMessage {
  const choice = payload.choices[0];
  if (!choice) {
    throw new Error("OpenAI returned no choices");
  }

  const text = normalizeOpenAiText(choice.message.content);
  const toolCalls = (choice.message.tool_calls ?? []).map<ToolCallBlock>((toolCall) => ({
    type: "toolCall",
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: parseToolCallArguments(toolCall.function.arguments),
  }));
  const content = [...(text ? [{ type: "text", text }] : []), ...toolCalls] as AssistantMessage["content"];

  return {
    role: "assistant",
    content,
    stopReason: mapFinishReason(choice.finish_reason, toolCalls.length > 0),
    provider: "openai",
    model: payload.model ?? request.model.id,
    timestamp: Date.now(),
    usage: payload.usage
      ? {
          input: payload.usage.prompt_tokens ?? 0,
          output: payload.usage.completion_tokens ?? 0,
          totalTokens: payload.usage.total_tokens,
        }
      : undefined,
  };
}

function normalizeOpenAiText(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseToolCallArguments(serialized: string) {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: serialized };
  }
}

function mapFinishReason(finishReason: string | null, hasToolCalls: boolean): AssistantMessage["stopReason"] {
  if (hasToolCalls || finishReason === "tool_calls") {
    return "toolUse";
  }

  if (finishReason === "length") {
    return "length";
  }

  if (finishReason === "content_filter") {
    return "error";
  }

  return "stop";
}

function buildAssistantEvents(message: AssistantMessage) {
  const partial = cloneAssistantMessage({
    ...message,
    content: [],
  });
  const events: Array<AssistantStreamEvent<AssistantMessage, ToolCallBlock>> = [
    {
      type: "start",
      partial: cloneAssistantMessage(partial),
    },
  ];

  for (const block of message.content) {
    const contentIndex = partial.content.length;

    if (block.type === "text") {
      partial.content.push({ type: "text", text: "" });
      events.push({
        type: "text_start",
        contentIndex,
        partial: cloneAssistantMessage(partial),
      });
      (partial.content[contentIndex] as { type: "text"; text: string }).text = block.text;
      events.push({
        type: "text_delta",
        contentIndex,
        delta: block.text,
        partial: cloneAssistantMessage(partial),
      });
      events.push({
        type: "text_end",
        contentIndex,
        content: block.text,
        partial: cloneAssistantMessage(partial),
      });
      continue;
    }

    if (block.type === "thinking") {
      partial.content.push({ type: "thinking", text: "" });
      events.push({
        type: "thinking_start",
        contentIndex,
        partial: cloneAssistantMessage(partial),
      });
      (partial.content[contentIndex] as { type: "thinking"; text: string }).text = block.text;
      events.push({
        type: "thinking_delta",
        contentIndex,
        delta: block.text,
        partial: cloneAssistantMessage(partial),
      });
      events.push({
        type: "thinking_end",
        contentIndex,
        content: block.text,
        partial: cloneAssistantMessage(partial),
      });
      continue;
    }

    if (block.type === "toolCall") {
      partial.content.push(block);
      events.push({
        type: "toolcall_start",
        contentIndex,
        partial: cloneAssistantMessage(partial),
      });
      events.push({
        type: "toolcall_end",
        contentIndex,
        toolCall: block,
        partial: cloneAssistantMessage(partial),
      });
      continue;
    }

    partial.content.push(block);
  }

  events.push({
    type: "done",
    message,
    reason: message.stopReason,
  });

  return events;
}

function cloneAssistantMessage(message: AssistantMessage) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(message);
  }

  return JSON.parse(JSON.stringify(message)) as AssistantMessage;
}
