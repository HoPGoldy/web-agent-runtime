import type { AssistantStreamEvent, LlmProvider, LlmToolDefinition } from "../providers";
import type { AssistantMessage, ToolCallBlock } from "../session/session-types";
import { createResultStream } from "./llm-provider-interface";
import { resolveFetchImplementation } from "../runtime/runtime-compat";

/**
 * Input used to build the request body for the AI SDK provider adapter.
 */
export interface BuildAiSdkBodyOptions<TMessage = unknown> {
  /** Chat identifier generated for the current request. */
  chatId: string;
  /** Active runtime session id, when the request belongs to a persisted session. */
  sessionId?: string;
  /** Final system prompt prepared by the runtime. */
  systemPrompt: string;
  /** Provider-native message payload that will be sent to the endpoint. */
  messages: TMessage[];
  /** Tool definitions made available for the request. */
  tools: LlmToolDefinition[];
}

/**
 * Options for wrapping an HTTP endpoint as a runtime LLM provider.
 */
export interface CreateAiSdkLlmProviderOptions<TMessage = unknown> {
  /** Endpoint that accepts a JSON chat completion request. */
  api: string;
  /** Static or lazily resolved headers sent with every request. */
  headers?:
    | Record<string, string>
    | Headers
    | (() => Record<string, string> | Headers | Promise<Record<string, string> | Headers>);
  /** Optional fetch implementation, useful in non-browser environments or tests. */
  fetch?: typeof globalThis.fetch;
  /** Overrides how the outgoing JSON body is constructed. */
  buildBody?: (
    options: BuildAiSdkBodyOptions<TMessage>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
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

function buildDefaultProviderBody<TMessage>(options: {
  sessionId?: string;
  systemPrompt: string;
  messages: TMessage[];
  tools: LlmToolDefinition[];
}) {
  return {
    id: options.sessionId,
    systemPrompt: options.systemPrompt,
    messages: options.messages,
    tools: options.tools,
  };
}

function normalizeProviderPayload(payload: unknown): {
  events: Array<AssistantStreamEvent<AssistantMessage, ToolCallBlock>>;
  result: AssistantMessage;
} {
  if (Array.isArray(payload)) {
    const events = payload as Array<AssistantStreamEvent<AssistantMessage, ToolCallBlock>>;
    const result = getFinalMessageFromEvents(events);
    return { events, result };
  }

  if (payload && typeof payload === "object") {
    const payloadRecord = payload as {
      events?: Array<AssistantStreamEvent<AssistantMessage, ToolCallBlock>>;
      message?: AssistantMessage;
    };

    if (Array.isArray(payloadRecord.events)) {
      return {
        events: payloadRecord.events,
        result: payloadRecord.message ?? getFinalMessageFromEvents(payloadRecord.events),
      };
    }

    if (payloadRecord.message) {
      return {
        events: [
          { type: "start", partial: payloadRecord.message },
          {
            type: "done",
            message: payloadRecord.message,
            reason: payloadRecord.message.stopReason,
          },
        ],
        result: payloadRecord.message,
      };
    }
  }

  throw new Error("Invalid AI SDK provider payload");
}

function getFinalMessageFromEvents(events: Array<AssistantStreamEvent<AssistantMessage, ToolCallBlock>>) {
  const terminalEvent = [...events]
    .reverse()
    .find((event) => event.type === "done" || event.type === "error");
  if (!terminalEvent) {
    throw new Error("Missing terminal assistant event");
  }

  return terminalEvent.type === "done" ? terminalEvent.message : terminalEvent.error;
}

/**
 * Wraps a JSON-speaking HTTP endpoint as a runtime-compatible LLM provider.
 * The endpoint is expected to return either an event array, an `{ events, message }` object,
 * or a final `{ message }` payload that can be normalized into assistant stream events.
 */
export function createAiSdkLlmProvider<TMessage = unknown>(
  options: CreateAiSdkLlmProviderOptions<TMessage>,
): LlmProvider<AssistantMessage> {
  return {
    async stream(request) {
      const tools = request.context.tools ?? [];
      const body = options.buildBody
        ? await options.buildBody({
            chatId: request.sessionId ?? request.model.id,
            sessionId: request.sessionId,
            systemPrompt: request.context.systemPrompt,
            messages: request.context.messages as TMessage[],
            tools,
          })
        : buildDefaultProviderBody({
            sessionId: request.sessionId,
            systemPrompt: request.context.systemPrompt,
            messages: request.context.messages,
            tools,
          });
      const response = await resolveFetchImplementation(options.fetch)(options.api, {
        method: "POST",
        headers: await resolveHeaders(options.headers),
        body: JSON.stringify(body),
        signal: request.signal,
      });

      if (!response.ok) {
        throw new Error(`LLM provider request failed: ${response.status}`);
      }

      const payload = await response.json();
      const normalized = normalizeProviderPayload(payload);
      return createResultStream(normalized.events, normalized.result);
    },
  };
}
