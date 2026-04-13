# web-agent-runtime

[English](./README.md) | 简体中文

`web-agent-runtime` 是一个面向浏览器宿主环境的 agent runtime，适合在 Web 场景里实现类似 Claude Code 的交互式 agent 行为。

## 为什么会有这个项目

很多人会觉得，在 Web 里做一个类似 Claude Code 的 agent runtime 没什么意义。对于普通公开网站，这个判断很多时候并不算错；但在一些特殊场景里，浏览器本身就是最合适的运行位置，因为能力就暴露在这里。

典型场景包括：

- 浏览器插件
- Office 插件和其他嵌入式生产力插件
- 公司内部门户、业务后台、SaaS 控制台
- 暴露了宿主专有 JavaScript API 的产品界面

这个项目就是为这类 Web 宿主环境设计的。当你需要提供一个可交互的 agent，并且让它直接接触当前页面状态、宿主上下文和浏览器侧能力时，可以使用这个 runtime，例如：

- 读取或操作当前标签页
- 通过 Office.js 读取和修改文档状态
- 调用内部 Web API，并结合当前页面上下文工作
- 使用页面状态和业务专属工具完成任务

它的目标是把浏览器侧 tools、宿主暴露的 JavaScript API，以及可持久化的 session 状态接到一个 agent loop 里，同时把模型访问放在你自己的后端代理之后。如果你的 agent 只需要运行在服务端，这个仓库大概率不是最合适的抽象层。

## 核心能力

- 面向浏览器的 runtime 主链路
- session CRUD、fork、compaction、steering、follow-up
- 可插拔的 LLM provider、storage provider、prompt composer 和 tools 契约
- 基于 IndexedDB 的浏览器端 session 持久化
- AI SDK 兼容的 HTTP 适配层，方便把浏览器请求接到你的后端

## 架构概览

当前推荐的主路径围绕以下对象展开：

- `createAgentRuntime` 作为新 runtime 入口
- `createOpenAiCompatibleLlmProvider`，从 `web-agent-runtime/openai-compatible` 导入，作为最快的本地验证 provider
- `createAiSdkLlmProvider`，从 `web-agent-runtime/ai-sdk` 导入，作为对接后端模型访问的 provider
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

## 开始使用

如果你只是想先把一个浏览器侧 agent 跑起来，默认可以先用 OpenAI-compatible provider 做本地验证：

```ts
import { createAgentRuntime } from "web-agent-runtime";
import { createOpenAiCompatibleLlmProvider } from "web-agent-runtime/openai-compatible";

const OPENAI_API_KEY = "your-openai-api-key";

const agent = await createAgentRuntime({
  model: {
    provider: "openai",
    id: "gpt-4.1-mini",
  },
  llmProvider: createOpenAiCompatibleLlmProvider({
    apiKey: OPENAI_API_KEY,
  }),
});

await agent.prompt("Hello");
```

这条路径只适合本地实验和调试，不适合生产环境。生产环境里，仍然建议用 `createAiSdkLlmProvider()` 把模型请求收敛到你自己的后端代理。

如果你不传 `storage`，runtime 默认会使用 `IndexedDbAgentStorage`，数据库名由 `DEFAULT_INDEXED_DB_STORAGE_NAME` 常量给出，当前默认值是 `"web-agent-runtime"`。如果你需要隔离不同业务或不同 agent 实例，可以显式传入自定义 storage：

```ts
import {
  createAgentRuntime,
  DEFAULT_INDEXED_DB_STORAGE_NAME,
  IndexedDbAgentStorage,
} from "web-agent-runtime";
import { createOpenAiCompatibleLlmProvider } from "web-agent-runtime/openai-compatible";

const OPENAI_API_KEY = "your-openai-api-key";

console.log(DEFAULT_INDEXED_DB_STORAGE_NAME);

const agent = await createAgentRuntime({
  model: {
    provider: "openai",
    id: "gpt-4.1-mini",
  },
  llmProvider: createOpenAiCompatibleLlmProvider({
    apiKey: OPENAI_API_KEY,
  }),
  storage: new IndexedDbAgentStorage({
    dbName: "company-portal-agent",
  }),
});
```

如果你要接自己的后端代理，可以把 provider 换成 `createAiSdkLlmProvider()`：

```ts
import { createAgentRuntime } from "web-agent-runtime";
import { createAiSdkLlmProvider } from "web-agent-runtime/ai-sdk";

const agent = await createAgentRuntime({
  model: {
    provider: "company-proxy",
    id: "claude-sonnet-4-5",
  },
  llmProvider: createAiSdkLlmProvider({
    api: "/api/agent",
  }),
});
```

