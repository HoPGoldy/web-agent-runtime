import { createAgentId } from "../types";
import type { PromptComposer, ToolDefinition, ToolExecutionMode } from "../providers";
import type { LlmProvider, ModelRef, ThinkingLevel } from "../providers";
import {
  buildRuntimeSessionView,
  createMessageEntry,
  createRuntimeSessionData,
  type AgentMessage,
  type AssistantMessage,
  type RuntimeSessionData,
} from "../session/session-types";
import type {
  CreateSessionInput,
  SessionDataCodec,
  SessionRecord,
  StorageProvider,
  UpdateSessionInput,
} from "../session";
import { RuntimeSessionStore } from "../session/runtime-session";
import { DEFAULT_INDEXED_DB_STORAGE_NAME, IndexedDbAgentStorage } from "../storage/indexed-db-agent-storage";
import {
  type AfterToolCallContext,
  type AfterToolCallResult,
  type AgentRuntime,
  type AgentRuntimeOptions,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
  type CompactionOptions,
  type CompactionResult,
  type ForkSessionInput,
  type ForkSessionResult,
  type PromptInput,
  type RuntimeEvent,
  type RuntimeState,
} from "./contracts";
import { AgentLoopEngine } from "./agent-loop";
import { compactRuntimeSession } from "./compaction";
import { createRuntimeLogger, traceRuntimeDebug, traceRuntimeInfo, type RuntimeLogger } from "./debug";

function cloneModel(model: ModelRef): ModelRef {
  return {
    ...model,
    metadata: model.metadata ? { ...model.metadata } : undefined,
  };
}

function cloneMessages(messages: AgentMessage[]) {
  return messages.map((message) => {
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(message);
    }

    return JSON.parse(JSON.stringify(message)) as AgentMessage;
  });
}

function createEmptyState(options: {
  model: ModelRef;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
}): RuntimeState {
  return {
    status: "ready",
    session: null,
    model: cloneModel(options.model),
    thinkingLevel: options.thinkingLevel,
    systemPrompt: options.systemPrompt,
    messages: [],
    streamMessage: null,
    pendingToolCallIds: [],
    queuedSteeringMessages: [],
    queuedFollowUpMessages: [],
  };
}

function resolveStorage<TSessionData, THostContext>(
  options: AgentRuntimeOptions<THostContext, TSessionData>,
): StorageProvider<TSessionData> {
  if (options.storage) {
    return options.storage;
  }

  if (typeof indexedDB === "undefined") {
    throw new Error(
      "No storage provider was supplied and indexedDB is not available. Pass storage explicitly in this environment.",
    );
  }

  return new IndexedDbAgentStorage<TSessionData>({
    dbName: DEFAULT_INDEXED_DB_STORAGE_NAME,
    loggerOptions: options.loggerOptions,
  });
}

class BrowserAgentRuntime<
  THostContext = unknown,
  TSessionData = RuntimeSessionData,
