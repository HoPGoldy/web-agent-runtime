# web-agent-runtime demo

一个基于 Vite + React + TypeScript 的本地 demo，用来演示 `@oneai/web-agent` 新 runtime SDK：

- OpenAI-compatible LLM provider
- textarea CRUD tools
- 运行时 event 面板
- 模型最终输出面板

## 启动

1. 在仓库根目录安装 SDK 依赖：
   `npm install`
2. 进入 demo 安装前端依赖：
   `cd demo && npm install`
3. 复制环境变量文件：
   `cp .env.example .env.local`
4. 填入 `VITE_OPENAI_API_KEY`
5. 如果你用的是 OpenAI-compatible 服务而不是官方 OpenAI，再填：
   `VITE_OPENAI_BASE_URL`
6. 按需设置模型名：
   `VITE_OPENAI_MODEL`
7. 启动：
   `npm run dev`

## DashScope 示例

如果你使用阿里云 DashScope 的 OpenAI-compatible 端点，可以这样配置 `.env.local`：

```dotenv
VITE_OPENAI_API_KEY=your-local-demo-key
VITE_OPENAI_MODEL=qwen3-max
VITE_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

`VITE_OPENAI_BASE_URL` 可以填根 `baseURL`。demo 会自动补成 `/chat/completions`，也兼容你直接传完整 endpoint。

## 安全说明

这个 demo 会把 `VITE_OPENAI_API_KEY` 注入浏览器，并直接从前端向 OpenAI-compatible 端点发请求。

这只适用于本地 demo 或临时调试。生产环境必须把 key 放到后端，并由后端代理模型调用。
