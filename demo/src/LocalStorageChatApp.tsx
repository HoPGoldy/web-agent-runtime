import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  createAgentRuntime,
  createLocalStorageTools,
  IndexedDbAgentStorage,
  type AgentMessage,
  type AgentRuntime,
  type RuntimeEvent,
  type RuntimeState,
  type RuntimeSessionData,
} from "web-agent-runtime";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY?.trim() || "";
const OPENAI_BASE_URL = import.meta.env.VITE_OPENAI_BASE_URL?.trim() || "";
const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const DEFAULT_PROMPT = '把 key profile 保存成 JSON，内容是 {"name":"Wesley","city":"Shanghai" }。';
const SESSION_DB_NAME = "web-agent-runtime-local-storage-chat-demo";
const LOCAL_STORAGE_PREFIX = "chat-demo:";
const SYSTEM_PROMPT = [
  "你是一个浏览器 localStorage 助手。",
  "你只能通过提供的 localStorage tools 读取、创建、更新和删除数据。",
  "当你不确定当前状态，或者用户要修改、覆盖、删除已有数据时，先调用 local_storage_read。",
  "创建新 key 用 local_storage_create，更新已有 key 用 local_storage_update，删除用 local_storage_delete。",
  "如果用户要求删除全部数据，先调用 local_storage_read 列出当前 key，再逐个删除。",
  "回复保持简短，明确说明你操作了哪些 key。",
].join(" ");

type BootStatus = "config-missing" | "idle" | "booting" | "session-creating" | "ready" | "error";

function createSessionTitle() {
  return `LocalStorage Chat ${formatClock(Date.now())}`;
}

export default function LocalStorageChatApp() {
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [input, setInput] = useState(DEFAULT_PROMPT);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    OPENAI_KEY
      ? null
      : "缺少 VITE_OPENAI_API_KEY。先复制 demo/.env.example 到 demo/.env.local，并填入可用于本地验证的 key。",
  );
  const [bootStatus, setBootStatus] = useState<BootStatus>(OPENAI_KEY ? "idle" : "config-missing");

  const handleRuntimeEvent = useEffectEvent((event: RuntimeEvent) => {
    if (event.type === "state_changed") {
      setRuntimeState(event.state);

      if (event.state.error) {
        setBootStatus("error");
        setErrorMessage(event.state.error);
      } else if (event.state.status === "ready" && bootStatus !== "config-missing") {
        setBootStatus("ready");
      }
    }
  });

  useEffect(() => {
    if (!OPENAI_KEY) {
      setBootStatus("config-missing");
      return;
    }

    let active = true;
    let unsubscribe: () => void = () => {};
    let runtime: AgentRuntime | null = null;

    const boot = async () => {
      setBootStatus("booting");
      const nextRuntime = await createAgentRuntime<unknown, RuntimeSessionData>({
        model: {
          provider: "openai",
          id: DEFAULT_MODEL,
        },
        llmProvider: createUnsafeOpenAiProvider({
          apiKey: OPENAI_KEY,
          baseUrl: OPENAI_BASE_URL || undefined,
        }),
        storage: new IndexedDbAgentStorage<RuntimeSessionData>({
          dbName: SESSION_DB_NAME,
        }),
        tools: createLocalStorageTools({
          keyPrefix: LOCAL_STORAGE_PREFIX,
        }),
        systemPrompt: SYSTEM_PROMPT,
        thinkingLevel: "minimal",
        toolExecution: "sequential",
      });

      if (!active) {
        await nextRuntime.destroy();
        return;
      }

      runtime = nextRuntime;
      runtimeRef.current = nextRuntime;
      setRuntimeState(nextRuntime.state);
      unsubscribe = nextRuntime.subscribe((event) => {
        handleRuntimeEvent(event);
      });
      setBootStatus("session-creating");
      await nextRuntime.sessions.create({ title: createSessionTitle() });
      setBootStatus("ready");
    };

    void boot().catch((error: unknown) => {
      if (!active) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setBootStatus("error");
      setErrorMessage(message);
    });

    return () => {
      active = false;
      unsubscribe();
      if (runtime) {
        void runtime.destroy();
      }
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const node = chatLogRef.current;
    if (!node || !shouldStickToBottomRef.current) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [runtimeState?.messages, runtimeState?.streamMessage]);

  const runDisabled = !input.trim() || runtimeState?.status === "streaming";
  const transcript = runtimeState
    ? runtimeState.streamMessage
      ? [...runtimeState.messages, runtimeState.streamMessage]
      : runtimeState.messages
    : [];

  const runTask = async (task: () => Promise<void>) => {
    setErrorMessage(null);

    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    }
  };

  const handleChatLogScroll = () => {
    const node = chatLogRef.current;
    if (!node) {
      return;
    }

    shouldStickToBottomRef.current = isNearBottom(node);
  };

  const submitPrompt = async () => {
    const runtime = runtimeRef.current;

    if (!input.trim()) {
      return;
    }

    if (!OPENAI_KEY) {
      setErrorMessage(
        "缺少 VITE_OPENAI_API_KEY。先复制 demo/.env.example 到 demo/.env.local，并填入可用于本地验证的 key。",
      );
      return;
    }

    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    const nextPrompt = input.trim();
    shouldStickToBottomRef.current = true;
    setInput("");
    await runTask(async () => {
      await runtime.prompt(nextPrompt);
    });
  };

  const createSession = async () => {
    const runtime = runtimeRef.current;

    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    shouldStickToBottomRef.current = true;
    await runTask(async () => {
      await runtime.sessions.create({ title: createSessionTitle() });
    });
  };

  const clearDemoData = () => {
    clearScopedEntries(LOCAL_STORAGE_PREFIX);
    setErrorMessage(null);
  };

  const abortRun = () => {
    runtimeRef.current?.abort();
  };

  return (
    <main className="chat-shell">
      <section className="chat-frame">
        <div ref={chatLogRef} className="chat-log" aria-live="polite" onScroll={handleChatLogScroll}>
          {transcript.length === 0 ? (
            <div className="empty-chat">
              <p>还没有消息。可以直接这样试：</p>
              <p>把 key note 保存为 今天 18:00 和设计组开会。</p>
              <p>读取当前所有 key。</p>
              <p>把 profile 改成新的 JSON，并删除旧的 note。</p>
            </div>
          ) : (
            transcript.map((message, index) => {
              const isStreaming = message === runtimeState?.streamMessage;
              const tone = getBubbleTone(message);
              const text = getMessageText(message);
              const meta = getMessageMeta(message);

              return (
                <article
                  key={`${message.role}-${message.timestamp}-${index}`}
                  className={`chat-bubble ${tone}${isStreaming ? " chat-bubble-streaming" : ""}`}
                >
                  <div className="bubble-topline">
                    <span className="bubble-role">{getRoleLabel(message)}</span>
                    <span className="bubble-meta">{meta}</span>
                  </div>
                  <div className="bubble-body">{text || "..."}</div>
                </article>
              );
            })
          )}
        </div>

        <div className="composer-shell">
          {errorMessage ? <p className="composer-error">{errorMessage}</p> : null}
          <textarea
            className="composer-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submitPrompt();
              }
            }}
            rows={4}
            spellCheck={false}
            placeholder={'例如：创建一个 key 叫 tasks，值是 ["ship demo", "write docs"]'}
          />
          <div className="composer-actions">
            <button
              type="button"
              className="send-button"
              onClick={() => void submitPrompt()}
              disabled={runDisabled}
            >
              发送
            </button>
            <button
              type="button"
              onClick={() => void createSession()}
              disabled={!OPENAI_KEY || runtimeState?.status === "streaming"}
            >
              新会话
            </button>
            <button type="button" onClick={clearDemoData} disabled={runtimeState?.status === "streaming"}>
              清空 demo data
            </button>
            <button type="button" onClick={abortRun} disabled={runtimeState?.status !== "streaming"}>
              中断
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

