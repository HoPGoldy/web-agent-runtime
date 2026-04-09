# web-agent-runtime

[English](./README.md) | 简体中文

`web-agent-runtime` 是一个面向浏览器宿主环境的 agent runtime，适合在 Web 场景里实现类似 Claude Code 的交互式 agent 行为。

## 为什么会有这个项目

很多人会觉得，在 Web 里做一个类似 Claude Code 的 agent runtime 没什么意义。对于普通公开网站，这个判断很多时候并不算错。但在一些特殊场景里，浏览器本身就是最合适的运行位置，因为能力就暴露在这里：

- 浏览器插件
- Office 插件和其他嵌入式生产力插件
- 公司内部门户、业务后台、SaaS 控制台
- 暴露了宿主专有 JavaScript API 的产品界面

在这些环境里，agent 需要直接接触当前页面状态、宿主上下文和浏览器侧能力。浏览器并不只是一个 UI 壳，它本身就是能力桥接层。这个项目就是为这种场景设计的。

它的目标是把浏览器侧 tools、宿主暴露的 JavaScript API，以及可持久化的 session 状态接到一个 agent loop 里，同时把模型访问放在你自己的后端代理之后。

## 这个项目适合什么场景

当你需要在 Web 宿主环境里提供一个可交互的 agent，而且这个 agent 需要调用浏览器或宿主能力时，可以使用这个项目。例如：

- 浏览器插件 agent，可以读取或操作当前标签页
- Office Add-in agent，可以通过 Office.js 读取和修改文档状态
- 公司门户里的智能助手，可以调用内部 Web API 并结合当前页面上下文工作
- 产品内 agent，可以使用页面状态和业务专属工具完成任务

如果你的 agent 只需要运行在服务端，这个仓库大概率不是最合适的抽象层。

## 核心能力

- 面向浏览器的 runtime 主链路
- session CRUD、fork、compaction、steering、follow-up
- 可插拔的 LLM provider、storage provider、prompt composer 和 tools 契约
- 基于 IndexedDB 的浏览器端 session 持久化
- AI SDK 兼容的 HTTP 适配层，方便把浏览器请求接到你的后端

## 架构概览

当前推荐的主路径围绕以下对象展开：

- `createAgentRuntime` 作为新 runtime 入口
- `createAiSdkLlmProvider` 作为对接后端模型访问的 provider
- `IndexedDbAgentStorage` 作为浏览器侧存储实现
- `createJsonSessionDataCodec` 作为默认 session document codec
- `tools[]` 和 `getHostContext()` 作为宿主能力注入方式

整体上可以分成四层：

- Runtime 层：agent loop、事件、工具执行、compaction、session 控制
- Session 层：session graph、历史恢复、codec、revision 管理
- Provider 层：模型流式输出契约、prompt 组装、tool 元数据
- Host 层：你的浏览器应用、插件、Office Add-in 或门户系统暴露的能力

## 与 pi-mono 的关系

这个项目在设计时参考了 `pi-mono` 的项目架构。

更具体地说，runtime 控制流、provider 契约、session 数据结构、宿主注入工具这几层的拆分思路，和 `pi-mono` 保持一致的方向：agent 核心尽量收敛，集成边界尽量明确，宿主能力通过可插拔方式接入，而不是写死在核心里。

## 安装

```bash
npm install web-agent-runtime
```

如果你是在当前仓库里本地开发：

```bash
npm install
npm run build
npm test
npm run typecheck
```

## 最小示例

```ts
import {
  createAgentRuntime,
  createAiSdkLlmProvider,
  createJsonSessionDataCodec,
  IndexedDbAgentStorage,
  type RuntimeSessionData,
  type ToolDefinition,
} from "web-agent-runtime";

type HostContext = {
  apiBase: string;
};

const portalSearchTool: ToolDefinition<{ query: string }, { source: string }, unknown, HostContext> = {
  name: "portal_search",
  description: "Search the company portal for documents and pages.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
  async execute({ input, context, signal }) {
    const response = await fetch(
      `${context.hostContext.apiBase}/api/search?q=${encodeURIComponent(input.query)}`,
      { signal },
    );
    const data = (await response.json()) as unknown;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data),
        },
      ],
      details: { source: "portal" },
    };
  },
};

const runtime = await createAgentRuntime<HostContext, RuntimeSessionData>({
  model: {
    provider: "company-proxy",
    id: "claude-sonnet-4-5",
  },
  llmProvider: createAiSdkLlmProvider({
    api: "/api/agent",
    headers: {
      "Content-Type": "application/json",
    },
  }),
  storage: new IndexedDbAgentStorage<RuntimeSessionData>({
    dbName: "company-portal-agent",
  }),
  sessionDataCodec: createJsonSessionDataCodec(),
  systemPrompt: "You are an internal portal assistant. Use tools when they help.",
  thinkingLevel: "minimal",
  toolExecution: "sequential",
  getHostContext: () => ({
    apiBase: window.location.origin,
  }),
  tools: [portalSearchTool],
});

await runtime.sessions.create({ title: "Portal assistant" });
await runtime.prompt("Find the latest PTO policy and summarize it.");
```

## 安全边界

推荐的生产模型是：

- runtime 跑在浏览器里
- tools 跑在浏览器里，并直接调用宿主侧 JavaScript API
- 模型请求通过你的后端代理发出
- API key 放在服务端，而不是打进前端包里

仓库里的 demo 支持直接从浏览器调用 OpenAI-compatible endpoint 做本地验证，但这只适合本地实验和调试，不适合生产环境。

## 对外 API

当前包只保留一条 runtime-first 主路径：

- `createAgentRuntime`
- `createAiSdkLlmProvider`
- `createJsonSessionDataCodec`
- `IndexedDbAgentStorage`
- runtime、session、provider 的核心类型

同时保留少量 AI SDK 互操作辅助函数：

- `createOpenAiCompatibleLlmProvider`，用于直接对接可信的 OpenAI-compatible Chat endpoint 做本地验证
- `createAiSdkToolSet`
- `createResultStream`

## 仓库结构

- `src/runtime/`：runtime loop、事件、compaction、日志
- `src/session/`：session record、session graph 类型、codec、runtime session store
- `src/providers/`：provider 契约和 prompt/tool 抽象
- `src/llm/`：面向 AI SDK 的 provider 适配和结果流辅助函数
- `src/storage/`：IndexedDB 持久化实现
- `demo/`：用 Vite + React 写的浏览器端验证 demo
- `docs/`：接口草案和迁移说明

## Demo

仓库内提供了一个本地 demo，位于 [`demo/`](./demo/)，用来验证：

- 浏览器侧工具调用
- runtime event 流
- session 创建和持久化
- 模型输出渲染

启动方式见 [`demo/README.md`](./demo/README.md)。

## 当前状态

这个仓库现在只保留 runtime-only 浏览器 SDK。公开接口围绕 runtime、session 和 provider 契约组织，不再并行保留旧的 message-centric facade。

## License

MIT
