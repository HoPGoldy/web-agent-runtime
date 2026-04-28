# web-agent-runtime

[![npm version](https://img.shields.io/npm/v/web-agent-runtime)](https://www.npmjs.com/package/web-agent-runtime)
[![npm downloads](https://img.shields.io/npm/dm/web-agent-runtime)](https://www.npmjs.com/package/web-agent-runtime)
[![Publish to npm](https://github.com/HoPGoldy/web-agent-runtime/actions/workflows/publish.yml/badge.svg)](https://github.com/HoPGoldy/web-agent-runtime/actions/workflows/publish.yml)

English | [简体中文](./README.zh-CN.md)

`web-agent-runtime` is an agent runtime for browser host environments, designed for building interactive client-side agent behavior in web products, similar to Claude Code.

## Who This Project Is Designed For

If you need to complete any of the following, this project is designed for you:

- Implement an interactive agent in a browser environment
- Develop a browser extension of the agent type
- Develop plugins for specific ecosystems (e.g., Office)
- Integrate an intelligent assistant into an internal web system
- Want the agent assistant to access current page state and operate JS APIs

At its core, this project implements a pure JavaScript agent runtime framework and provides built-in features (such as session management and context operations), so you can focus on agent behavior design and tool integration without building the entire agent loop from scratch.

## Core Capabilities

- 🌐 A pure JavaScript agent runtime for browser environments, with core agent loop, event system, and session management capabilities
- 📦 Zero runtime dependencies in the core package
- 🖼️ UI-agnostic and framework-agnostic: use it in any frontend framework or directly with vanilla JavaScript
- 💾 Built-in session CRUD, backed by IndexedDB for browser-side persistence
- 🧭 Full context operations: prompt, continue, followUp, steer, fork, compaction, abort
- 🧩 Fully customizable model access, storage, and tool definitions through standard interfaces

## Installation

```bash
npm install web-agent-runtime
```

## Getting Started

You can use the built-in OpenAI-compatible provider to bootstrap a basic agent runtime:

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

> Do not use `createUnsafeOpenAiProvider` in production to access an LLM, because it exposes your API key directly in the frontend. In production, your own backend should provide the LLM interface, and the frontend should implement an `LlmProvider`-compatible `llmProvider` to integrate with it.

That is enough to get a fully functional agent. You can bind its state to your UI through subscription events, then start a request with `prompt`:

```ts
const unsubscribe = agent.subscribe((event) => {
  console.log("assistant message:", event);
});

await agent.prompt("Write demo:greeting=hello into localStorage");

unsubscribe();
await agent.destroy();
```

You can also use the built-in session management to create, update, and fork sessions:

```ts
const session = await agent.sessions.create({
  title: "Quick Start Demo",
});

await agent.prompt("Write demo:greeting=hello into localStorage");

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

In addition, `web-agent-runtime` includes full support for core agent operations such as:

- `agent.prompt()`: send a new user input turn
- `agent.continue()`: continue generation on the existing context without appending a new user message
- `agent.followUp()`: append the next follow-up message after the current turn completes
- `agent.steer()`: insert a steering message during execution to try to redirect the current process
- `agent.compact()`: compact historical context to reduce later request cost
- `agent.abort()`: abort the active run session

## Demo

This repository includes a local demo in [`packages/demo/`](https://github.com/HoPGoldy/web-agent-runtime/tree/main/packages/demo) for validating:

- Browser-side tool calls
- Runtime event streaming
- Session creation and persistence
- Model output rendering

See [`packages/demo/README.md`](https://github.com/HoPGoldy/web-agent-runtime/tree/main/packages/demo/README.md) for startup instructions.

## Multi-Session Concurrency

`web-agent-runtime` supports running multiple sessions at the same time.

- Recommended pattern: create one runtime instance per active chat tab/window, and open one session in each runtime.
- Different `sessionId` values can run concurrently without interfering with each other.
- For the same `sessionId`, use a single-writer pattern (only one runtime instance sends writes) to avoid revision conflicts.

Example:

```ts
const runtimeA = await createAgentRuntime(options);
const runtimeB = await createAgentRuntime(options);

await runtimeA.sessions.open("session-a");
await runtimeB.sessions.open("session-b");

await Promise.all([
  runtimeA.prompt("Continue task A"),
  runtimeB.prompt("Continue task B"),
]);
```

## Local Development

If you are developing inside this repository:

```bash
pnpm install
pnpm build
pnpm --filter web-agent-runtime test
pnpm typecheck
```

## Acknowledgements

This project was designed with reference to the `pi-mono` project. Thanks to the `pi-mono` team for their open source work and the ideas it provided.

## License

MIT
