import type { AssistantMessage } from "./session";
import type { LlmStreamRequest } from "./provider";

export interface CreateUnsafeOpenAiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  project?: string;
  organization?: string;
  headers?:
    | Record<string, string>
    | Headers
    | (() =>
        | Record<string, string>
        | Headers
        | Promise<Record<string, string> | Headers>);
  fetch?: typeof globalThis.fetch;
  includeUsage?: boolean;
  buildBody?: (
    request: LlmStreamRequest<AssistantMessage>,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenAiToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type OpenAiMessage =
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

export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAiCompletionResponse {
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

export interface OpenAiCompletionChunk {
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

export interface IteratorWaiter<TEvent> {
  resolve: (value: IteratorResult<TEvent>) => void;
  reject: (error: unknown) => void;
}

export interface ToolCallAccumulator {
  contentIndex: number;
  argumentsBuffer: string;
  nameBuffer: string;
  started: boolean;
}

export interface StreamAccumulator {
  partial: AssistantMessage;
  finishReason: string | null;
  model?: string;
  usage?: OpenAiUsage;
  textIndex: number | null;
  textEnded: boolean;
  toolCalls: Map<number, ToolCallAccumulator>;
}
