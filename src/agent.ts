import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { RuntimeChat } from "./runtime-chat";
import type { LlmCallInterface } from "./llm/llm-call-interface";
import type { StorageInterface } from "./storage/storage-interface";
import type { SessionRecord } from "./session";
import type { ToolInterface, ToolExecutionContext } from "./tools/tool-interface";
import {
  type AgentEvent,
  type AgentSession,
  type AgentSessionCreateInput,
  type AgentSessionOpenOptions,
  type AgentSessionUpdateInput,
  type AgentState,
} from "./types";

/**
 * Configuration for the high-level Agent facade.
 */
export interface AgentOptions<UI_MESSAGE extends UIMessage = UIMessage> {
  storage: StorageInterface<UI_MESSAGE>;
  llmCaller: LlmCallInterface<UI_MESSAGE>;
  systemPrompt?: string;
  tools?: ToolInterface<unknown, unknown, UI_MESSAGE>[];
  sessionId?: string;
  sessionTitle?: string;
}

/**
 * Prompt input accepted by the high-level Agent methods.
 */
type PromptInput<UI_MESSAGE extends UIMessage> = string | UI_MESSAGE | UI_MESSAGE[];

/**
 * Normalized tool call shape produced by the runtime chat integration.
 */
interface RuntimeToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  dynamic?: boolean;
}

export class Agent<UI_MESSAGE extends UIMessage = UIMessage> {
  private readonly storage: StorageInterface<UI_MESSAGE>;
  private readonly llmCaller: LlmCallInterface<UI_MESSAGE>;
  private readonly listeners = new Set<(event: AgentEvent<UI_MESSAGE>) => void>();
  private readonly toolMap = new Map<string, ToolInterface<unknown, unknown, UI_MESSAGE>>();
  private readonly chat: RuntimeChat<UI_MESSAGE>;
  private readonly initialSessionTitle: string;
  private pendingSessionId?: string;
  private initializationPromise: Promise<void>;
  private persistChain = Promise.resolve();
  private toolAbortController = new AbortController();
  private destroyed = false;

  private _state: AgentState<UI_MESSAGE> = {
    status: "ready",
    messages: [],
    error: null,
    pendingToolCalls: new Set<string>(),
    session: null,
    isInitialized: false,
    systemPrompt: "",
  };

  readonly sessions = {
    create: async (input: AgentSessionCreateInput = {}) => {
      this.ensureNotDestroyed();
      const session = this.toAgentSession(await this.storage.createSession(input));
      this.emit({ type: "session-created", session });
      return session;
    },
    get: async (id: string) => {
      this.ensureNotDestroyed();
      return this.storage.getSession(id);
    },
    list: async () => {
      this.ensureNotDestroyed();
      return this.storage.listSessions();
    },
    open: async (id: string, options: AgentSessionOpenOptions = {}) => {
      this.ensureNotDestroyed();
      let session = await this.storage.getSession(id);
      if (!session && options.createIfMissing) {
        session = await this.storage.createSession({
          id,
          title: options.title ?? this.initialSessionTitle,
        });
        this.emit({
          type: "session-created",
          session: this.toAgentSession(session),
        });
      }

      if (!session) {
        throw new Error(`Session not found: ${id}`);
      }

      const messages = await this.storage.loadMessages(id);
      const nextSession = this.toAgentSession(session);
      this.pendingSessionId = id;
      this._state.session = nextSession;
      this._state.isInitialized = true;
      this.chat.replaceAllMessages(messages);
      this.syncState();
      this.emit({ type: "session-opened", session: nextSession });
      return nextSession;
    },
    update: async (id: string, patch: AgentSessionUpdateInput) => {
      this.ensureNotDestroyed();
      const session = this.toAgentSession(await this.storage.updateSession(id, patch));
      if (this._state.session?.id === id) {
        this._state.session = session;
        this.emitStateChanged();
      }
      this.emit({ type: "session-updated", session });
      return session;
    },
    delete: async (id: string) => {
      this.ensureNotDestroyed();
      await this.storage.deleteSession(id);
      if (this._state.session?.id === id) {
        this.pendingSessionId = undefined;
        this._state.session = null;
        this._state.isInitialized = false;
        this.chat.replaceAllMessages([]);
        this.syncState();
      }
      this.emit({ type: "session-deleted", sessionId: id });
    },
  };