实例化完成后，最常用的是发起 prompt、管理 session，以及订阅 runtime 事件：

```ts
const unsubscribe = agent.subscribe((event) => {
  if (event.type === "message_end") {
    console.log("assistant message:", event.message);
  }
});

const session = await agent.sessions.create({
  title: "Quick Start Demo",
});

await agent.prompt("在 localStorage 里写入 demo:greeting=hello");
await agent.followUp("读取刚才写入的值，并说明你做了什么");

await agent.sessions.update(session.id, {
  title: "Quick Start Demo Updated",
});

const sessions = await agent.sessions.list();
console.log("all sessions:", sessions);

const forked = await agent.sessions.fork({
  sourceSessionId: session.id,
  title: "Quick Start Branch",
});

await agent.sessions.open(forked.session.id);
await agent.compact();

unsubscribe();
await agent.destroy();
```

几个常用 API 的用途如下：

- `agent.prompt()`：发送一轮新的用户输入
- `agent.continue()`：在已有上下文上继续生成，不追加新的用户消息
- `agent.followUp()`：在当前轮结束后追加下一条跟进消息
- `agent.steer()`：在运行中插入 steering 消息，尝试重定向当前过程
- `agent.sessions.create()` / `open()` / `list()` / `update()` / `delete()` / `fork()`：管理会话及分支
- `agent.subscribe()`：监听 runtime 事件流，例如消息结束、工具执行、session 切换
- `agent.compact()`：压缩历史上下文，减少后续请求负担
- `agent.setModel()` / `setThinkingLevel()` / `setSystemPrompt()`：动态调整运行参数
- `agent.abort()` / `destroy()`：中止当前运行或销毁 runtime

## 最小示例

```ts
import {
  createAgentRuntime,
  createJsonSessionDataCodec,
  IndexedDbAgentStorage,
  type RuntimeSessionData,
  type ToolDefinition,
} from "web-agent-runtime";
import { createOpenAiCompatibleLlmProvider } from "web-agent-runtime/openai-compatible";

const OPENAI_API_KEY = "your-openai-api-key";

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
    provider: "openai",
    id: "gpt-4.1-mini",
  },
  llmProvider: createOpenAiCompatibleLlmProvider({
    apiKey: OPENAI_API_KEY,
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

## 内置 Demo Tools

为了快速做浏览器侧验证，包里也内置了 `createLocalStorageTools()`，会直接提供 `local_storage_read`、`local_storage_create`、`local_storage_update` 和 `local_storage_delete` 这四个 localStorage CRUD 工具。

```ts
import { createAgentRuntime, createLocalStorageTools } from "web-agent-runtime";

const runtime = await createAgentRuntime({
  // ...其他 runtime 选项
  tools: createLocalStorageTools({
    keyPrefix: "demo:",
  }),
});
```

## 安全边界

推荐的生产模型是：

- runtime 跑在浏览器里
- tools 跑在浏览器里，并直接调用宿主侧 JavaScript API
- 模型请求通过你的后端代理发出
- API key 放在服务端，而不是打进前端包里

仓库里的 demo 支持直接从浏览器调用 OpenAI-compatible endpoint 做本地验证，但这只适合本地实验和调试，不适合生产环境。

## 对外 API

根入口只保留 runtime-first 核心路径：

- `createAgentRuntime`
- `DEFAULT_INDEXED_DB_STORAGE_NAME`
- `createJsonSessionDataCodec`
- `createLocalStorageTools`，用于简单的浏览器侧 localStorage CRUD demo
- `IndexedDbAgentStorage`
- runtime、session、provider 的核心类型

可选 LLM 集成通过子入口单独暴露：

- `web-agent-runtime/openai-compatible`：`createOpenAiCompatibleLlmProvider`
- `web-agent-runtime/ai-sdk`：`createAiSdkLlmProvider`、`createAiSdkToolSet`
- `web-agent-runtime/provider-utils`：`createResultStream`

## 仓库结构

- `src/runtime/`：runtime loop、事件、compaction、日志
- `src/session/`：session record、session graph 类型、codec、runtime session store
- `src/providers/`：provider 契约和 prompt/tool 抽象
- `src/llm/`：面向 AI SDK 的 provider 适配和结果流辅助函数
- `src/storage/`：IndexedDB 持久化实现
- `src/tools/`：可选的内置浏览器 demo tools
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
