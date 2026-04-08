import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmCallInterface } from "../src/llm/llm-call-interface";
import type { StorageInterface } from "../src/storage/storage-interface";
import type { ToolInterface } from "../src/tools/tool-interface";
import type { AgentEvent, AgentSession } from "../src/types";

const { FakeRuntimeChat } = vi.hoisted(() => {
  class FakeRuntimeChat {
    static instances: FakeRuntimeChat[] = [];

    messages: unknown[];
    status: "submitted" | "ready" = "ready";
    error: Error | undefined;
    sendCalls: unknown[] = [];
    toolOutputs: unknown[] = [];
    stopped = false;
    private readonly onStateChange?: () => void;
    private readonly onFinish?: () => void;

    constructor(options: { messages?: unknown[]; onStateChange?: () => void; onFinish?: () => void }) {
      this.messages = options.messages?.slice() ?? [];
      this.onStateChange = options.onStateChange;
      this.onFinish = options.onFinish;
      FakeRuntimeChat.instances.push(this);
    }

    static reset() {
      FakeRuntimeChat.instances = [];
    }

    replaceAllMessages(messages: unknown[]) {
      this.messages = messages.slice();
      this.onStateChange?.();
    }

    appendMessages(messages: unknown[]) {
      this.messages = [...this.messages, ...messages];
      this.onStateChange?.();
    }

    async sendMessage(message?: unknown) {
      if (message) {
        this.messages = [...this.messages, message];
      }
      this.status = "submitted";
      this.onStateChange?.();
      this.status = "ready";
      this.onStateChange?.();
      this.sendCalls.push(message);
      this.onFinish?.();
    }

    async stop() {
      this.stopped = true;
    }

    async addToolOutput(output: unknown) {
      this.toolOutputs.push(output);
    }
  }

  return { FakeRuntimeChat };
});

vi.mock("../src/runtime-chat", () => ({
  RuntimeChat: FakeRuntimeChat,
}));

import { Agent } from "../src/agent";

function createMessage(id: string) {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  } as unknown as UIMessage;
}

function createStorage() {
  const sessions = new Map<string, AgentSession>();
  const messages = new Map<string, UIMessage[]>();
  const saveCalls: Array<{ id: string; messages: UIMessage[] }> = [];

  const storage: StorageInterface<UIMessage> = {
    createSession: vi.fn(async (input = {}) => {
      const now = new Date().toISOString();
      const session: AgentSession = {
        id: input.id ?? `session-${sessions.size + 1}`,
        title: input.title ?? "Untitled Session",
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session.id, session);
      return session;
    }),
    getSession: vi.fn(async (id: string) => sessions.get(id) ?? null),
    listSessions: vi.fn(async () => Array.from(sessions.values())),
    updateSession: vi.fn(async (id: string, patch) => {
      const current = sessions.get(id);
      if (!current) {
        throw new Error(`Session not found: ${id}`);
      }

      const next: AgentSession = {
        ...current,
        ...patch,
        updatedAt: patch.updatedAt ?? current.updatedAt,
      };
      sessions.set(id, next);
      return next;
    }),
    deleteSession: vi.fn(async (id: string) => {
      sessions.delete(id);
      messages.delete(id);
    }),
    loadMessages: vi.fn(async (id: string) => messages.get(id)?.slice() ?? []),
    saveMessages: vi.fn(async (id: string, nextMessages: UIMessage[]) => {
      const snapshot = nextMessages.slice();
      messages.set(id, snapshot);
      saveCalls.push({ id, messages: snapshot });
    }),
  };

  return { storage, sessions, messages, saveCalls };
}

function createLlmCaller() {
  const destroy = vi.fn();
  const llmCaller: LlmCallInterface<UIMessage> = {
    createTransport: vi.fn(() => ({}) as never),
    destroy,
  };

  return { llmCaller, destroy };
}

