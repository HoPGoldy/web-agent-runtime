import type { AssistantStreamEvent, LlmProvider, LlmStreamRequest } from "../providers";
import type {
  AgentMessage,
  AssistantMessage,
  ToolCallBlock,
  ToolResultContentBlock,
} from "../session/session-types";
import { createResultStream } from "./llm-provider-interface";

export interface CreateOpenAiCompatibleLlmProviderOptions {
  apiKey: string;
  baseUrl?: string;
  project?: string;
  organization?: string;
  headers?:
    | Record<string, string>
    | Headers
    | (() => Record<string, string> | Headers | Promise<Record<string, string> | Headers>);
  fetch?: typeof globalThis.fetch;
  includeUsage?: boolean;
  buildBody?: (
    request: LlmStreamRequest<AssistantMessage>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAiToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
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
      name?: string;
      content: string;
    };

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAiCompletionResponse {
  model?: string;
  usage?: OpenAiUsage;
  choices: Array<{
    finish_reason: string | null;
    message: {
      content?: string | null | Array<{ type?: string; text?: string }>;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}

interface OpenAiCompletionChunk {
  model?: string;
  usage?: OpenAiUsage;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAiToolCallDelta[];
    };
  }>;
}

interface IteratorWaiter<TEvent> {
  resolve: (value: IteratorResult<TEvent>) => void;
  reject: (error: unknown) => void;
}

interface ToolCallAccumulator {
  contentIndex: number;
  argumentsBuffer: string;
  nameBuffer: string;
  started: boolean;
}

interface StreamAccumulator {
  partial: AssistantMessage;
  finishReason: string | null;
  model?: string;
  usage?: OpenAiUsage;
  textIndex: number | null;
  textEnded: boolean;
  toolCalls: Map<number, ToolCallAccumulator>;
}

async function resolveHeaders(
  headers:
    | Record<string, string>
    | Headers
    | (() => Record<string, string> | Headers | Promise<Record<string, string> | Headers>)
    | undefined,
) {
  if (typeof headers === "function") {
    return headers();
  }

  return headers;
}

function createQueuedResultStream<TEvent, TResult>() {
  const queue: TEvent[] = [];
  const waiters: IteratorWaiter<TEvent>[] = [];
  let closed = false;
  let iteratorError: unknown;
  let resolveResult: (value: TResult) => void = () => undefined;
  let rejectResult: (error: unknown) => void = () => undefined;

  const resultPromise = new Promise<TResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function push(event: TEvent) {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }

    queue.push(event);
  }

  function close() {
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()?.resolve({ value: undefined as never, done: true });
    }
  }

  function fail(error: unknown) {
    iteratorError = error;
    closed = true;
    while (waiters.length > 0) {
      waiters.shift()?.reject(error);
    }
  }

  return {
    push,
    close,
    fail,
    resolveResult,
    rejectResult,
    stream: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift() as TEvent;
            continue;
          }

          if (iteratorError) {
            throw iteratorError;
          }

          if (closed) {
            return;
          }

          const item = await new Promise<IteratorResult<TEvent>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
          if (item.done) {
            return;
          }

          yield item.value;
        }
      },
      result() {
        return resultPromise;
      },
    },
  };
}

function cloneAssistantMessage(message: AssistantMessage) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(message);
  }

  return JSON.parse(JSON.stringify(message)) as AssistantMessage;
}

