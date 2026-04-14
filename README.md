# web-agent-runtime

English | [简体中文](./README.zh-CN.md)

`web-agent-runtime` is an agent runtime for browser host environments, designed for building interactive client-side agent behavior in web products, similar to Claude Code.

## Why This Exists

Many people assume there is little value in building a Claude Code-like client-side agent for the web. For generic public websites, that is often a fair judgment. But in some scenarios, the browser is exactly the right place to run the agent, because that is where the capabilities are exposed. For example:

- Browser extensions
- Office add-ins and other embedded productivity plugins
- Internal portals, business back offices, and SaaS consoles
- Product interfaces that expose host-specific JavaScript APIs

This project is designed for those kinds of web host environments. When you need to provide an interactive agent that can directly access current page state, host context, and browser-side capabilities, this runtime is a suitable foundation. For example:

- Read or manipulate the current tab
- Read and modify document state through Office.js
- Call internal web APIs together with current page context
- Complete tasks using page state and product-specific tools

Its goal is to connect browser-side tools, host-exposed JavaScript APIs, and persistent session state into an agent loop, while keeping model access behind your own backend proxy. If your agent only needs to run on the server, this repository is probably not the right abstraction layer.

## Core Capabilities

- 🌐 A pure JavaScript agent runtime for browser environments, with core agent loop, event system, and session management capabilities
- 📦 Zero runtime dependencies in the core package
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

This repository includes a local demo in [`packages/demo/`](./packages/demo/) for validating:

- Browser-side tool calls
- Runtime event streaming
- Session creation and persistence
- Model output rendering

See [`packages/demo/README.md`](./packages/demo/README.md) for startup instructions.

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
