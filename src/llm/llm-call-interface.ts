import type { ChatTransport, UIMessage } from "ai";
import type { ToolInterface } from "../tools/tool-interface";

/**
 * Context provided when constructing an AI SDK chat transport.
 */
export interface CreateLlmTransportContext<
  UI_MESSAGE extends UIMessage = UIMessage,
> {
  getSessionId(): string | undefined;
  getSystemPrompt(): string;
  getTools(): readonly ToolInterface<unknown, unknown, UI_MESSAGE>[];
}

/**
 * Adapter interface used by the high-level Agent wrapper.
 */
export interface LlmCallInterface<UI_MESSAGE extends UIMessage = UIMessage> {
  createTransport(
    context: CreateLlmTransportContext<UI_MESSAGE>,
  ): ChatTransport<UI_MESSAGE>;
  destroy?(): void | Promise<void>;
}
