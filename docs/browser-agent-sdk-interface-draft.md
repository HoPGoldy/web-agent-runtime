# 浏览器 Agent SDK 接口草案

## 状态

这是一份面向浏览器优先的 agent runtime SDK 草案。设计上参考了 pi agent core 和 pi coding-agent，但目标环境和边界做了如下调整：

- 在浏览器本地执行
- 通过后端代理访问模型
- 通过 provider 接口接入 LLM 和 storage，并直接传入 tools 列表
- v1 支持 session CRUD、session fork、compaction、steering、follow-up 和 tool execution

## 当前导出形态

当前实现只保留一条 runtime-first 主路径：

- 根入口导出 `createAgentRuntime`、`createJsonSessionDataCodec`、`createAiSdkLlmProvider`
- 根入口同时导出 runtime、session、provider 的核心类型，方便浏览器宿主直接集成
- `IndexedDbAgentStorage` 只实现 session metadata + opaque session document 存储语义
- 可选辅助函数仅围绕当前主路径保留，例如 `createAiSdkToolSet` 和 `createResultStream`

也就是说，v1 已经不再并行维护旧的 message-centric facade，而是直接以新 runtime 结构作为唯一公开边界

## 适用范围

这份草案基于以下前提：

- agent runtime 运行在浏览器中
- 模型调用通过后端代理完成，避免 API key 暴露到前端
- tool execution 由宿主定义，初始主要目标是 Office.js
- SDK 对外暴露对象式 API，但其内部类型设计应尽量接近协议风格，并保持可序列化

## 设计决策

### 1. 在 core 层保持 `systemPrompt` 简单

core runtime 只需要接受一个普通的 `systemPrompt` 字符串。

可以在 runtime 或 session 层提供可选的 `promptComposer`，但它不应该成为构建一个可运行 agent 的前置条件。

### 2. core 不绑定 `UIMessage` 或任何特定 chat SDK

runtime 应该定义自己的 agent message model 和 LLM stream event model。

后端适配层可以内部使用 AI SDK 或 OpenAI-compatible 格式，但浏览器 SDK 内部应该把它们统一归一化成同一套事件模型。

### 3. storage 边界应保存 session document，不要求理解 message 或 entry 语义

如果要支持 session fork 和 compaction，runtime 内部仍然需要稳定的 entry id、parent 关系和 branch 结构。

但这些结构不一定要暴露给 storage provider。更合理的边界是：

- runtime 内部维护带类型的 session graph
- storage provider 只负责保存和读取一个 session document
- document 的具体结构由 runtime 和 codec 负责解释

仅仅保存一整个 `messages[]` 快照仍然太弱，因为 fork 和 compaction 操作的对象并不只是“消息列表”。

### 4. tool execution 应该保持异步且可中断

v1 不需要内建显式的用户确认层，但 tool execution 接口至少应支持：

- `Promise` 返回值
- `AbortSignal`
- 可选的 partial update

这样后续即使增加权限控制或流式工具输出，也不需要重设计接口。

### 5. compaction 默认使用当前主模型

除非未来有扩展明确覆盖这一行为，否则 runtime 应默认使用当前选中的主模型来做 compaction。

### 6. v1 可以假设单个活跃写入方，但 storage API 仍然必须暴露 revision

浏览器 SDK 在 v1 不必完整解决多标签页并发问题，但 storage 写入接口仍然应该接收 `expectedRevision`，并返回新的 revision。

这样接口在未来才具备冲突检测和并发扩展能力。

## 分层

### Core Layer

负责：

- agent loop
- message model
- LLM event streaming model
- tool execution lifecycle
- steering 和 follow-up 的队列语义

### Runtime Session Layer

负责：

- session open、create、fork、delete
- 通过 storage provider 保存和恢复 session document
- model 和 thinking-level 变更
- compaction
- system prompt 解析与组装
- tool registry 解析与装配

### Provider Layer

负责可插拔的浏览器宿主集成：

- `LlmProvider`
- `StorageProvider`
- `ToolDefinition[]`
- 可选的 `PromptComposer`

## TypeScript 草案

```ts
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
```

### Message Model