> implements AgentRuntime<THostContext> {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly sessionStore: RuntimeSessionStore<TSessionData>;
  private readonly loop: AgentLoopEngine<THostContext>;
  private readonly baseModel: ModelRef;
  private readonly tools: Array<ToolDefinition<unknown, unknown, AgentMessage, THostContext>>;
  private readonly llmProvider: LlmProvider<unknown>;
  private readonly logger?: RuntimeLogger;
  private readonly promptComposer?: PromptComposer<RuntimeState, AgentMessage, THostContext>;
  private readonly transformContext?: AgentRuntimeOptions<THostContext, TSessionData>["transformContext"];
  private readonly convertToLlm?: AgentRuntimeOptions<THostContext, TSessionData>["convertToLlm"];
  private readonly getHostContextImpl: () => Promise<THostContext>;
  private readonly beforeToolCall?: (
    context: BeforeToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  private readonly afterToolCall?: (
    context: AfterToolCallContext<THostContext>,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  private readonly toolExecutionMode: ToolExecutionMode;
  private destroyed = false;
  private sessionData = createRuntimeSessionData();
  private _state: RuntimeState;

  readonly sessions = {
    create: async (input?: CreateSessionInput) => {
      this.ensureNotDestroyed();
      traceRuntimeInfo(this.logger, "runtime:session-create:start", {
        title: input?.title ?? null,
      });
      const created = await this.sessionStore.create(input);
      traceRuntimeDebug(this.logger, "runtime:session-create:store-done", {
        sessionId: created.session.id,
      });
      this.sessionData = created.data;
      this._state.session = created.session;
      this.rebuildState();
      this.emit({ type: "session_created", session: created.session });
      traceRuntimeInfo(this.logger, "runtime:session-create:done", {
        sessionId: created.session.id,
      });
      return created.session;
    },
    open: async (sessionId: string) => {
      this.ensureNotDestroyed();
      const opened = await this.sessionStore.open(sessionId);
      this.sessionData = opened.data;
      this._state.session = opened.session;
      this.rebuildState();
      this.emit({ type: "session_opened", session: opened.session });
      return opened.session;
    },
    list: async () => {
      this.ensureNotDestroyed();
      return this.sessionStore.list();
    },
    update: async (sessionId: string, patch: UpdateSessionInput) => {
      this.ensureNotDestroyed();
      const updated = await this.sessionStore.update(
        sessionId,
        patch,
        this._state.session?.id === sessionId ? this._state.session.revision : undefined,
      );
      if (this._state.session?.id === sessionId) {
        this._state.session = updated;
        this.emitStateChanged();
      }
      this.emit({ type: "session_updated", session: updated });
      return updated;
    },
    delete: async (sessionId: string) => {
      this.ensureNotDestroyed();
      await this.sessionStore.delete(sessionId);
      if (this._state.session?.id === sessionId) {
        this.sessionData = createRuntimeSessionData();
        this._state.session = null;
        this.rebuildState();
      }
      this.emit({ type: "session_deleted", sessionId });
    },
    fork: async (input: ForkSessionInput) => {
      this.ensureNotDestroyed();
      const forked = await this.sessionStore.fork(input);
      this.sessionData = forked.data;
      this._state.session = forked.session;
      this.rebuildState();
      this.emit({
        type: "session_forked",
        session: forked.session,
        sourceSessionId: input.sourceSessionId,
        fromEntryId: input.fromEntryId,
      });
      return {
        session: forked.session,
        revision: forked.revision,
      } satisfies ForkSessionResult;
    },
  };

  constructor(options: AgentRuntimeOptions<THostContext, TSessionData>) {
    this.baseModel = cloneModel(options.model);
    this.tools = options.tools ? [...options.tools] : [];
    this.llmProvider = options.llmProvider;
    this.logger = createRuntimeLogger(options.loggerOptions);
    this.promptComposer = options.promptComposer;
    this.transformContext = options.transformContext;
    this.convertToLlm = options.convertToLlm;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.toolExecutionMode = options.toolExecution ?? "sequential";
    this.getHostContextImpl = async () => {
      if (!options.getHostContext) {
        return {} as THostContext;
      }

      return options.getHostContext();
    };
    this.sessionStore = new RuntimeSessionStore(
      resolveStorage(options),
      options.sessionDataCodec as SessionDataCodec<TSessionData, RuntimeSessionData> | undefined,
      this.logger,
    );
    this._state = createEmptyState({
      model: options.model,
      thinkingLevel: options.thinkingLevel ?? "off",
      systemPrompt: options.systemPrompt ?? "",
    });
    this.loop = new AgentLoopEngine<THostContext>({
      logger: this.logger,
      llmProvider: this.llmProvider,
      toolExecutionMode: this.toolExecutionMode,
      getState: () => this._state,
      setStatus: (status, error) => {
        this._state.status = status;
        this._state.error = error;
        this.emitStateChanged();
      },
      setStreamMessage: (message) => {
        this._state.streamMessage = message;
        this.emitStateChanged();
      },
      emit: (event) => this.emit(event),
      appendMessages: async (messages) => {
        for (const message of messages) {
          await this.appendMessage(message);
        }
      },
      getMessages: () => cloneMessages(this._state.messages),
      buildLlmContext: async (tools, signal) => {
        const hostContext = await this.getHostContextImpl();
        const systemPrompt = this.promptComposer
          ? await this.promptComposer.compose({
              session: this._state.session,
              state: this._state,
              model: this._state.model,
              tools,
              baseSystemPrompt: this._state.systemPrompt,
              hostContext,
            })
          : this._state.systemPrompt;
        const transformedMessages = this.transformContext
          ? await this.transformContext(cloneMessages(this._state.messages), signal)
          : cloneMessages(this._state.messages);
        const llmMessages = this.convertToLlm
          ? await this.convertToLlm(transformedMessages)
          : transformedMessages;
        return {
          systemPrompt,
          messages: llmMessages,
        };
      },
      getTools: async () => {
        return this.tools;
      },
      getHostContext: () => this.getHostContextImpl(),
      consumeSteeringMessages: () => {
        const messages = cloneMessages(this._state.queuedSteeringMessages as AgentMessage[]);
        this._state.queuedSteeringMessages = [];
        this.emitStateChanged();
        return messages;
      },
      consumeFollowUpMessages: () => {
        const messages = cloneMessages(this._state.queuedFollowUpMessages as AgentMessage[]);
        this._state.queuedFollowUpMessages = [];
        this.emitStateChanged();
        return messages;
      },
      beforeToolCall: async (context) =>
        this.beforeToolCall?.(context as BeforeToolCallContext<THostContext>),
      afterToolCall: async (context) => this.afterToolCall?.(context as AfterToolCallContext<THostContext>),
    });
  }

  get state() {
    return this._state;
  }

  subscribe(listener: (event: RuntimeEvent) => void) {
    this.ensureNotDestroyed();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(input: PromptInput) {
    this.ensureNotDestroyed();
    traceRuntimeInfo(this.logger, "runtime:prompt:start", {
      hasSession: Boolean(this._state.session),
      inputType: typeof input === "string" ? "string" : Array.isArray(input) ? "array" : "message",
    });
    await this.ensureSession();
    traceRuntimeDebug(this.logger, "runtime:prompt:session-ready", {
      sessionId: this._state.session?.id,
    });
    await this.loop.run(input);
    traceRuntimeInfo(this.logger, "runtime:prompt:done", {
      messageCount: this._state.messages.length,
    });
  }

  async continue() {
    this.ensureNotDestroyed();
    if (!this._state.session) {
      throw new Error("Cannot continue without an active session");
    }
    if (this._state.messages.length === 0) {
      throw new Error("Cannot continue without existing context");
    }
    await this.loop.run();
  }

  async steer(input: PromptInput) {
    this.ensureNotDestroyed();
    const messages = this.normalizeQueuedMessages(input);
    if (this.loop.isRunning) {
      this._state.queuedSteeringMessages = [...this._state.queuedSteeringMessages, ...messages];
      this.emitStateChanged();
      return;
    }

    await this.prompt(input);
  }

  async followUp(input: PromptInput) {
    this.ensureNotDestroyed();
    const messages = this.normalizeQueuedMessages(input);
    if (this.loop.isRunning) {
      this._state.queuedFollowUpMessages = [...this._state.queuedFollowUpMessages, ...messages];
      this.emitStateChanged();
      return;
    }

    await this.prompt(input);
  }

  async compact(options?: CompactionOptions) {
    this.ensureNotDestroyed();
    await this.ensureSession();
    const sessionId = this._state.session!.id;
    this.emit({ type: "compaction_start", sessionId });
    const compacted = await compactRuntimeSession({
      data: this.sessionData,
      llmProvider: this.llmProvider,
      model: this._state.model,
      thinkingLevel: this._state.thinkingLevel,
      systemPrompt: this._state.systemPrompt,
      sessionId,
      compactionOptions: options,
    });
    this.sessionData = compacted.data;
    await this.persistSessionData();
    this.rebuildState();
    this.emit({
      type: "compaction_end",
      sessionId,
      result: compacted.result,
    });
    return compacted.result satisfies CompactionResult;
  }

  abort() {
    this.loop.abort();
  }

  async destroy() {
    if (this.destroyed) {
      return;
    }

    this.abort();
    this.destroyed = true;
    this._state.status = "destroyed";
    this.emit({ type: "destroyed" });
    this.listeners.clear();
  }

  setModel(model: ModelRef) {
    this.ensureNotDestroyed();
    this._state.model = cloneModel(model);
    this.emitStateChanged();
  }

  setThinkingLevel(level: ThinkingLevel) {
    this.ensureNotDestroyed();
    this._state.thinkingLevel = level;
    this.emitStateChanged();
  }

  setSystemPrompt(prompt: string) {
    this.ensureNotDestroyed();
    this._state.systemPrompt = prompt;
    this.emitStateChanged();
  }

  private normalizeQueuedMessages(input: PromptInput) {
    if (typeof input === "string") {
      return [
        {
          role: "user",
          content: input,
          timestamp: Date.now(),
        } satisfies AgentMessage,
      ];
    }

    return (Array.isArray(input) ? input : [input]) as AgentMessage[];
  }

  private async ensureSession() {
    if (this._state.session) {
      traceRuntimeDebug(this.logger, "runtime:ensure-session:existing", {
        sessionId: this._state.session.id,
      });
      return this._state.session;
    }

    traceRuntimeInfo(this.logger, "runtime:ensure-session:create");
    return this.sessions.create({ title: "Untitled Session" });
  }

  private async appendMessage(message: AgentMessage) {
    const session = await this.ensureSession();
    traceRuntimeDebug(this.logger, "runtime:append-message:start", {
      role: message.role,
      sessionId: session.id,
    });
    this.sessionData = appendMessageToSessionData(this.sessionData, message);
    await this.persistSessionData(session.id);
    this.rebuildState();
    traceRuntimeDebug(this.logger, "runtime:append-message:done", {
      role: message.role,
      messageCount: this._state.messages.length,
    });
  }

  private async persistSessionData(sessionId = this._state.session?.id) {
    if (!sessionId || !this._state.session) {
      return;
    }

    traceRuntimeDebug(this.logger, "runtime:persist-session:start", {
      sessionId,
      entryCount: this.sessionData.entries.length,
      expectedRevision: this._state.session.revision,
    });
    const commit = await this.sessionStore.save(sessionId, this.sessionData, this._state.session.revision);
    this._state.session = commit.session;
    traceRuntimeDebug(this.logger, "runtime:persist-session:done", {
      sessionId,
      revision: commit.revision,
    });
  }

  private rebuildState() {
    const view = buildRuntimeSessionView(this.sessionData, {
      model: this._state.model ?? this.baseModel,
      thinkingLevel: this._state.thinkingLevel,
    });
    this._state.messages = view.messages;
    this._state.model = view.model;
    this._state.thinkingLevel = view.thinkingLevel;
    this.emitStateChanged();
  }

  private emitStateChanged() {
    this.emit({
      type: "state_changed",
      state: {
        ...this._state,
        messages: cloneMessages(this._state.messages),
        queuedSteeringMessages: cloneMessages(this._state.queuedSteeringMessages as AgentMessage[]),
        queuedFollowUpMessages: cloneMessages(this._state.queuedFollowUpMessages as AgentMessage[]),
      },
    });
  }

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private ensureNotDestroyed() {
    if (this.destroyed) {
      throw new Error("Agent runtime has been destroyed");
    }
  }
}

function appendMessageToSessionData(sessionData: RuntimeSessionData, message: AgentMessage) {
  return createMessageEntryData(sessionData, message);
}

function createMessageEntryData(sessionData: RuntimeSessionData, message: AgentMessage) {
  return appendSessionMessage(sessionData, message);
}

function appendSessionMessage(sessionData: RuntimeSessionData, message: AgentMessage) {
  return createMessageSessionData(sessionData, message);
}

function createMessageSessionData(sessionData: RuntimeSessionData, message: AgentMessage) {
  return appendSessionEntryWithMessage(sessionData, message);
}

function appendSessionEntryWithMessage(sessionData: RuntimeSessionData, message: AgentMessage) {
  return appendSessionEntry(
    sessionData,
    createMessageEntry({
      id: `entry-${createAgentId()}`,
      parentId: sessionData.headEntryId,
      timestamp: new Date().toISOString(),
      message,
    }),
  );
}

import { appendSessionEntry } from "../session/session-types";

/**
 * Creates the browser-oriented runtime implementation that powers this SDK.
 */
export async function createAgentRuntime<THostContext = unknown, TSessionData = RuntimeSessionData>(
  options: AgentRuntimeOptions<THostContext, TSessionData>,
) {
  return new BrowserAgentRuntime(options);
}
