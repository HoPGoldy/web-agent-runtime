# web-agent-runtime demo

一个基于 Vite + React + TypeScript 的本地 demo，用来演示 `web-agent-runtime` 新 runtime SDK：

- `createUnsafeOpenAiProvider`
- textarea CRUD tools
- localStorage chat tools
- 运行时 event 面板
- 模型最终输出面板

## 启动

1. 在仓库根目录安装 workspace 依赖：
   `pnpm install`
2. 进入 demo package：
   `cd packages/demo`
3. 复制环境变量文件：
   `cp .env.example .env.local`
4. 填入 `VITE_OPENAI_API_KEY`
5. 如果你用的是 OpenAI-compatible 服务而不是官方 OpenAI，再填：
   `VITE_OPENAI_BASE_URL`
6. 按需设置模型名：
   `VITE_OPENAI_MODEL`
7. 从仓库根目录启动：
   `pnpm --filter web-agent-runtime-demo dev`

默认页面：

- `http://localhost:4179/`：最小化 chat bot demo，agent 通过内置 localStorage tools 读写浏览器数据
- `http://localhost:4179/local-storage-chat.html`：旧的 localStorage chat demo

## Minimal chat demo

根页面是一个纯净的聊天式 web app，不再演示 textarea 或 Outlook 场景，只证明一件事：

- `web-agent-runtime` 可以在浏览器里驱动一个标准聊天 UI
- agent 可以通过内置 `createLocalStorageTools()` 读写宿主状态
- 对话、会话和工具结果都由 runtime 持续管理

你可以直接输入类似下面的指令：

- `把 profile 保存成 JSON，name 是 Wesley，city 是 Shanghai。`
- `读取当前所有 key，并告诉我有哪些数据。`
- `把 tasks 改成数组 ["ship demo", "write docs"]。`
- `删除 note，如果不存在就告诉我。`

## DashScope 示例

如果你使用阿里云 DashScope 的 OpenAI-compatible 端点，可以这样配置 `.env.local`：

```dotenv
VITE_OPENAI_API_KEY=your-local-demo-key
VITE_OPENAI_MODEL=qwen3-max
VITE_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

`VITE_OPENAI_BASE_URL` 可以填根 `baseURL`。demo 会自动补成 `/chat/completions`，也兼容你直接传完整 endpoint。

## 安全说明

这个 demo 会把 `VITE_OPENAI_API_KEY` 注入浏览器，并通过 `createUnsafeOpenAiProvider()` 直接从前端向 OpenAI-compatible 端点发请求。

这只适用于本地 demo 或临时调试。生产环境必须把 key 放到后端，并由后端代理模型调用。