```ts
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  signature?: string;
}

export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type UserContentBlock = TextBlock | ImageBlock;
export type AssistantContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock;
export type ToolResultContentBlock = TextBlock | ImageBlock;

export interface UserMessage {
  role: "user";
  content: string | UserContentBlock[];
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  stopReason: "stop" | "length" | "toolUse" | "aborted" | "error";
  provider: string;
  model: string;
  usage?: TokenUsage;
  errorMessage?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ToolResultContentBlock[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface CustomMessage<TType extends string = string, TDetails = unknown> {
  role: "custom";
  customType: TType;
  content: string | UserContentBlock[];
  details?: TDetails;
  display?: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage;
```

### 自定义消息说明

`CustomMessage` 是一个带类型的扩展口，用来承载应用自定义、且可能参与 LLM context 的消息内容。

如果某些状态只属于宿主，不应该发给模型，那么它不应该存成 `AgentMessage`，而应该存成 session entry。

这样 SDK 的职责边界会更清晰：

- `AgentMessage` 用来表示对话态数据
- host-only entry 用来表示 UI 或业务侧的宿主数据

### Runtime 内部 Session Model

下面这组类型是 runtime 内部的规范化 session 结构。

它们用于：

- fork
- compaction
- branch 恢复
- context 重建

但它们不一定需要直接暴露给 storage provider。

```ts
export interface SessionEntryBase {
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: ThinkingLevel;
}

export interface CompactionEntry<TDetails = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: TDetails;
}

export interface BranchSummaryEntry<TDetails = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: TDetails;
}

export interface HostDataEntry<TData = unknown> extends SessionEntryBase {
  type: "host_data";
  key: string;
  data?: TData;
}

export type SessionEntry =
  | MessageEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | HostDataEntry;

export interface RuntimeSessionData {
  version: number;
  headEntryId: string | null;
  entries: SessionEntry[];
  metadata?: Record<string, unknown>;
}
```

### LLM Provider 边界

```ts
export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export type LlmMessage = UserMessage | AssistantMessage | ToolResultMessage;

export interface LlmContext {
  systemPrompt: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
}

export type AssistantStreamEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallBlock; partial: AssistantMessage }
  | { type: "done"; message: AssistantMessage; reason: AssistantMessage["stopReason"] }
  | {
      type: "error";
      error: AssistantMessage;
      reason: Extract<AssistantMessage["stopReason"], "aborted" | "error">;
    };

export interface LlmStreamRequest {
  model: ModelRef;
  context: LlmContext;
  sessionId?: string;
  reasoning?: ThinkingLevel;
  maxTokens?: number;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface LlmProvider {
  stream(request: LlmStreamRequest): Promise<ResultStream<AssistantStreamEvent, AssistantMessage>>;
}
```

### LLM Provider 说明

- provider 边界应该把所有后端协议统一归一化成 `AssistantStreamEvent`
- 后端内部可以使用 AI SDK、OpenAI-compatible 响应，或任何其他 transport
- 浏览器 runtime 不应该直接依赖这些线上的 wire format

### Context 转换钩子

```ts
export type TransformContext = (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

export type ConvertToLlm = (messages: AgentMessage[]) => Promise<LlmMessage[]> | LlmMessage[];
```

`TransformContext` 用来在每次调用 LLM 之前做上下文裁剪、消息注入等预处理。

`ConvertToLlm` 用来把自定义消息过滤或转换成标准的 user message 或 tool-result message。

### Tools 边界

```ts
export interface ToolExecutionResult<TDetails = unknown> {
  content: ToolResultContentBlock[];
  details?: TDetails;
}

export interface ToolExecutionContext<THostContext = unknown> {
  session: SessionRecord | null;
  messages: AgentMessage[];
  hostContext: THostContext;
}

export interface ToolDefinition<TInput = unknown, TDetails = unknown, THostContext = unknown> {
  name: string;
  label?: string;
  description: string;
  inputSchema: JsonSchema;
  execute(args: {
    toolCallId: string;
    input: TInput;
    context: ToolExecutionContext<THostContext>;
    signal: AbortSignal;
    onUpdate?: (partial: ToolExecutionResult<TDetails>) => void;
  }): Promise<ToolExecutionResult<TDetails>>;
}
```

### Tool Execution Hooks

