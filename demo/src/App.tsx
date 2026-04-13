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
const SESSION_DB_NAME = createSessionDbName();
const LOCAL_STORAGE_PREFIX = "minimal-chat:";
const DEFAULT_PROMPT = '把 profile 保存成 JSON，内容是 {"name":"Wesley","city":"Shanghai"}。';
const SYSTEM_PROMPT = [
  "你是一个简洁的浏览器助手。",
  "你只能通过提供的 localStorage tools 读写数据。",
  "当用户要求读取、创建、更新、删除或确认当前状态时，优先使用工具而不是猜测。",
  "回复简短直接，明确说明你读写了哪些 key。",
].join(" ");

type BootStatus = "config-missing" | "idle" | "booting" | "session-creating" | "ready" | "error";

function createSessionTitle() {
  return `Minimal Chat ${formatClock(Date.now())}`;
}

function createSessionDbName() {
  return `web-agent-runtime-minimal-chat-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [input, setInput] = useState(DEFAULT_PROMPT);
  const [bootStatus, setBootStatus] = useState<BootStatus>(OPENAI_KEY ? "idle" : "config-missing");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    OPENAI_KEY
      ? null
      : "缺少 VITE_OPENAI_API_KEY。先复制 demo/.env.example 到 demo/.env.local，并填入仅用于本地验证的 key。",
  );

  const handleRuntimeEvent = useEffectEvent((event: RuntimeEvent) => {
    if (event.type !== "state_changed") {
      return;
    }

    setRuntimeState(event.state);

    if (event.state.error) {
      setBootStatus("error");
      setErrorMessage(event.state.error);
      return;
    }

    if (event.state.status === "ready" && bootStatus !== "config-missing") {
      setBootStatus("ready");
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
      unsubscribe = nextRuntime.subscribe((event) => {
        handleRuntimeEvent(event);
      });
      setBootStatus("session-creating");
      await nextRuntime.sessions.create({ title: createSessionTitle() });
      runtimeRef.current = nextRuntime;
      setRuntimeState(nextRuntime.state);
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

  const transcript = runtimeState
    ? runtimeState.streamMessage
      ? [...runtimeState.messages, runtimeState.streamMessage]
      : runtimeState.messages
    : [];
  const isStreaming = runtimeState?.status === "streaming";
  const isReady = bootStatus === "ready";
  const runDisabled = !input.trim() || !OPENAI_KEY || !isReady || isStreaming;

  const runTask = async (task: () => Promise<void>) => {
    setErrorMessage(null);

    try {
      await task();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    }
  };

  const submitPrompt = async (nextPrompt?: string) => {
    const runtime = runtimeRef.current;
    const prompt = (nextPrompt ?? input).trim();

    if (!prompt) {
      return;
    }

    if (!OPENAI_KEY) {
      setErrorMessage(
        "缺少 VITE_OPENAI_API_KEY。先复制 demo/.env.example 到 demo/.env.local，并填入仅用于本地验证的 key。",
      );
      return;
    }

    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    if (bootStatus !== "ready") {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    shouldStickToBottomRef.current = true;
    if (!nextPrompt) {
      setInput("");
    }

    await runTask(async () => {
      await runtime.prompt(prompt);
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
    <main className="minimal-shell">
      <section className="minimal-frame">
        <div
          ref={chatLogRef}
          className="minimal-chat-log"
          aria-live="polite"
          onScroll={() => handleChatLogScroll(chatLogRef, shouldStickToBottomRef)}
        >
          {transcript.map((message, index) => {
            const isStreamingMessage = message === runtimeState?.streamMessage;
            return (
              <article
                key={`${message.role}-${message.timestamp}-${index}`}
                className={`minimal-bubble ${getBubbleTone(message)}${isStreamingMessage ? " minimal-bubble-streaming" : ""}`}
              >
                <div className="minimal-bubble-topline">
                  <span>{getRoleLabel(message)}</span>
                  <span>{getMessageMeta(message)}</span>
                </div>
                <div className="minimal-bubble-body">{getMessageText(message) || "..."}</div>
              </article>
            );
          })}
        </div>

        <footer className="minimal-composer">
          {errorMessage ? <p className="minimal-error">{errorMessage}</p> : null}
          <textarea
            className="minimal-input"
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
            placeholder='例如：把 profile 改成 {"name":"Wesley","role":"builder"}，然后告诉我修改结果。'
          />
          <div className="minimal-action-row">
            <button
              type="button"
              className="primary-action"
              onClick={() => void submitPrompt()}
              disabled={runDisabled}
            >
              发送
            </button>
            <button type="button" onClick={() => void createSession()} disabled={!OPENAI_KEY || !isReady || isStreaming}>
              新会话
            </button>
            <button type="button" onClick={clearDemoData} disabled={!isReady || isStreaming}>
              清空数据
            </button>
            <button type="button" onClick={abortRun} disabled={!isReady || !isStreaming}>
              中断
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function handleChatLogScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  shouldStickToBottomRef: React.MutableRefObject<boolean>,
) {
  const node = ref.current;
  if (!node) {
    return;
  }

  shouldStickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
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
      return " bubble-user";
    case "assistant":
      return " bubble-assistant";
    case "toolResult":
      return message.isError ? " bubble-error" : " bubble-tool";
    case "custom":
      return " bubble-custom";
    default:
      return " bubble-assistant";
  }
}

function getMessageText(message: AgentMessage) {
  switch (message.role) {
    case "user":
      return typeof message.content === "string" ? message.content : stringifyContent(message.content);
    case "assistant": {
      const blocks: string[] = [];

      for (const block of message.content) {
        if (block.type === "text") {
          blocks.push(block.text);
          continue;
        }

        if (block.type === "toolCall") {
          blocks.push(`${block.name} ${JSON.stringify(block.arguments)}`);
        }
      }

      return blocks.join("\n\n").trim();
    }
    case "toolResult":
      return stringifyContent(message.content);
    case "custom":
      return stringifyContent(message.content);
    default:
      return "";
  }
}

function stringifyContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return JSON.stringify(block);
      }

      if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
        return block.text;
      }

      return JSON.stringify(block);
    })
    .join("\n\n");
}

function clearScopedEntries(prefix: string) {
  const keys: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(prefix)) {
      continue;
    }

    keys.push(key);
  }

  for (const key of keys) {
    localStorage.removeItem(key);
  }
}

function formatClock(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