  constructor(options: AgentOptions<UI_MESSAGE>) {
    this.storage = options.storage;
    this.llmCaller = options.llmCaller;
    this.pendingSessionId = options.sessionId;
    this.initialSessionTitle = options.sessionTitle ?? "Untitled Session";
    this._state.systemPrompt = options.systemPrompt ?? "";
    this.setTools(options.tools ?? []);

    this.chat = new RuntimeChat<UI_MESSAGE>({
      messages: [],
      transport: this.llmCaller.createTransport({
        getSessionId: () => this.pendingSessionId,
        getSystemPrompt: () => this._state.systemPrompt,
        getTools: () => Array.from(this.toolMap.values()),
      }),
      onToolCall: async ({ toolCall }) => {
        await this.handleToolCall(toolCall);
      },
      onError: (error) => {
        this._state.error = error;
        this.syncState();
      },
      onStateChange: () => {
        this.syncState();
      },
      onFinish: () => {
        this.resetToolAbortController();
      },
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });

    this.initializationPromise = options.sessionId
      ? this.sessions
          .open(options.sessionId, {
            createIfMissing: true,
            title: this.initialSessionTitle,
          })
          .then(() => undefined)
      : Promise.resolve();
  }

  get state() {
    return this._state;
  }

  get sessionId() {
    return this._state.session?.id ?? this.pendingSessionId;
  }

  set sessionId(value: string | undefined) {
    this.pendingSessionId = value;
  }