```ts
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface AfterToolCallResult {
  content?: ToolResultContentBlock[];
  details?: unknown;
  isError?: boolean;
}

export interface BeforeToolCallContext<THostContext = unknown> {
  assistantMessage: AssistantMessage;
  toolCall: ToolCallBlock;
  args: unknown;
  runtimeState: RuntimeState;
  hostContext: THostContext;
}

export interface AfterToolCallContext<THostContext = unknown> {
  assistantMessage: AssistantMessage;
  toolCall: ToolCallBlock;
  args: unknown;
  result: ToolExecutionResult;
  isError: boolean;
  runtimeState: RuntimeState;
  hostContext: THostContext;
}
```

v1 不需要内建权限确认弹窗，但 runtime 仍然应该暴露这些 hook 点。

### Storage Provider 边界

```ts
export interface SessionRecord {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
  metadata?: Record<string, unknown>;
}

export interface StoredSessionData<TSessionData = unknown> {
  session: SessionRecord;
  data: TSessionData;
}

export interface MutationOptions {
  expectedRevision?: string;
}

export interface CommitResult {
  session: SessionRecord;
  revision: string;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionInput {
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionDataCodec<TSessionData = unknown, TRuntimeSessionData = unknown> {
  serialize(data: TRuntimeSessionData): Promise<TSessionData> | TSessionData;
  deserialize(data: TSessionData): Promise<TRuntimeSessionData> | TRuntimeSessionData;
}

export interface StorageProvider<TSessionData = unknown> {
  createSession(input?: CreateSessionInput): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  listSessions(): Promise<SessionRecord[]>;
  updateSession(
    sessionId: string,
    patch: UpdateSessionInput,
    options?: MutationOptions,
  ): Promise<SessionRecord>;
  deleteSession(sessionId: string): Promise<void>;
  loadSessionData(sessionId: string): Promise<StoredSessionData<TSessionData> | null>;
  saveSessionData(sessionId: string, data: TSessionData, options?: MutationOptions): Promise<CommitResult>;
}
```

### Storage 并发模型

这里的关键点是：storage provider 不必知道 `AgentMessage`、`SessionEntry`、`CompactionEntry` 这些运行时细节。

它只需要保存一个 session metadata 和一个 session data blob。

真正理解 `SessionEntry` 结构的是 runtime 和 `SessionDataCodec`。

v1 仍然可以按单写入方 runtime 运行，但 `revision` 必须属于公开接口的一部分，这样 provider 未来才能检测并拒绝陈旧写入。

建议行为如下：

- `loadSessionData()` 返回最新的 `revision`
- 当 `expectedRevision` 过期时，`saveSessionData()` 和 `updateSession()` 可以拒绝写入
- 浏览器中的 IndexedDB 实现，在严格单标签页模式下可以选择跳过冲突错误，但接口本身必须保留这个能力

### 为什么不建议把 storage 定义成 `messages: unknown[]`

`unknown[]` 看起来更宽松，但它其实仍然泄露了“storage 正在保存消息列表”这个运行时假设。

问题在于：

- fork 操作处理的不只是消息列表，还包括 branch head
- compaction 操作处理的不只是消息列表，还包括 summary entry 和 cut point
- host-only state 也未必适合混进 message list

所以更稳妥的边界不是 `unknown[] messages`，而是 `unknown sessionData`。

这样 storage 足够简单，runtime 也仍然保有一套明确的内部结构。

### Prompt Composer

```ts
export interface PromptComposerContext<THostContext = unknown> {
  session: SessionRecord | null;
  state: RuntimeState;
  model: ModelRef;
  tools: ToolDefinition<unknown, unknown, THostContext>[];
  baseSystemPrompt: string;
  hostContext: THostContext;
}

export interface PromptComposer<THostContext = unknown> {
  compose(context: PromptComposerContext<THostContext>): Promise<string>;
}
```

这是一个可选能力。

如果没有提供，runtime 就直接使用 `systemPrompt`。

### Compaction 类型

```ts
export interface CompactionResult<TDetails = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: TDetails;
}

export interface CompactionOptions {
  customInstructions?: string;
}
```

v1 默认策略：

- 使用当前选中的主模型进行 compact
- 使用同一个 `LlmProvider`
- 通过 `StorageProvider` 回写一条 `CompactionEntry`

