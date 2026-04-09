import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  createAgentRuntime,
  IndexedDbAgentStorage,
  type AgentRuntime,
  type RuntimeEvent,
  type RuntimeState,
  type RuntimeSessionData,
} from "web-agent-runtime";
import {
  extractAssistantText,
  extractToolCalls,
  findLatestAssistant,
  formatClock,
  summarizeRuntimeEvent,
} from "./lib/formatters";
import { createOpenAiLlmProvider } from "./lib/openai-provider";
import { createSnapshot, createTextareaTools, type TextSelection } from "./lib/textarea-tools";

const DEFAULT_PROMPT = "先读取文本框，再把它改写成更清晰的版本，并说明你做了哪些编辑。";
const DEFAULT_TEXT = `项目会议纪要\n\n1. 下周需要交付 demo。\n2. 文档结构比较乱，需要重新整理。\n3. 用户希望能看到 agent 的事件流和最终输出。\n4. 如果要接入生产环境，OpenAI key 不能放在浏览器里。`;
const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY?.trim() || "";
const OPENAI_BASE_URL = import.meta.env.VITE_OPENAI_BASE_URL?.trim() || "";
const STORAGE_NAME = "web-agent-runtime-demo";
const SYSTEM_PROMPT = [
  "你是一个直接操控文本框的编辑 agent。",
  "在做破坏性编辑前，如果你不确定当前内容，请先调用 textarea_read。",
  "新增内容用 textarea_create，替换内容用 textarea_update，删除内容用 textarea_delete。",
  "完成工具操作后，用简短中文总结你对文本框做了什么。",
].join(" ");

interface EventRow {
  id: string;
  type: RuntimeEvent["type"];
  time: string;
  summary: string;
}

type BootStatus = "config-missing" | "idle" | "booting" | "session-creating" | "ready" | "error";

function createSessionTitle() {
  return `Textarea Lab ${formatClock(Date.now())}`;
}