describe("Agent", () => {
  beforeEach(() => {
    FakeRuntimeChat.reset();
  });

  it("creates a session on first prompt and persists messages", async () => {
    const { storage, sessions, saveCalls } = createStorage();
    const { llmCaller } = createLlmCaller();
    const agent = new Agent({
      storage,
      llmCaller,
      sessionTitle: "Test Session",
    });

    await agent.prompt("hello");

    expect(sessions.size).toBe(1);
    expect(agent.state.session?.title).toBe("Test Session");
    expect(agent.state.isInitialized).toBe(true);
    await vi.waitFor(() => {
      expect(saveCalls[saveCalls.length - 1]?.messages).toHaveLength(1);
    });
    expect(FakeRuntimeChat.instances[0]?.sendCalls).toHaveLength(1);
  });

  it("opens an existing session and loads its messages", async () => {
    const { storage, sessions, messages } = createStorage();
    const { llmCaller } = createLlmCaller();
    const existingSession: AgentSession = {
      id: "session-1",
      title: "Existing Session",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const existingMessage = createMessage("message-1");
    sessions.set(existingSession.id, existingSession);
    messages.set(existingSession.id, [existingMessage]);
    const agent = new Agent({ storage, llmCaller });

    await agent.sessions.open(existingSession.id);

    expect(agent.state.session).toEqual(existingSession);
    expect(agent.state.messages).toEqual([existingMessage]);
    expect(FakeRuntimeChat.instances[0]?.messages).toEqual([existingMessage]);
  });

  it("executes tools, emits lifecycle events, and records tool outputs", async () => {
    const { storage } = createStorage();
    const { llmCaller } = createLlmCaller();
    const events: AgentEvent<UIMessage>[] = [];
    const tool: ToolInterface<{ key: string }, { ok: true }, UIMessage> = {
      name: "read",
      description: "Read a file",
      inputSchema: { type: "object" },
      execute: vi.fn(async (_toolCallId, _input, _context, _signal, onUpdate) => {
        onUpdate?.({ step: "halfway" });
        return { ok: true } as const;
      }),
    };
    const agent = new Agent({
      storage,
      llmCaller,
      tools: [tool],
    });
    agent.subscribe((event) => events.push(event));

    await (
      agent as unknown as {
        handleToolCall: (toolCall: { toolCallId: string; toolName: string; input: unknown }) => Promise<void>;
      }
    ).handleToolCall({
      toolCallId: "tool-call-1",
      toolName: "read",
      input: { key: "app.ts" },
    });

    expect(tool.execute).toHaveBeenCalledWith(
      "tool-call-1",
      { key: "app.ts" },
      { session: null, messages: [] },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["tool-execution-start", "tool-execution-update", "tool-execution-end"]),
    );
    expect(agent.state.pendingToolCalls.size).toBe(0);
    expect(FakeRuntimeChat.instances[0]?.toolOutputs).toEqual([
      {
        tool: "read",
        toolCallId: "tool-call-1",
        output: { ok: true },
      },
    ]);
  });

  it("reports unsupported tools as tool output errors", async () => {
    const { storage } = createStorage();
    const { llmCaller } = createLlmCaller();
    const agent = new Agent({ storage, llmCaller });

    await (
      agent as unknown as {
        handleToolCall: (toolCall: { toolCallId: string; toolName: string; input: unknown }) => Promise<void>;
      }
    ).handleToolCall({
      toolCallId: "tool-call-2",
      toolName: "missing",
      input: {},
    });

    expect(FakeRuntimeChat.instances[0]?.toolOutputs).toEqual([
      {
        state: "output-error",
        tool: "missing",
        toolCallId: "tool-call-2",
        errorText: "Unsupported tool: missing",
      },
    ]);
  });

  it("aborts the runtime chat and tears down resources on destroy", async () => {
    const { storage } = createStorage();
    const { llmCaller, destroy } = createLlmCaller();
    const agent = new Agent({ storage, llmCaller });

    agent.abort();
    expect(FakeRuntimeChat.instances[0]?.stopped).toBe(true);

    agent.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(agent.state.status).toBe("destroyed");
    await expect(agent.prompt("after destroy")).rejects.toThrow("Agent has been destroyed");
  });
});
