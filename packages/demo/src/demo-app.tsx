import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AssistantMessage,
  type RuntimeEvent,
  type RuntimeState,
  type SessionRecord,
  type ToolCallBlock,
} from "web-agent-runtime";
import { createLocalStorageTools } from "web-agent-runtime/local-storage";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY?.trim() || "";
const OPENAI_BASE_URL = import.meta.env.VITE_OPENAI_BASE_URL?.trim() || "";
const DEFAULT_MODEL =
  import.meta.env.VITE_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const DEFAULT_SESSION_TITLE = "New chat";
const SAMPLE_PROMPTS = [
  'Save profile as JSON with name "Wesley" and city "Shanghai".',
  "Read all localStorage keys and tell me what is stored there.",
  'Update tasks to ["ship demo", "write docs"].',
];

function sortSessions(sessions: SessionRecord[]) {
  return [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function formatSessionTitle(session: SessionRecord | null) {
  return session?.title?.trim() || DEFAULT_SESSION_TITLE;
}

function summarizePrompt(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 28 ? normalized : `${normalized.slice(0, 28)}...`;
}

function formatClock(value: string | number) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelative(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  return `${Math.round(hours / 24)} d ago`;
}

function readTextContent(
  content: string | Array<{ type: string; text?: string; mimeType?: string }>,
) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text ?? "";
      }

      if (block.type === "image") {
        return `[image:${block.mimeType ?? "unknown"}]`;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getAssistantText(message: AssistantMessage) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function getThinkingText(message: AssistantMessage) {
  return message.content
    .filter((block) => block.type === "thinking")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function getToolCalls(message: AssistantMessage) {
  return message.content.filter(
    (block): block is ToolCallBlock => block.type === "toolCall",
  );
}

const createRuntime = async () => {
  return createAgentRuntime({
    model: { id: DEFAULT_MODEL },
    llmProvider: createUnsafeOpenAiProvider({
      apiKey: OPENAI_KEY,
      baseUrl: OPENAI_BASE_URL,
    }),
    tools: createLocalStorageTools({ keyPrefix: "demo:" }),
    systemPrompt: [
      "You are the demo assistant for web-agent-runtime.",
      "Use browser localStorage tools when the user asks to inspect, create, update, or delete browser-side data.",
      "When a tool is used, explain clearly what changed.",
    ].join(" "),
  });
};

export const DemoApp = () => {
  const [agent, setAgent] = useState<AgentRuntime | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [input, setInput] = useState("");
  const [bootError, setBootError] = useState<string | null>(null);
  const [undonePreview, setUndonePreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!OPENAI_KEY) {
      return;
    }

    let disposed = false;
    let runtime: AgentRuntime | null = null;
    let unsubscribe: (() => void) | undefined;

    const refreshSessions = async (instance: AgentRuntime) => {
      const nextSessions = sortSessions(await instance.sessions.list());
      if (!disposed) {
        setSessions(nextSessions);
      }
    };

    const handleEvent = (event: RuntimeEvent) => {
      if (event.type === "state_changed") {
        setRuntimeState(event.state);
        if (event.state.error) {
          setBootError(event.state.error);
        }
        return;
      }

      if (!runtime) {
        return;
      }

      if (event.type === "session_created") {
        void refreshSessions(runtime);
        return;
      }

      if (event.type === "session_opened") {
        void refreshSessions(runtime);
        return;
      }

      if (event.type === "session_updated") {
        void refreshSessions(runtime);
        return;
      }

      if (event.type === "session_deleted") {
        void refreshSessions(runtime);
        return;
      }

      if (event.type === "agent_end") {
        void refreshSessions(runtime);
      }

      if (event.type === "undo_applied" || event.type === "redo_applied") {
        void refreshSessions(runtime);
      }
    };

    const boot = async () => {
      try {
        runtime = await createRuntime();
        if (disposed) {
          await runtime.destroy();
          return;
        }

        unsubscribe = runtime.subscribe(handleEvent);

        const existingSessions = sortSessions(await runtime.sessions.list());
        if (existingSessions.length > 0) {
          await runtime.sessions.open(existingSessions[0].id);
        } else {
          await runtime.sessions.create({ title: DEFAULT_SESSION_TITLE });
        }

        if (disposed) {
          await runtime.destroy();
          return;
        }

        setAgent(runtime);
        setRuntimeState(runtime.state);
        setSessions(sortSessions(await runtime.sessions.list()));
      } catch (error) {
        if (!disposed) {
          setBootError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      unsubscribe?.();
      if (runtime) {
        void runtime.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [runtimeState?.messages, runtimeState?.streamMessage]);

  const renderedMessages = runtimeState?.streamMessage
    ? [...runtimeState.messages, runtimeState.streamMessage]
    : (runtimeState?.messages ?? []);

  const isBusy = runtimeState?.status === "streaming";
  const canSend = Boolean(agent) && Boolean(input.trim()) && !isBusy;

  const runSafely = async (action: () => Promise<void>) => {
    try {
      setBootError(null);
      await action();
    } catch (error) {
      setBootError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCreateSession = async () => {
    if (!agent || isBusy) {
      return;
    }

    await runSafely(async () => {
      await agent.sessions.create({ title: DEFAULT_SESSION_TITLE });
      setInput("");
    });
  };

  const handleOpenSession = async (sessionId: string) => {
    if (!agent || isBusy || runtimeState?.session?.id === sessionId) {
      return;
    }

    await runSafely(async () => {
      await agent.sessions.open(sessionId);
    });
  };

  const handleSubmit = async (prompt: string) => {
    if (!agent) {
      return;
    }

    const text = prompt.trim();
    if (!text || isBusy) {
      return;
    }

    setInput("");
    await runSafely(async () => {
      const currentSession = runtimeState?.session;
      if (
        currentSession &&
        (!currentSession.title?.trim() ||
          currentSession.title === DEFAULT_SESSION_TITLE)
      ) {
        await agent.sessions.update(currentSession.id, {
          title: summarizePrompt(text),
        });
      }

      await agent.prompt(text);
    });
  };

  const handleUndo = useCallback(
    async (messageId: string) => {
      if (!agent || isBusy) {
        return;
      }

      await runSafely(async () => {
        const result = await agent.undo(messageId);
        const content = result.userMessage.content;
        const text = typeof content === "string" ? content : "";
        setInput(text);
        setUndonePreview(text.length > 40 ? `${text.slice(0, 40)}...` : text);
      });
    },
    [agent, isBusy],
  );

  const handleRedo = useCallback(async () => {
    if (!agent || isBusy) {
      return;
    }

    await runSafely(async () => {
      await agent.redo();
      setInput("");
      setUndonePreview(null);
    });
  }, [agent, isBusy]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="sidebar-button"
          onClick={() => void handleCreateSession()}
          disabled={!agent || isBusy}
        >
          + New chat
        </button>

        <div className="sidebar-section">
          <div className="sidebar-title">Chats</div>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`session-item ${runtimeState?.session?.id === session.id ? "is-active" : ""}`}
                onClick={() => void handleOpenSession(session.id)}
              >
                <span className="session-item-title">
                  {formatSessionTitle(session)}
                </span>
                <small>{formatRelative(session.updatedAt)}</small>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <h1>{formatSessionTitle(runtimeState?.session ?? null)}</h1>
        </header>

        <section className="chat-panel">
          <div className="message-list" ref={scrollRef}>
            {!OPENAI_KEY ? (
              <div className="empty-state">
                <h2>Set an API key to start the demo</h2>
                <p>
                  Set VITE_OPENAI_API_KEY in packages/demo/.env.local, then
                  restart the dev server.
                </p>
              </div>
            ) : null}

            {bootError ? <div className="banner-error">{bootError}</div> : null}

            {OPENAI_KEY && renderedMessages.length === 0 ? (
              <div className="empty-state">
                <p>Try one of these prompts</p>
                <div className="sample-list">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className="sample-item"
                      onClick={() => setInput(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {renderedMessages.map((message, index) => {
              const key = message.id ?? `message-${index}-${message.role}`;

              if (message.role === "user") {
                return (
                  <article key={key} className="message-row user-row">
                    {message.id ? (
                      <div className="user-actions">
                        <button
                          className="action-pill"
                          onClick={() => void handleUndo(message.id!)}
                          disabled={isBusy}
                          title="Undo this message"
                        >
                          ↩ Undo
                        </button>
                      </div>
                    ) : null}
                    <div className="message-bubble user-bubble">
                      {readTextContent(message.content)}
                    </div>
                  </article>
                );
              }

              if (message.role === "assistant") {
                const text = getAssistantText(message);
                const thinking = getThinkingText(message);
                const toolCalls = getToolCalls(message);
                const isStreamingMessage =
                  runtimeState?.streamMessage === message;

                return (
                  <article key={key} className="message-row assistant-row">
                    <div className="message-card">
                      {text ? <div className="message-text">{text}</div> : null}
                      {thinking ? (
                        <div className="message-meta">thinking: {thinking}</div>
                      ) : null}
                      {toolCalls.length > 0 ? (
                        <div className="tool-call-list">
                          {toolCalls.map((toolCall) => (
                            <span key={toolCall.id} className="tool-pill">
                              {toolCall.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {message.stopReason === "error" &&
                      message.errorMessage ? (
                        <div className="message-error">
                          {message.errorMessage}
                        </div>
                      ) : null}
                      <div className="message-footer">
                        <span>{formatClock(message.timestamp)}</span>
                        {isStreamingMessage ? <span>Generating</span> : null}
                      </div>
                    </div>
                  </article>
                );
              }

              if (message.role === "toolResult") {
                return (
                  <article key={key} className="message-row tool-row">
                    <div
                      className={`tool-result ${message.isError ? "is-error" : ""}`}
                    >
                      <div className="tool-result-name">{message.toolName}</div>
                      <div className="message-text">
                        {message.content.map((block, blockIndex) => (
                          <p key={`${key}-block-${blockIndex}`}>
                            {block.type === "text"
                              ? block.text
                              : `[image:${block.mimeType}]`}
                          </p>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <article key={key} className="message-row assistant-row">
                  <div className="message-card">
                    {readTextContent(message.content)}
                  </div>
                </article>
              );
            })}
          </div>

          {runtimeState?.canRedo ? (
            <div className="redo-bar">
              <button
                className="redo-bar-button"
                onClick={() => void handleRedo()}
                disabled={isBusy}
              >
                ↻ Redo{undonePreview ? ` “${undonePreview}”` : ""}
              </button>
            </div>
          ) : null}

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSubmit(input);
                }
              }}
              placeholder={
                OPENAI_KEY
                  ? "Give the agent an instruction to read or write localStorage"
                  : "Waiting for environment configuration"
              }
              disabled={!agent || isBusy || !OPENAI_KEY}
            />
            <button
              onClick={() => void handleSubmit(input)}
              disabled={!canSend}
            >
              Send
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
