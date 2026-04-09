import type {
  LlmProvider,
  ModelRef,
  PromptComposer,
  ThinkingLevel,
  ToolDefinition,
  ToolExecutionMode,
  ToolExecutionResult,
} from "../providers";
import type {
  CreateSessionInput,
  SessionDataCodec,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "../session";
import type { AgentMessage, AssistantMessage } from "../session/session-types";
import type { LoggerOptions } from "./debug";

/**
 * User-supplied input accepted by runtime prompt entry points.
 */
export type PromptInput = string | AgentMessage | AgentMessage[];

/**
 * Hook that can rewrite the runtime message context before an LLM call.
 */
export type TransformContext = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => Promise<AgentMessage[]> | AgentMessage[];

/**
 * Converts normalized runtime messages into provider-native message objects.
 */
export type ConvertToLlm = (messages: AgentMessage[]) => Promise<unknown[]> | unknown[];

/**
 * Input for creating a forked session branch.
 */
export interface ForkSessionInput {
  /** Source session that will be forked. */
  sourceSessionId: string;
  /** Entry id to fork from; defaults to the current session head. */
  fromEntryId?: string | null;
  /** Optional title for the new forked session. */
  title?: string;
  /** Additional metadata merged into the new session record. */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned after successfully forking a session.
 */
export interface ForkSessionResult {
  /** Session metadata for the newly created branch. */
  session: SessionRecord;
  /** Revision assigned to the forked session after persistence. */
  revision: string;
}

/**
 * Result of compacting a session history.
 */
export interface CompactionResult<TDetails = unknown> {
  /** Summary text retained in place of compacted history. */
  summary: string;
  /** First entry id kept after compaction. */
  firstKeptEntryId: string;
  /** Token count before compaction was applied. */
  tokensBefore: number;
  /** Optional host-defined structured compaction details. */
  details?: TDetails;
}

/**
 * Options for a compaction request.
 */
export interface CompactionOptions {
  /** Additional instructions appended to the compaction prompt. */
  customInstructions?: string;
}

/**
 * Full mutable state tracked by the runtime agent.
 */
export interface RuntimeState {
  /** Current lifecycle status for the runtime loop. */
  status: "ready" | "streaming" | "error" | "destroyed";
  /** Active session record, or null for an uninitialized runtime. */
  session: SessionRecord | null;
  /** Model selection used for the next request. */
  model: ModelRef;
  /** Requested reasoning intensity for the model. */
  thinkingLevel: ThinkingLevel;
  /** Base system prompt currently configured on the runtime. */
  systemPrompt: string;
  /** Persisted conversation history. */
  messages: AgentMessage[];
  /** In-progress assistant message being streamed, if any. */
  streamMessage: AssistantMessage | null;
  /** Tool call ids currently executing. */
  pendingToolCallIds: string[];
  /** Steering messages queued to interrupt or redirect the current run. */
  queuedSteeringMessages: AgentMessage[];
  /** Follow-up messages queued to continue after the current turn. */
  queuedFollowUpMessages: AgentMessage[];
  /** Last runtime error message, when the status is error. */
  error?: string;
}

/**
 * Events emitted by the lower-level runtime implementation.
 */
export type RuntimeEvent =
  | { type: "state_changed"; state: RuntimeState }
  | { type: "session_opened"; session: SessionRecord }
  | { type: "session_created"; session: SessionRecord }
  | { type: "session_updated"; session: SessionRecord }
  | { type: "session_deleted"; sessionId: string }
  | {
      type: "session_forked";
      session: SessionRecord;
      sourceSessionId: string;
      fromEntryId?: string | null;
    }
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolExecutionResult[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantEvent: unknown }
  | { type: "message_end"; message: AgentMessage }
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

/**
 * Result returned by the pre-tool-call interception hook.
 */
export interface BeforeToolCallResult {
  /** Prevents the tool call from running when true. */
  block?: boolean;
  /** Human-readable reason for blocking the tool call. */
  reason?: string;
}

/**
 * Overrides that may be applied after a tool call completes.
 */
export interface AfterToolCallResult {
  /** Replacement content for the tool result message. */
  content?: unknown[];
  /** Replacement structured details for the tool result message. */
  details?: unknown;
  /** Overrides whether the final tool result should be treated as an error. */
  isError?: boolean;
}

/**
 * Context supplied before a tool call executes.
 */
export interface BeforeToolCallContext<THostContext = unknown> {
  /** Assistant message that produced the tool call. */
  assistantMessage: AssistantMessage;
  /** Provider-native tool call payload. */
  toolCall: unknown;
  /** Parsed arguments that will be passed into the tool. */
  args: unknown;
  /** Current runtime state snapshot. */
  runtimeState: RuntimeState;
  /** Host-defined ambient context for the current run. */
  hostContext: THostContext;
}

/**
 * Context supplied after a tool call executes.
 */
export interface AfterToolCallContext<THostContext = unknown> {
  /** Assistant message that produced the tool call. */
  assistantMessage: AssistantMessage;
  /** Provider-native tool call payload. */
  toolCall: unknown;
  /** Parsed tool call arguments. */
  args: unknown;
  /** Raw normalized result returned by the tool implementation. */
  result: ToolExecutionResult;
  /** Indicates whether the tool execution failed before hook overrides. */
  isError: boolean;
  /** Current runtime state snapshot. */
  runtimeState: RuntimeState;
  /** Host-defined ambient context for the current run. */
  hostContext: THostContext;
}

/**
 * Public runtime controller interface.
 */
export interface AgentRuntime<THostContext = unknown> {
  /** Latest runtime state snapshot. */
  readonly state: RuntimeState;
  /** Subscribes to runtime events and returns an unsubscribe function. */
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  /** Starts a run using the supplied prompt input. */
  prompt(input: PromptInput): Promise<void>;
  /** Continues the current conversation without appending new input. */
  continue(): Promise<void>;
  /** Queues steering input that should redirect the current run. */
  steer(input: PromptInput): Promise<void>;
  /** Queues follow-up input for the next turn after the current run. */
  followUp(input: PromptInput): Promise<void>;
  /** Compacts historical context for the active session. */
  compact(options?: CompactionOptions): Promise<CompactionResult>;
  /** Cancels the active run, if any. */
  abort(): void;
  /** Tears down the runtime and releases any resources it holds. */
  destroy(): Promise<void>;
  /** Replaces the active model selection. */
  setModel(model: ModelRef): void;
  /** Updates the requested reasoning intensity. */
  setThinkingLevel(level: ThinkingLevel): void;
  /** Replaces the base system prompt. */
  setSystemPrompt(prompt: string): void;
  /** Session management helpers exposed by the runtime. */
  sessions: {
    /** Creates a new session and makes it the active runtime session. */
    create(input?: CreateSessionInput): Promise<SessionRecord>;
    /** Opens an existing session and rebuilds runtime state from persisted history. */
    open(sessionId: string): Promise<SessionRecord>;
    /** Lists all persisted sessions from the configured storage backend. */
    list(): Promise<SessionRecord[]>;
    /** Updates metadata for a persisted session. */
    update(sessionId: string, patch: UpdateSessionInput): Promise<SessionRecord>;
    /** Deletes a session and any persisted history owned by the backend. */
    delete(sessionId: string): Promise<void>;
    /** Creates a new session by forking an existing session lineage. */
    fork(input: ForkSessionInput): Promise<ForkSessionResult>;
  };
}

/**
 * Configuration required to construct a runtime agent.
 */
export interface AgentRuntimeOptions<THostContext = unknown, TSessionData = unknown> {
  /** Model selection used for new runs. */
  model: ModelRef;
  /** Provider implementation that streams assistant responses. */
  llmProvider: LlmProvider<unknown>;
  /** Storage backend used for session metadata and serialized state. */
  storage: StorageProvider<TSessionData>;
  /** Optional codec translating between stored and runtime session data. */
  sessionDataCodec?: SessionDataCodec<TSessionData, unknown>;
  /** Optional runtime logger configuration. */
  loggerOptions?: LoggerOptions;
  /** Tools made available to the runtime and model. */
  tools?: Array<ToolDefinition<unknown, unknown, AgentMessage, THostContext>>;
  /** Base system prompt used when no prompt composer overrides it. */
  systemPrompt?: string;
  /** Optional hook for composing the final system prompt per request. */
  promptComposer?: PromptComposer<RuntimeState, AgentMessage, THostContext>;
  /** Optional transform applied to the normalized message context before requests. */
  transformContext?: TransformContext;
  /** Converts normalized messages into provider-native messages. */
  convertToLlm?: ConvertToLlm;
  /** Determines whether tool calls run in parallel or sequentially. */
  toolExecution?: ToolExecutionMode;
  /** Requested reasoning intensity for the model. */
  thinkingLevel?: ThinkingLevel;
  /** Supplies host-defined ambient context for prompt and tool hooks. */
  getHostContext?: () => Promise<THostContext> | THostContext;
  /** Optional interception hook that runs before each tool call. */
  beforeToolCall?: (
    context: BeforeToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  /** Optional interception hook that runs after each tool call. */
  afterToolCall?: (
    context: AfterToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}
