import type {
  LlmProvider,
  ModelRef,
  PromptComposer,
  ThinkingLevel,
  ToolExecutionMode,
  ToolExecutionResult,
  ToolProvider,
} from "../providers";
import type {
  CreateSessionInput,
  SessionDataCodec,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "../session";

export type PromptInput = string | unknown | unknown[];

export type TransformContext = (
  messages: unknown[],
  signal?: AbortSignal,
) => Promise<unknown[]> | unknown[];

export type ConvertToLlm = (messages: unknown[]) => Promise<unknown[]> | unknown[];

export interface ForkSessionInput {
  sourceSessionId: string;
  fromEntryId?: string | null;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ForkSessionResult {
  session: SessionRecord;
  revision: string;
}

export interface CompactionResult<TDetails = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: TDetails;
}

export interface CompactionOptions {
  customInstructions?: string;
}

export interface RuntimeState {
  status: "ready" | "streaming" | "error" | "destroyed";
  session: SessionRecord | null;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  messages: unknown[];
  streamMessage: unknown | null;
  pendingToolCallIds: string[];
  queuedSteeringMessages: unknown[];
  queuedFollowUpMessages: unknown[];
  error?: string;
}

export type RuntimeEvent =
  | { type: "state_changed"; state: RuntimeState }
  | { type: "session_opened"; session: SessionRecord }
  | { type: "session_created"; session: SessionRecord }
  | { type: "session_updated"; session: SessionRecord }
  | { type: "session_deleted"; sessionId: string }
  | { type: "session_forked"; session: SessionRecord; sourceSessionId: string; fromEntryId?: string | null }
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: unknown; toolResults: ToolExecutionResult[] }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; message: unknown; assistantEvent: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: ToolExecutionResult;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: ToolExecutionResult;
      isError: boolean;
    }
  | { type: "compaction_start"; sessionId: string }
  | { type: "compaction_end"; sessionId: string; result: CompactionResult }
  | { type: "destroyed" };

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: unknown[];
  details?: unknown;
  isError?: boolean;
}

export interface BeforeToolCallContext<THostContext = unknown> {
  assistantMessage: unknown;
  toolCall: unknown;
  args: unknown;
  runtimeState: RuntimeState;
  hostContext: THostContext;
}

export interface AfterToolCallContext<THostContext = unknown> {
  assistantMessage: unknown;
  toolCall: unknown;
  args: unknown;
  result: ToolExecutionResult;
  isError: boolean;
  runtimeState: RuntimeState;
  hostContext: THostContext;
}

export interface AgentRuntime<THostContext = unknown> {
  readonly state: RuntimeState;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  prompt(input: PromptInput): Promise<void>;
  continue(): Promise<void>;
  steer(input: PromptInput): Promise<void>;
  followUp(input: PromptInput): Promise<void>;
  compact(options?: CompactionOptions): Promise<CompactionResult>;
  abort(): void;
  destroy(): Promise<void>;
  setModel(model: ModelRef): void;
  setThinkingLevel(level: ThinkingLevel): void;
  setSystemPrompt(prompt: string): void;
  sessions: {
    create(input?: CreateSessionInput): Promise<SessionRecord>;
    open(sessionId: string): Promise<SessionRecord>;
    list(): Promise<SessionRecord[]>;
    update(sessionId: string, patch: UpdateSessionInput): Promise<SessionRecord>;
    delete(sessionId: string): Promise<void>;
    fork(input: ForkSessionInput): Promise<ForkSessionResult>;
  };
}

export interface AgentRuntimeOptions<THostContext = unknown, TSessionData = unknown> {
  model: ModelRef;
  llmProvider: LlmProvider<unknown>;
  storage: StorageProvider<TSessionData>;
  sessionDataCodec?: SessionDataCodec<TSessionData>;
  toolProvider: ToolProvider<RuntimeState, unknown, THostContext>;
  systemPrompt?: string;
  promptComposer?: PromptComposer<RuntimeState, unknown, THostContext>;
  transformContext?: TransformContext;
  convertToLlm?: ConvertToLlm;
  toolExecution?: ToolExecutionMode;
  thinkingLevel?: ThinkingLevel;
  getHostContext?: () => Promise<THostContext> | THostContext;
  beforeToolCall?: (
    context: BeforeToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (
    context: AfterToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

export declare function createAgentRuntime<THostContext = unknown, TSessionData = unknown>(
  options: AgentRuntimeOptions<THostContext, TSessionData>,
): Promise<AgentRuntime<THostContext>>;