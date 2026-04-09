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
- AI SDK-compatible HTTP adapter for connecting browser runtime requests to your backend

## Architecture

The main runtime path is centered around:

- `createAgentRuntime` for the new runtime API
- `createAiSdkLlmProvider` for backend-connected model access
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

## Minimal Example

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

## Security Model

The intended production model is:

- The runtime executes in the browser
- Tools run in the browser and can use host-specific JavaScript APIs
- Model requests go through your backend proxy
- API keys stay on the server, not in the frontend bundle

The included demo can call an OpenAI-compatible endpoint directly from the browser for local validation. That is only appropriate for local experiments, not production deployments.

## Public API

The package exposes a single runtime-first surface:

- `createAgentRuntime`
- `createAiSdkLlmProvider`
- `createJsonSessionDataCodec`
- `IndexedDbAgentStorage`
- runtime, session, and provider core types

Optional helpers remain available for AI SDK interop and stream testing:

- `createAiSdkToolSet`
- `createResultStream`

## Repository Layout

- `src/runtime/`: runtime loop, events, compaction, logging
- `src/session/`: session records, session graph types, codec, runtime session store
- `src/providers/`: provider contracts and prompt/tool abstractions
- `src/llm/`: AI SDK-oriented provider adapters and result-stream helpers
- `src/storage/`: IndexedDB persistence implementation
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