function createPartialAssistantMessage(request: LlmStreamRequest<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    stopReason: "stop",
    provider: request.model.provider,
    model: request.model.id,
    timestamp: Date.now(),
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

function createRequestHeaders(options: CreateOpenAiCompatibleLlmProviderOptions, resolved?: HeadersInit) {
  const headers = new Headers(resolved);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${options.apiKey}`);

  if (options.organization) {
    headers.set("OpenAI-Organization", options.organization);
  }

  if (options.project) {
    headers.set("OpenAI-Project", options.project);
  }

  return headers;
}

function buildDefaultRequestBody(
  request: LlmStreamRequest<AssistantMessage>,
  options: CreateOpenAiCompatibleLlmProviderOptions,
) {
  const tools = request.context.tools?.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  return {
    model: request.model.id,
    messages: [
      ...(request.context.systemPrompt
        ? [
            {
              role: "system" as const,
              content: request.context.systemPrompt,
            },
          ]
        : []),
      ...toOpenAiMessages(request.context.messages as AgentMessage[]),
    ],
    tools,
    tool_choice: tools && tools.length > 0 ? "auto" : undefined,
    max_tokens: request.maxTokens,
    stream: true,
    stream_options: options.includeUsage === false ? undefined : { include_usage: true },
  };
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
          name: message.toolName,
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
  if (!serialized.trim()) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: serialized };
  }
}

function tryParseToolCallArguments(serialized: string) {
  if (!serialized.trim()) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return null;
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

function toTokenUsage(usage?: OpenAiUsage) {
  if (!usage) {
    return undefined;
  }

  return {
    input: usage.prompt_tokens ?? 0,
    output: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens,
  };
}

function toAssistantMessage(
  request: LlmStreamRequest<AssistantMessage>,
  payload: OpenAiCompletionResponse,
): AssistantMessage {
  const choice = payload.choices[0];
  if (!choice) {
    throw new Error("OpenAI-compatible endpoint returned no choices");
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
    provider: request.model.provider,
    model: payload.model ?? request.model.id,
    timestamp: Date.now(),
    usage: toTokenUsage(payload.usage),
  };
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

function createStreamAccumulator(request: LlmStreamRequest<AssistantMessage>): StreamAccumulator {
  return {
    partial: createPartialAssistantMessage(request),
    finishReason: null,
    model: request.model.id,
    usage: undefined,
    textIndex: null,
    textEnded: false,
    toolCalls: new Map<number, ToolCallAccumulator>(),
  };
}

function ensureTextBlock(
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  if (accumulator.textIndex !== null) {
    return accumulator.textIndex;
  }

  const contentIndex = accumulator.partial.content.length;
  accumulator.partial.content.push({ type: "text", text: "" });
  accumulator.textIndex = contentIndex;
  queue.push({
    type: "text_start",
    contentIndex,
    partial: cloneAssistantMessage(accumulator.partial),
  });
  return contentIndex;
}

function appendTextDelta(
  delta: string,
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  if (!delta) {
    return;
  }

  const contentIndex = ensureTextBlock(accumulator, queue);
  const block = accumulator.partial.content[contentIndex] as { type: "text"; text: string };
  block.text += delta;
  queue.push({
    type: "text_delta",
    contentIndex,
    delta,
    partial: cloneAssistantMessage(accumulator.partial),
  });
}

function appendToolCallDeltas(
  deltas: OpenAiToolCallDelta[],
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  deltas.forEach((delta, arrayIndex) => {
    const toolIndex = delta.index ?? arrayIndex;
    let entry = accumulator.toolCalls.get(toolIndex);

    if (!entry) {
      const contentIndex = accumulator.partial.content.length;
      accumulator.partial.content.push({
        type: "toolCall",
        id: delta.id ?? `tool-call-${toolIndex}`,
        name: "",
        arguments: {},
      });
      entry = {
        contentIndex,
        argumentsBuffer: "",
        nameBuffer: "",
        started: false,
      };
      accumulator.toolCalls.set(toolIndex, entry);
    }

    const block = accumulator.partial.content[entry.contentIndex] as ToolCallBlock;
    if (delta.id) {
      block.id = delta.id;
    }
    if (delta.function?.name) {
      entry.nameBuffer += delta.function.name;
      block.name = entry.nameBuffer;
    }

    if (!entry.started && !(block.id === `tool-call-${toolIndex}` && !block.name && !entry.argumentsBuffer)) {
      queue.push({
        type: "toolcall_start",
        contentIndex: entry.contentIndex,
        partial: cloneAssistantMessage(accumulator.partial),
      });
      entry.started = true;
    }

    if (delta.function?.arguments) {
      entry.argumentsBuffer += delta.function.arguments;
      const partialArguments = tryParseToolCallArguments(entry.argumentsBuffer);
      if (partialArguments) {
        block.arguments = partialArguments;
      }
      queue.push({
        type: "toolcall_delta",
        contentIndex: entry.contentIndex,
        delta: delta.function.arguments,
        partial: cloneAssistantMessage(accumulator.partial),
      });
    }
  });
}

function finalizeTextBlock(
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  if (accumulator.textIndex === null || accumulator.textEnded) {
    return;
  }

  const block = accumulator.partial.content[accumulator.textIndex] as { type: "text"; text: string };
  queue.push({
    type: "text_end",
    contentIndex: accumulator.textIndex,
    content: block.text,
    partial: cloneAssistantMessage(accumulator.partial),
  });
  accumulator.textEnded = true;
}

function finalizeToolCalls(
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  const orderedEntries = [...accumulator.toolCalls.values()].sort(
    (left, right) => left.contentIndex - right.contentIndex,
  );

  orderedEntries.forEach((entry) => {
    const block = accumulator.partial.content[entry.contentIndex] as ToolCallBlock;
    block.arguments = parseToolCallArguments(entry.argumentsBuffer);
    queue.push({
      type: "toolcall_end",
      contentIndex: entry.contentIndex,
      toolCall: cloneAssistantMessage({
        ...accumulator.partial,
        content: [block],
      }).content[0] as ToolCallBlock,
      partial: cloneAssistantMessage(accumulator.partial),
    });
  });
}

function finalizeAssistantMessage(
  request: LlmStreamRequest<AssistantMessage>,
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  finalizeTextBlock(accumulator, queue);
  finalizeToolCalls(accumulator, queue);
  const assistantMessage = cloneAssistantMessage({
    ...accumulator.partial,
    stopReason: mapFinishReason(accumulator.finishReason, accumulator.toolCalls.size > 0),
    model: accumulator.model ?? request.model.id,
    usage: toTokenUsage(accumulator.usage),
  });

  queue.push({
    type: "done",
    message: assistantMessage,
    reason: assistantMessage.stopReason,
  });
  queue.resolveResult(assistantMessage);
  queue.close();
  return assistantMessage;
}

function processChunk(
  chunk: OpenAiCompletionChunk,
  accumulator: StreamAccumulator,
  queue: ReturnType<
    typeof createQueuedResultStream<AssistantStreamEvent<AssistantMessage, ToolCallBlock>, AssistantMessage>
  >,
) {
  accumulator.model = chunk.model ?? accumulator.model;
  if (chunk.usage) {
    accumulator.usage = chunk.usage;
  }

  chunk.choices.forEach((choice) => {
    if (choice.finish_reason !== null) {
      accumulator.finishReason = choice.finish_reason;
    }

    if (!choice.delta) {
      return;
    }

    if (typeof choice.delta.content === "string") {
      appendTextDelta(choice.delta.content, accumulator, queue);
    }

    if (Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0) {
      appendToolCallDeltas(choice.delta.tool_calls, accumulator, queue);
    }
  });
}

function consumeSseFrame(frame: string, onData: (data: string) => void) {
  const dataLines = frame
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length > 0) {
    onData(dataLines.join("\n"));
  }
}

async function pumpSseFrames(response: Response, onData: (data: string) => void) {
  if (!response.body) {
    throw new Error("OpenAI-compatible SSE response did not include a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      consumeSseFrame(frame, onData);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    consumeSseFrame(buffer, onData);
  }
}

function isEventStreamResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/event-stream");
}

export function createOpenAiCompatibleLlmProvider(
  options: CreateOpenAiCompatibleLlmProviderOptions,
): LlmProvider<AssistantMessage> {
  return {
    async stream(request) {
      const resolvedHeaders = await resolveHeaders(options.headers);
      const requestBody = options.buildBody
        ? await options.buildBody(request)
        : buildDefaultRequestBody(request, options);
      const response = await (options.fetch ?? globalThis.fetch)(resolveChatCompletionsUrl(options.baseUrl), {
        method: "POST",
        headers: createRequestHeaders(options, resolvedHeaders),
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
          `OpenAI-compatible request failed: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ""}`,
        );
      }

      if (!isEventStreamResponse(response)) {
        const payload = (await response.json()) as OpenAiCompletionResponse;
        const assistantMessage = toAssistantMessage(request, payload);
        return createResultStream(buildAssistantEvents(assistantMessage), assistantMessage);
      }

      const queue = createQueuedResultStream<
        AssistantStreamEvent<AssistantMessage, ToolCallBlock>,
        AssistantMessage
      >();
      const accumulator = createStreamAccumulator(request);
      queue.push({
        type: "start",
        partial: cloneAssistantMessage(accumulator.partial),
      });

      void pumpSseFrames(response, (data) => {
        if (data === "[DONE]") {
          finalizeAssistantMessage(request, accumulator, queue);
          return;
        }

        const chunk = JSON.parse(data) as OpenAiCompletionChunk;
        processChunk(chunk, accumulator, queue);
      }).catch((error: unknown) => {
        queue.rejectResult(error);
        queue.fail(error);
      });

      return queue.stream;
    },
  };
}
