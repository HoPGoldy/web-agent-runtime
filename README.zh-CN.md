# web-agent-runtime

[English](./README.md) | 简体中文

`web-agent-runtime` 是一个面向浏览器宿主环境的 agent runtime，适合在 Web 场景里实现类似 Claude Code 的交互式客户端 agent 行为。

## 为什么会有这个项目

很多人会觉得，在 Web 里做一个类似 Claude Code 的客户端 agent 没什么意义。对于普通公开网站，这个判断很多时候并不算错；但在一些特殊场景里，浏览器本身就是最合适的 agent 运行位置，因为能力就暴露在这里。例如：

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

- 🌐 面向浏览器开发的纯 js agent runtime：提供了 agent loop、事件系统、session 管理等核心功能
- 📦 核心包零运行时依赖
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
import { createAgentRuntime, createLocalStorageTools } from "web-agent-runtime";
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

仓库内提供了一个本地 demo，位于 [`demo/`](./demo/)，用来验证：

- 浏览器侧工具调用
- runtime event 流
- session 创建和持久化
- 模型输出渲染

启动方式见 [`demo/README.md`](./demo/README.md)。

## 本地开发

如果你是在当前仓库里本地开发：

```bash
npm install
npm run build
npm test
npm run typecheck
```

## 感谢

这个项目在设计时参考了 `pi-mono` 项目的设计。感谢 `pi-mono` 团队的开源贡献，提供了宝贵的参考和启发。

## License

MIT
