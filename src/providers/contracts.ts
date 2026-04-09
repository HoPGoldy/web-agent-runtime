import type { SessionRecord } from "../session";

export type JsonSchema = Record<string, unknown>;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ToolExecutionMode = "parallel" | "sequential";

export interface ResultStream<TEvent, TResult> extends AsyncIterable<TEvent> {
  result(): Promise<TResult>;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export interface ModelRef {
  provider: string;
  id: string;
  api?: string;
  contextWindow?: number;
  reasoning?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface LlmContext<TMessage = unknown> {
  systemPrompt: string;
  messages: TMessage[];
  tools?: LlmToolDefinition[];
}

export type AssistantStreamEvent<TMessage = unknown, TToolCall = unknown> =
  | { type: "start"; partial: TMessage }
  | { type: "text_start"; contentIndex: number; partial: TMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: TMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: TMessage }
  | { type: "thinking_start"; contentIndex: number; partial: TMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: TMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: TMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: TMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: TMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: TToolCall; partial: TMessage }
  | { type: "done"; message: TMessage; reason: string }
  | { type: "error"; error: TMessage; reason: "aborted" | "error" };

export interface LlmStreamRequest<TMessage = unknown> {
  model: ModelRef;
  context: LlmContext<TMessage>;
  sessionId?: string;
  reasoning?: ThinkingLevel;
  maxTokens?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface LlmProvider<TMessage = unknown> {
  stream(
    request: LlmStreamRequest<TMessage>,
  ): Promise<ResultStream<AssistantStreamEvent<TMessage>, TMessage>>;
}

export interface ToolExecutionResult<TDetails = unknown> {
  content: unknown[];
  details?: TDetails;
}

export interface AgentToolExecutionContext<TMessage = unknown, THostContext = unknown> {
  session: SessionRecord | null;
  messages: TMessage[];
  hostContext: THostContext;
}

export interface ToolDefinition<
  TInput = unknown,
  TDetails = unknown,
  TMessage = unknown,
  THostContext = unknown,
> {
  name: string;
  label?: string;
  description: string;
  inputSchema: JsonSchema;
  execute(args: {
    toolCallId: string;
    input: TInput;
    context: AgentToolExecutionContext<TMessage, THostContext>;
    signal: AbortSignal;
    onUpdate?: (partial: ToolExecutionResult<TDetails>) => void;
  }): Promise<ToolExecutionResult<TDetails>>;
}

export interface PromptComposerContext<TState = unknown, TMessage = unknown, THostContext = unknown> {
  session: SessionRecord | null;
  state: TState;
  model: ModelRef;
  tools: Array<ToolDefinition<unknown, unknown, TMessage, THostContext>>;
  baseSystemPrompt: string;
  hostContext: THostContext;
}

export interface PromptComposer<TState = unknown, TMessage = unknown, THostContext = unknown> {
  compose(context: PromptComposerContext<TState, TMessage, THostContext>): Promise<string>;
}
