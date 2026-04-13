# web-agent-runtime

English | [简体中文](./README.zh-CN.md)

`web-agent-runtime` is a browser-first agent runtime for products that need Claude Code-like agent behavior inside web environments.

## Why This Exists

Many people assume there is little value in building an agent runtime in the browser. For a generic public website, that is often a fair concern. But there are important cases where the browser is exactly where the capabilities live:

- Browser extensions
- Office add-ins and other embedded productivity plugins
- Internal portals and line-of-business web apps
- Customer-facing products that expose privileged or host-specific JavaScript APIs

In those environments, the agent needs to run close to the host UI state and the host APIs. The browser already has the context, the interaction surface, and the capability bridge. This project is designed for that scenario.

The runtime lets you connect browser-side tools, host-specific JavaScript APIs, and persistent session state to an agent loop, while still keeping model access behind your own backend proxy.

## What This Project Is For

Use this project when you need an interactive agent inside a web host that exposes capabilities through JavaScript APIs. Examples:

- A browser extension agent that can inspect or manipulate the current tab
- An Office add-in agent that can read and update document state through Office.js
- A company portal assistant that can call internal web APIs and operate on the current page
- A SaaS product assistant that can work with in-page UI state and product-specific tools

If your agent only needs to run on the server, this repository is probably not the right abstraction.

## Core Capabilities

- Browser-first runtime with session lifecycle management
- Session CRUD, fork, compaction, steering, and follow-up flows
- Pluggable contracts for LLM providers, storage providers, prompt composition, and tools
- IndexedDB-backed session storage for browser persistence

## Architecture

The main runtime path is centered around:

- `createAgentRuntime` for the new runtime API
- `createUnsafeOpenAiProvider` from `web-agent-runtime/unsafe-openai` as the browser-direct local-validation provider
- `IndexedDbAgentStorage` for browser-side session persistence
- `createJsonSessionDataCodec` for storing runtime session documents
- `tools[]` plus `getHostContext()` for host capability injection

At a high level, the runtime separates concerns into four layers:

- Runtime layer: agent loop, events, tool execution, compaction, session control
- Session layer: session graph, history reconstruction, codec and revision handling
- Provider layer: model streaming contracts, prompt composition, tool metadata
- Host layer: your browser app, extension, Office add-in, or portal-specific tools and APIs

## Relationship to pi-mono

This project was developed with the `pi-mono` architecture as a reference.

In particular, the layering between runtime control flow, provider contracts, session data, and host-injected tools follows the same general design direction: keep the agent core small, keep integrations explicit, and make host capabilities pluggable instead of hardcoded.

## Installation

```bash
npm install web-agent-runtime
```

For local development in this repository:

```bash
npm install
npm run build
npm test
npm run typecheck
```

## Getting Started

If you just want to boot a browser-side agent, the default local-validation path is to start with the unsafe browser-direct OpenAI-compatible provider:

```ts
import { createAgentRuntime } from "web-agent-runtime";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_API_KEY = "your-openai-api-key";

const agent = await createAgentRuntime({
  model: { id: "gpt-4.1-mini" },
  llmProvider: createUnsafeOpenAiProvider({
    apiKey: OPENAI_API_KEY,
  }),
});

await agent.prompt("Hello");
```

This path is only suitable for local experimentation and debugging. For production, implement your own `LlmProvider` and keep model access behind your backend proxy.

Only `model.id` is required. Any other model fields are passed through untouched, but the runtime no longer treats `provider` as a required field.

If you omit `storage`, the runtime uses `IndexedDbAgentStorage` by default. The database name is exported as `DEFAULT_INDEXED_DB_STORAGE_NAME`, and currently defaults to `"web-agent-runtime"`. If you need isolated storage for different products or agent instances, pass an explicit storage instance:

```ts
import {
  createAgentRuntime,
  DEFAULT_INDEXED_DB_STORAGE_NAME,
  IndexedDbAgentStorage,
} from "web-agent-runtime";
import { createUnsafeOpenAiProvider } from "web-agent-runtime/unsafe-openai";

const OPENAI_API_KEY = "your-openai-api-key";

console.log(DEFAULT_INDEXED_DB_STORAGE_NAME);

const agent = await createAgentRuntime({
  model: { id: "gpt-4.1-mini" },
  llmProvider: createUnsafeOpenAiProvider({
    apiKey: OPENAI_API_KEY,
  }),
  storage: new IndexedDbAgentStorage({
    dbName: "company-portal-agent",
  }),
});
```

If you want to route requests through your own backend, implement `LlmProvider` in your app and call your proxy from there:

```ts
import { createAgentRuntime, type LlmProvider } from "web-agent-runtime";

declare const llmProvider: LlmProvider;

const agent = await createAgentRuntime({
  model: { id: "claude-sonnet-4-5" },
  llmProvider,
});
```

## Minimal Example

```ts
import {
  createAgentRuntime,
  createJsonSessionDataCodec,
  IndexedDbAgentStorage,
  type LlmProvider,
  type RuntimeSessionData,
  type ToolDefinition,
} from "web-agent-runtime";

const OPENAI_API_KEY = "your-openai-api-key";
declare const llmProvider: LlmProvider;

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
  model: { id: "gpt-4.1-mini" },
  llmProvider,
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

## Built-in Demo Tools

For quick browser demos, the package also ships `createLocalStorageTools()`, which exposes `local_storage_read`, `local_storage_create`, `local_storage_update`, and `local_storage_delete`.

```ts
import { createAgentRuntime, createLocalStorageTools } from "web-agent-runtime";

const runtime = await createAgentRuntime({
  // ...other runtime options
  tools: createLocalStorageTools({
    keyPrefix: "demo:",
  }),
});
```

## Security Model

The intended production model is:

- The runtime executes in the browser
- Tools run in the browser and can use host-specific JavaScript APIs
- Model requests go through your backend proxy
- API keys stay on the server, not in the frontend bundle

The included demo can call an OpenAI-compatible endpoint directly from the browser for local validation through `createUnsafeOpenAiProvider()`. That is only appropriate for local experiments, not production deployments.

## Public API

The root entry exposes the runtime-first core surface:

- `createAgentRuntime`
- `DEFAULT_INDEXED_DB_STORAGE_NAME`
- `createJsonSessionDataCodec`
- `createLocalStorageTools` for simple browser-side localStorage CRUD demos
- `IndexedDbAgentStorage`
- runtime, session, and provider core types

Optional LLM integrations are isolated behind subpath exports:

- `web-agent-runtime/unsafe-openai`: `createUnsafeOpenAiProvider`
- `web-agent-runtime/provider-utils`: `createResultStream`

## Repository Layout

- `src/runtime/`: runtime loop, events, compaction, logging
- `src/session/`: session records, session graph types, codec, runtime session store
- `src/providers/`: provider contracts and prompt/tool abstractions
- `src/llm/`: provider adapters and result-stream helpers
- `src/storage/`: IndexedDB persistence implementation
- `src/tools/`: optional built-in browser demo tools
- `demo/`: Vite + React demo for validating browser-side runtime behavior
- `docs/`: interface draft and migration notes

## Demo

There is a local demo in [`demo/`](./demo/) that validates:

- browser-side tool execution
- runtime event streaming
- session creation and persistence
- model output rendering

See [`demo/README.md`](./demo/README.md) for setup details.

## Status

This repository ships a runtime-only browser SDK. The public surface is centered on runtime, session, and provider contracts, with no legacy message-centric facade kept in parallel.

## License

MIT
