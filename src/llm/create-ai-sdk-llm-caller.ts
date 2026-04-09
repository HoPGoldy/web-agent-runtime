import { DefaultChatTransport, type UIMessage } from "ai";
import type { SerializedTool } from "../tools/tool-interface";
import type { AssistantStreamEvent, LlmContext, LlmProvider } from "./llm-provider-interface";
import { createResultStream } from "./llm-provider-interface";
import type { AssistantMessage, ToolCallBlock } from "../session/session-types";
import type { CreateLlmTransportContext, LlmCallInterface } from "./llm-call-interface";

export interface BuildAiSdkBodyOptions<UI_MESSAGE extends UIMessage> {
  chatId: string;
  sessionId?: string;
  systemPrompt: string;
  messages: UI_MESSAGE[];
  tools: SerializedTool[];
}

export interface CreateAiSdkLlmCallerOptions<UI_MESSAGE extends UIMessage> {
  api: string;
  headers?:
    | Record<string, string>
    | Headers
    | (() => Record<string, string> | Headers | Promise<Record<string, string> | Headers>);
  fetch?: typeof globalThis.fetch;
  buildBody?: (
    options: BuildAiSdkBodyOptions<UI_MESSAGE>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface CreateAiSdkLlmProviderOptions<
  UI_MESSAGE extends UIMessage,
> extends CreateAiSdkLlmCallerOptions<UI_MESSAGE> {}

export function createAiSdkLlmCaller<UI_MESSAGE extends UIMessage = UIMessage>(
  options: CreateAiSdkLlmCallerOptions<UI_MESSAGE>,
): LlmCallInterface<UI_MESSAGE> {
  return {
    createTransport(context: CreateLlmTransportContext<UI_MESSAGE>) {
      return new DefaultChatTransport<UI_MESSAGE>({
        api: options.api,
        headers: options.headers,
        fetch: options.fetch,
        prepareSendMessagesRequest: async ({ id, messages }) => {
          const tools = context.getTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          }));

          const body = options.buildBody
            ? await options.buildBody({
                chatId: id,
                sessionId: context.getSessionId(),
                systemPrompt: context.getSystemPrompt(),
                messages,
                tools,
              })
            : {
                id: context.getSessionId() ?? id,
                systemPrompt: context.getSystemPrompt(),
                messages,
                tools,
              };

          return { body };
        },
      });
    },
  };
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
  tools: SerializedTool[];
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

export function createAiSdkLlmProvider<UI_MESSAGE extends UIMessage = UIMessage>(
  options: CreateAiSdkLlmProviderOptions<UI_MESSAGE>,
): LlmProvider<AssistantMessage> {
  return {
    async stream(request) {
      const tools = (request.context.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      const body = options.buildBody
        ? await options.buildBody({
            chatId: request.sessionId ?? `${request.model.provider}:${request.model.id}`,
            sessionId: request.sessionId,
            systemPrompt: request.context.systemPrompt,
            messages: request.context.messages as unknown as UI_MESSAGE[],
            tools,
          })
        : buildDefaultProviderBody({
            sessionId: request.sessionId,
            systemPrompt: request.context.systemPrompt,
            messages: request.context.messages,
            tools,
          });
      const response = await (options.fetch ?? globalThis.fetch)(options.api, {
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
