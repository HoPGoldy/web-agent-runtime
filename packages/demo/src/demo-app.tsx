import { useEffect, useState } from "react";
import { createAgentRuntime, createLocalStorageTools } from "web-agent-runtime";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY?.trim() || "";
const OPENAI_BASE_URL = import.meta.env.VITE_OPENAI_BASE_URL?.trim() || "";
const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL?.trim() || "";

const createAgent = async () => {
  const agent = await createAgentRuntime({
    model: { id: DEFAULT_MODEL },
    llmProvider: createUnsafeOpenAiProvider({
      apiKey: OPENAI_KEY,
      baseUrl: OPENAI_BASE_URL,
    }),
    tools: createLocalStorageTools(),
  });

  const sessions = await agent.sessions.list();
  console.log("All sessions:", sessions);

  agent.subscribe((e) => {
    console.log("Agent event:", e);
  });

  return agent;
};

type DemoAgent = Awaited<ReturnType<typeof createAgentRuntime>>;

export const DemoApp = () => {
  const [agent, setAgent] = useState<DemoAgent | null>(null);

  useEffect(() => {
    createAgent().then((resp) => {
      setAgent(resp);
    });
  }, []);

  return (
    <div>
      <h1>Web Agent Runtime Demo</h1>
      <p>请查看 README.md 获取使用示例和文档。</p>
      <button
        onClick={async () => {
          if (!agent) return;
          const response = await agent.prompt(
            "把 hahah 写入 localStorage 字段 demo:laugh",
          );
          console.log("Agent response:", response);
        }}
        disabled={!agent}
      >
        发送提示给 Agent
      </button>
    </div>
  );
};