### Runtime State 和 Events

```ts
export interface RuntimeState {
  status: "ready" | "streaming" | "error" | "destroyed";
  session: SessionRecord | null;
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  messages: AgentMessage[];
  streamMessage: AssistantMessage | null;
  pendingToolCallIds: string[];
  queuedSteeringMessages: AgentMessage[];
  queuedFollowUpMessages: AgentMessage[];
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
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantEvent: AssistantStreamEvent }
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
```

### Runtime API

```ts
export type PromptInput = string | AgentMessage | AgentMessage[];

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
```

### Runtime 构造

```ts
export interface AgentRuntimeOptions<THostContext = unknown, TSessionData = RuntimeSessionData> {
  model: ModelRef;
  llmProvider: LlmProvider;
  storage: StorageProvider<TSessionData>;
  sessionDataCodec?: SessionDataCodec<TSessionData, RuntimeSessionData>;
  tools?: ToolDefinition<unknown, unknown, THostContext>[];
  systemPrompt?: string;
  promptComposer?: PromptComposer<THostContext>;
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

export declare function createAgentRuntime<THostContext = unknown, TSessionData = RuntimeSessionData>(
  options: AgentRuntimeOptions<THostContext, TSessionData>,
): Promise<AgentRuntime<THostContext>>;
```

## 默认语义

### Steering

当 agent 正在运行时，steering message 会先进入队列；等当前 assistant turn 的 tool calls 全部执行完，但下一次模型调用尚未开始时，再把这条消息送入上下文。

### Follow-up

当 agent 正在运行时，follow-up message 也会先进入队列；只有当 agent 原本准备停下时，这条消息才会被送入上下文。

### Compaction

compaction 会把较旧的 entries 总结成一条 `CompactionEntry`，再通过 codec 和 storage 重建 runtime context，然后从 compact 之后的状态继续运行。

### Session Fork

fork 会创建一个新的 session，并以选中的 branch head 或 entry 作为起点。默认情况下，这个过程由 runtime 通过“读取源 session data、在内存中生成新 graph、保存到新 session”来实现。未来如果某个 storage backend 能做更高效的 server-side copy，再通过可选扩展能力增加也可以。

## 建议的 v1 默认值

- 默认直接使用 `systemPrompt`
- `promptComposer` 作为可选能力
- compaction 默认使用主模型
- 先按单活跃写入方假设来设计，但 storage 接口必须要求 `revision`
- storage 默认只存 `session metadata + opaque session document`
- 即使宿主当前不做确认层，也保留 `beforeToolCall` 和 `afterToolCall` hook
- 浏览器 SDK 应保持 transport-agnostic，内部统一围绕 `AssistantStreamEvent`

## v1 非目标

- Node 特有的文件系统或 shell 工具
- 终端优先的 UI 概念
- 在浏览器里动态加载 TypeScript 扩展
- 完整的多标签页合并与冲突解决 UX

## 使用示例

```ts
import { createAgentRuntime, createAiSdkLlmProvider, createJsonSessionDataCodec } from "web-agent-runtime";

const llmProvider = createAiSdkLlmProvider({
  api: "/api/agent/chat",
});

const runtime = await createAgentRuntime({
  model: {
    provider: "office-proxy",
    id: "claude-sonnet",
    contextWindow: 200_000,
    reasoning: true,
  },
  llmProvider,
  storage,
  sessionDataCodec: createJsonSessionDataCodec(),
  tools,
  systemPrompt: "You are an Office assistant that edits documents through provided tools.",
  thinkingLevel: "medium",
  toolExecution: "parallel",
  getHostContext: () => ({ office: Office }),
});

runtime.subscribe((event) => {
  if (event.type === "message_update") {
    // 渲染流式 assistant 状态
  }
});

await runtime.sessions.create({ title: "Word draft helper" });
await runtime.prompt("Summarize the current document and propose a cleaner structure.");
```

## 下一步

收敛说明已经补到 [browser-agent-sdk-migration-plan.md](./browser-agent-sdk-migration-plan.md)，下一步主要是围绕宿主集成继续推进：

- Office.js host context 的首个真实接入
- 是否在后续版本中加入自动 compaction 策略
- 多标签页并发冲突是否需要宿主侧补充显式 UX