interface StoredEntry {
  key: string;
  value: string;
}

function getRoleLabel(message: AgentMessage) {
  switch (message.role) {
    case "user":
      return "you";
    case "assistant":
      return "assistant";
    case "toolResult":
      return "tool";
    case "custom":
      return message.customType;
    default:
      return "message";
  }
}

function getMessageMeta(message: AgentMessage) {
  switch (message.role) {
    case "assistant":
      return `${message.model} · ${formatClock(message.timestamp)}`;
    case "toolResult":
      return `${message.toolName} · ${formatClock(message.timestamp)}`;
    default:
      return formatClock(message.timestamp);
  }
}

function getBubbleTone(message: AgentMessage) {
  switch (message.role) {
    case "user":
      return "chat-bubble-user";
    case "assistant":
      return "chat-bubble-assistant";
    case "toolResult":
      return message.isError ? "chat-bubble-error" : "chat-bubble-tool";
    case "custom":
      return "chat-bubble-custom";
    default:
      return "chat-bubble-assistant";
  }
}

function getMessageText(message: AgentMessage) {
  switch (message.role) {
    case "user":
      return typeof message.content === "string" ? message.content : stringifyContentBlocks(message.content);
    case "assistant": {
      const textBlocks: string[] = [];
      const toolCalls: string[] = [];

      for (const block of message.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
          continue;
        }

        if (block.type === "toolCall") {
          toolCalls.push(`${block.name} ${JSON.stringify(block.arguments)}`);
        }
      }

      if (toolCalls.length > 0) {
        textBlocks.push(`调用工具:\n${toolCalls.join("\n")}`);
      }

      return textBlocks.join("\n\n").trim();
    }
    case "toolResult":
      return stringifyContentBlocks(message.content);
    case "custom":
      return typeof message.content === "string" ? message.content : stringifyContentBlocks(message.content);
    default:
      return "";
  }
}

function stringifyContentBlocks(content: Array<{ type: string; text?: string; mimeType?: string }>) {
  return content
    .map((block) => {
      if (block.type === "text") {
        return block.text ?? "";
      }

      if (block.type === "image") {
        return `[image ${block.mimeType ?? "unknown"}]`;
      }

      return `[${block.type}]`;
    })
    .join("\n\n")
    .trim();
}

function formatClock(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function listScopedEntries(prefix: string): StoredEntry[] {
  try {
    const entries: StoredEntry[] = [];

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) {
        continue;
      }

      const value = localStorage.getItem(key);
      if (value === null) {
        continue;
      }

      entries.push({
        key: key.slice(prefix.length),
        value,
      });
    }

    return entries.sort((left, right) => left.key.localeCompare(right.key));
  } catch {
    return [];
  }
}

function clearScopedEntries(prefix: string) {
  for (const entry of listScopedEntries(prefix)) {
    localStorage.removeItem(`${prefix}${entry.key}`);
  }
}

function isNearBottom(node: HTMLDivElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < 24;
}