  subscribe(listener: (event: AgentEvent<UI_MESSAGE>) => void) {
    this.ensureNotDestroyed();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSystemPrompt(systemPrompt: string) {
    this.ensureNotDestroyed();
    this._state.systemPrompt = systemPrompt;
    this.emitStateChanged();
  }

  setTools(tools: ToolInterface<unknown, unknown, UI_MESSAGE>[]) {
    this.ensureNotDestroyed();
    this.toolMap.clear();
    for (const tool of tools) {
      this.toolMap.set(tool.name, tool);
    }
  }

  replaceMessages(messages: UI_MESSAGE[]) {
    this.ensureNotDestroyed();
    this.chat.replaceAllMessages(messages);
  }

  clearMessages() {
    this.ensureNotDestroyed();
    this.chat.replaceAllMessages([]);
  }

  async prompt(input: PromptInput<UI_MESSAGE>) {
    this.ensureNotDestroyed();
    await this.ensureSession();
    this.resetToolAbortController();

    if (typeof input === "string") {
      await this.chat.sendMessage({
        text: input,
        metadata: { createdAt: new Date().toISOString() } as never,
      });
      return;
    }

    if (Array.isArray(input)) {
      this.chat.appendMessages(input);
      await this.chat.sendMessage();
      return;
    }

    this.chat.appendMessages([input]);
    await this.chat.sendMessage();
  }

  async continue() {
    this.ensureNotDestroyed();
    await this.ensureSession();
    this.resetToolAbortController();
    await this.chat.sendMessage();
  }

  abort() {
    this.ensureNotDestroyed();
    this.toolAbortController.abort();
    void this.chat.stop();
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.abort();
    this.emit({ type: "destroyed" });
    this.listeners.clear();
    this.destroyed = true;
    this._state.status = "destroyed";
    this._state.pendingToolCalls = new Set<string>();
    void this.llmCaller.destroy?.();
  }

  private async ensureSession() {
    await this.initializationPromise;
    if (this._state.session) {
      return this._state.session;
    }

    const session = await this.sessions.create({
      id: this.pendingSessionId,
      title: this.initialSessionTitle,
    });
    await this.sessions.open(session.id);
    return session;
  }

  private async handleToolCall(toolCall: RuntimeToolCall) {
    if (toolCall.dynamic) {
      return;
    }

    const tool = this.toolMap.get(toolCall.toolName);
    if (!tool) {
      const errorText = `Unsupported tool: ${toolCall.toolName}`;
      void this.chat.addToolOutput({
        state: "output-error",
        tool: toolCall.toolName as never,
        toolCallId: toolCall.toolCallId,
        errorText,
      });
      return;
    }

    const pendingToolCalls = new Set(this._state.pendingToolCalls);
    pendingToolCalls.add(toolCall.toolCallId);
    this._state.pendingToolCalls = pendingToolCalls;
    this.emit({
      type: "tool-execution-start",
      toolCallId: toolCall.toolCallId,
      toolName: tool.name,
      args: toolCall.input,
    });
    this.emitStateChanged();

    try {
      const context: ToolExecutionContext<UI_MESSAGE> = {
        session: this._state.session,
        messages: this.chat.messages,
      };
      const result = await tool.execute(
        toolCall.toolCallId,
        toolCall.input as never,
        context,
        this.toolAbortController.signal,
        (partialResult) => {
          this.emit({
            type: "tool-execution-update",
            toolCallId: toolCall.toolCallId,
            toolName: tool.name,
            args: toolCall.input,
            partialResult,
          });
        },
      );

      void this.chat.addToolOutput({
        tool: tool.name as never,
        toolCallId: toolCall.toolCallId,
        output: result as never,
      });

      this.emit({
        type: "tool-execution-end",
        toolCallId: toolCall.toolCallId,
        toolName: tool.name,
        result,
        isError: false,
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      void this.chat.addToolOutput({
        state: "output-error",
        tool: tool.name as never,
        toolCallId: toolCall.toolCallId,
        errorText,
      });
      this.emit({
        type: "tool-execution-end",
        toolCallId: toolCall.toolCallId,
        toolName: tool.name,
        error: errorText,
        isError: true,
      });
    } finally {
      const nextPendingToolCalls = new Set(this._state.pendingToolCalls);
      nextPendingToolCalls.delete(toolCall.toolCallId);
      this._state.pendingToolCalls = nextPendingToolCalls;
      this.emitStateChanged();
    }
  }

  private syncState() {
    if (this.destroyed) {
      return;
    }

    this._state = {
      ...this._state,
      status: this.chat.status,
      messages: this.chat.messages.slice(),
      error: this.chat.error ?? null,
    };

    this.emitStateChanged();
    this.queuePersist();
  }

  private emitStateChanged() {
    this.emit({
      type: "state-changed",
      state: {
        ...this._state,
        messages: this._state.messages.slice(),
        pendingToolCalls: new Set(this._state.pendingToolCalls),
      },
    });
  }

  private queuePersist() {
    const session = this._state.session;
    if (!session) {
      return;
    }

    const sessionId = session.id;
    const messages = this.chat.messages.slice();
    this.persistChain = this.persistChain
      .then(async () => {
        await this.storage.saveMessages(sessionId, messages);
        const nextSession = this.toAgentSession(await this.storage.updateSession(sessionId, {}));
        if (this._state.session?.id === sessionId) {
          this._state.session = nextSession;
        }
      })
      .catch(() => undefined);
  }

  private toAgentSession(session: SessionRecord): AgentSession {
    return {
      id: session.id,
      title: session.title ?? this.initialSessionTitle,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private resetToolAbortController() {
    this.toolAbortController = new AbortController();
  }

  private emit(event: AgentEvent<UI_MESSAGE>) {
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  private ensureNotDestroyed() {
    if (this.destroyed) {
      throw new Error("Agent has been destroyed");
    }
  }
}
