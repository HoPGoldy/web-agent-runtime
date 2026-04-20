# web-agent-runtime

[![npm version](https://img.shields.io/npm/v/web-agent-runtime)](https://www.npmjs.com/package/web-agent-runtime)
[![npm downloads](https://img.shields.io/npm/dm/web-agent-runtime)](https://www.npmjs.com/package/web-agent-runtime)
[![Publish to npm](https://github.com/HoPGoldy/web-agent-runtime/actions/workflows/publish.yml/badge.svg)](https://github.com/HoPGoldy/web-agent-runtime/actions/workflows/publish.yml)

[English](./README.md) | 简体中文

`web-agent-runtime` 是一个面向浏览器宿主环境的 agent runtime，适合在 Web 场景里实现类似 Claude Code 的交互式客户端 agent 行为。

## 本项目是给谁设计的

如果你需要完成如下任务，那么本项目就是为你设计的：

- 在浏览器环境里实现一个交互式 agent
- 开发一个 agent 类型的浏览器插件
- 为指定生态开发插件（如 office）
- 在公司内部 web 系统中集成智能助手
- 希望 agent 助手可以访问当前页面状态和操作 JS API

从本质上来讲，这个项目实现了一个纯 js 的 agent 运行框架，并提供了一些内置功能（如 session 管理、上下文操作等），让你可以专注于 agent 行为设计和工具集成，而不需要从零搭建整个 agent loop。

## 核心能力

- 🌐 面向浏览器开发的纯 js agent runtime：提供了 agent loop、事件系统、session 管理等核心功能
- 📦 核心包零运行时依赖
- 🖼️ UI 无关，框架无关：你可以在任何前端框架里使用它，也可以直接用原生 js
- 💾 内置 session 增删改查：基于 IndexedDB 的浏览器端 session 持久化
- 🧭 完备的上下文操作：prompt、continue、followUp、steer、fork、compaction、abort
- 🧩 完全可定制：模型调用、数据存储、工具定义均通过标准的 interface 实现。

## 安装

```bash
npm install web-agent-runtime
```

## 开始使用

你可以使用内置的 openai 兼容的 provider 来构建基础的 agent runtime：

```ts
import { createAgentRuntime } from "web-agent-runtime";
import { createLocalStorageTools } from "web-agent-runtime/local-storage";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_API_KEY = "srk-xxx";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODEL_ID = "gpt-4.1-mini";

const agent = await createAgentRuntime({
  model: { id: OPENAI_MODEL_ID },
  llmProvider: createUnsafeOpenAiProvider({
    apiKey: OPENAI_API_KEY,
    baseUrl: OPENAI_BASE_URL,
  }),
  tools: createLocalStorageTools(),
});
```

> 注意，不要在生产环境使用 `createUnsafeOpenAiProvider` 访问 llm，这会直接在前端暴露你的 api key。由自己的后端服务提供 llm 接口。并在前端实现 `LlmProvider` 类型的 llmProvider 来实现接入。

完成！现在你已经获得了一个功能完备的 agent，你可以通过它的订阅事件把状态绑定到 UI。并使用 `prompt` 发起请求：

```ts
const unsubscribe = agent.subscribe((event) => {
  console.log("assistant message:", event);
});

await agent.prompt("往 localStorage 里写入 demo:greeting=hello");

unsubscribe();
await agent.destroy();
```

你还可以使用内置的 session 管理功能来创建、更新、分叉会话：

```ts
const session = await agent.sessions.create({
  title: "Quick Start Demo",
});

await agent.prompt("在 localStorage 里写入 demo:greeting=hello");

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
```

除此之外，web-agent-runtime 还提供了完备的上下文操作，例如：

- `agent.prompt()`：发送一轮新的用户输入
- `agent.continue()`：在已有上下文上继续生成，不追加新的用户消息
- `agent.followUp()`：在当前轮结束后追加下一条跟进消息
- `agent.steer()`：在运行中插入 steering 消息，尝试重定向当前过程
- `agent.compact()`：压缩历史上下文，减少后续请求负担
- `agent.abort()`：中止当前运行会话

## Demo

仓库内提供了一个本地 demo，位于 [`packages/demo/`](https://github.com/HoPGoldy/web-agent-runtime/tree/main/packages/demo)，用来验证：

- 浏览器侧工具调用
- runtime event 流
- session 创建和持久化
- 模型输出渲染

启动方式见 [`packages/demo/README.md`](https://github.com/HoPGoldy/web-agent-runtime/tree/main/packages/demo/README.md)。

## 本地开发

如果你是在当前仓库里本地开发：

```bash
pnpm install
pnpm build
pnpm --filter web-agent-runtime test
pnpm typecheck
```

## 感谢

这个项目在设计时参考了 `pi-mono` 项目的设计。感谢 `pi-mono` 团队的开源贡献，提供了宝贵的参考和启发。

## License

MIT
