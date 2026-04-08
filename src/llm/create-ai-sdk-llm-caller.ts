import { DefaultChatTransport, type UIMessage } from "ai";
import type { SerializedTool } from "../tools/tool-interface";
import type {
  CreateLlmTransportContext,
  LlmCallInterface,
} from "./llm-call-interface";

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
    | (() =>
        | Record<string, string>
        | Headers
        | Promise<Record<string, string> | Headers>);
  fetch?: typeof globalThis.fetch;
  buildBody?: (
    options: BuildAiSdkBodyOptions<UI_MESSAGE>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

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