export default function App() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const editorTextRef = useRef(DEFAULT_TEXT);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });

  const [editorText, setEditorText] = useState(DEFAULT_TEXT);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [bootStatus, setBootStatus] = useState<BootStatus>(OPENAI_KEY ? "idle" : "config-missing");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    OPENAI_KEY
      ? null
      : "缺少 VITE_OPENAI_API_KEY。先复制 demo/.env.example 到 demo/.env.local，并填入 OpenAI key。",
  );
  const deferredEvents = useDeferredValue(events);

  const syncSelectionFromDom = () => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    const nextSelection = {
      start: node.selectionStart ?? 0,
      end: node.selectionEnd ?? 0,
    } satisfies TextSelection;
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  };

  const applyEditorMutation = (value: string, nextSelection: TextSelection) => {
    const snapshot = createSnapshot(value, nextSelection);
    editorTextRef.current = snapshot.value;
    selectionRef.current = snapshot.selection;
    setEditorText(snapshot.value);
    setSelection(snapshot.selection);
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) {
        return;
      }

      node.focus();
      node.setSelectionRange(snapshot.selection.start, snapshot.selection.end);
    });
    return snapshot;
  };

  const handleRuntimeEvent = useEffectEvent((event: RuntimeEvent) => {
    if (event.type === "state_changed") {
      setRuntimeState(event.state);
      if (event.state.status === "ready" && bootStatus !== "error") {
        setBootStatus("ready");
      }
      if (event.state.error) {
        setBootStatus("error");
        setErrorMessage(event.state.error);
      }
    }

    startTransition(() => {
      setEvents((previous) => {
        const nextRow: EventRow = {
          id: crypto.randomUUID(),
          type: event.type,
          time: formatClock(Date.now()),
          summary: summarizeRuntimeEvent(event),
        };
        return [nextRow, ...previous].slice(0, 48);
      });
    });
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
        llmProvider: createOpenAiLlmProvider({
          apiKey: OPENAI_KEY,
          baseUrl: OPENAI_BASE_URL || undefined,
        }),
        storage: new IndexedDbAgentStorage<RuntimeSessionData>({
          dbName: STORAGE_NAME,
        }),
        tools: createTextareaTools({
          read() {
            return createSnapshot(editorTextRef.current, selectionRef.current);
          },
          apply(value, nextSelection) {
            return applyEditorMutation(value, nextSelection);
          },
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
  }, [DEFAULT_MODEL, OPENAI_BASE_URL, OPENAI_KEY, handleRuntimeEvent]);

  const isStreaming = runtimeState?.status === "streaming";
  const latestAssistant = findLatestAssistant(runtimeState);
  const latestAssistantText = extractAssistantText(latestAssistant);
  const latestToolCalls = extractToolCalls(latestAssistant);
  const runtimeStatus = runtimeState?.status ?? (OPENAI_KEY ? "booting" : "config-missing");
  const sessionIdLabel = runtimeState?.session?.id.slice(0, 8) ?? "none";
  const runDisabled =
    !OPENAI_KEY || isStreaming || bootStatus === "booting" || bootStatus === "session-creating";

  const runRuntimeTask = async (task: () => Promise<void>) => {
    setErrorMessage(null);
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    }
  };

  const submitPrompt = async () => {
    const runtime = runtimeRef.current;
    if (!prompt.trim()) {
      setErrorMessage("Prompt 为空，先输入一条指令。");
      return;
    }

    if (!runtime) {
      const message = `Runtime 尚未初始化完成。bootStatus=${bootStatus}`;
      setErrorMessage(message);
      return;
    }

    await runRuntimeTask(async () => {
      await runtime.prompt(prompt.trim());
    });
  };

  const continueRun = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    await runRuntimeTask(async () => {
      await runtime.continue();
    });
  };

  const compactSession = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    await runRuntimeTask(async () => {
      await runtime.compact();
    });
  };

  const createSession = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      setErrorMessage(`Runtime 尚未初始化完成。bootStatus=${bootStatus}`);
      return;
    }

    await runRuntimeTask(async () => {
      await runtime.sessions.create({ title: createSessionTitle() });
    });
  };

  const abortRun = () => {
    runtimeRef.current?.abort();
  };

  const latestOutput = latestAssistantText || "模型输出会显示在这里。";

  return (
    <main className="shell">
      <header className="masthead">
        <div className="masthead-copy">
          <p className="eyebrow">web-agent runtime demo</p>
          <h1>Textarea Agent 验证页</h1>
          <p className="masthead-note">用一个最小界面验证 textarea 工具调用、会话状态和事件流是否正常。</p>
        </div>
        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">Model</span>
            <span className="status-value">{DEFAULT_MODEL}</span>
          </div>
          <div className="status-card">
            <span className="status-label">Boot</span>
            <span className="status-value">{bootStatus}</span>
          </div>
          <div className="status-card">
            <span className="status-label">Runtime</span>
            <span className="status-value">{runtimeStatus}</span>
          </div>
          <div className="status-card">
            <span className="status-label">Session</span>
            <span className="status-value">{sessionIdLabel}</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <article className="panel editor-panel">
          <header className="panel-head">
            <div>
              <h2 className="section-title">文本区域</h2>
              <p className="section-note">
                Agent 会通过 textarea_read / textarea_create / textarea_update / textarea_delete
                直接操作这里。
              </p>
            </div>
            <div className="panel-meta">
              <span>{editorText.length} chars</span>
              <span>
                selection {selection.start}-{selection.end}
              </span>
            </div>
          </header>
          <textarea
            ref={textareaRef}
            className="editor"
            value={editorText}
            onChange={(event) => {
              const nextValue = event.target.value;
              const nextSelection = {
                start: event.target.selectionStart ?? nextValue.length,
                end: event.target.selectionEnd ?? nextValue.length,
              } satisfies TextSelection;
              editorTextRef.current = nextValue;
              selectionRef.current = nextSelection;
              setEditorText(nextValue);
              setSelection(nextSelection);
            }}
            onSelect={syncSelectionFromDom}
            onClick={syncSelectionFromDom}
            onKeyUp={syncSelectionFromDom}
            spellCheck={false}
          />
          <footer className="panel-foot">手动修改文本或选区后，下一次运行会以当前内容作为工具上下文。</footer>
        </article>

        <div className="side-stack">
          <article className="panel prompt-panel">
            <header className="panel-head">
              <div>
                <h2 className="section-title">操作指令</h2>
                <p className="section-note">输入 prompt 后点击运行，或使用 Cmd/Ctrl + Enter 提交。</p>
              </div>
            </header>
            <textarea
              className="prompt-box"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
              placeholder="输入你希望 agent 对文本框执行的操作"
            />
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => void submitPrompt()}
                disabled={runDisabled}
              >
                运行
              </button>
              <button
                type="button"
                onClick={() => void continueRun()}
                disabled={!runtimeState?.session || isStreaming}
              >
                继续
              </button>
              <button
                type="button"
                onClick={() => void compactSession()}
                disabled={!runtimeState?.session || isStreaming}
              >
                压缩
              </button>
              <button
                type="button"
                onClick={() => void createSession()}
                disabled={isStreaming || !OPENAI_KEY}
              >
                新会话
              </button>
              <button type="button" className="ghost-button" onClick={abortRun} disabled={!isStreaming}>
                中断
              </button>
            </div>
            <p className="console-note">
              当前 demo 会直接从浏览器读取 VITE_OPENAI_API_KEY，并请求 OpenAI-compatible endpoint。
              这只适用于本地验证，线上必须改成后端代理。
            </p>
            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </article>

          <article className="panel output-panel">
            <header className="panel-head">
              <div>
                <h2 className="section-title">模型输出</h2>
                <p className="section-note">这里显示最新一条 assistant 文本，以及本轮用到的工具。</p>
              </div>
            </header>
            <div className="output-copy">{latestOutput}</div>
            {latestToolCalls.length > 0 ? (
              <div className="tool-call-list">
                {latestToolCalls.map((toolCall) => (
                  <span key={toolCall.id} className="tool-chip">
                    {toolCall.name}
                  </span>
                ))}
              </div>
            ) : null}
          </article>

          <article className="panel event-panel">
            <header className="panel-head">
              <div>
                <h2 className="section-title">事件流</h2>
                <p className="section-note">最近 48 条 runtime event，用来确认执行链路是否符合预期。</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setEvents([])}>
                清空
              </button>
            </header>
            <div className="event-list">
              {deferredEvents.length === 0 ? (
                <p className="empty-state">事件流会显示在这里。</p>
              ) : (
                deferredEvents.map((event) => (
                  <div key={event.id} className="event-row">
                    <div className="event-topline">
                      <span className="event-type">{event.type}</span>
                      <span className="event-time">{event.time}</span>
                    </div>
                    <p className="event-summary">{event.summary}</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
