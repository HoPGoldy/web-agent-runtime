# 浏览器 Agent SDK 收敛说明

## 目标

项目尚未上线，因此直接收敛为 runtime-only SDK，不再保留任何面向旧消息模型的过渡兼容层。

## 已移除的兼容内容

- `Agent`
- `RuntimeChat`
- `createAiSdkLlmCaller`
- `LlmCallInterface`
- `StorageInterface`
- `IndexedDbAgentStorage` 上的 `loadMessages()` / `saveMessages()`
- 只服务旧路径的 tool interfaces、tool factories 和 `LocalStorageFileStore`
- 过渡期 namespace 导出：`runtimeContracts`、`sessionContracts`、`providerContracts`

## 当前主结构

对外只保留以下 runtime-first 入口：

- `createAgentRuntime`
- `createJsonSessionDataCodec`
- `IndexedDbAgentStorage`
- runtime、session、provider 的核心类型导出

额外保留的辅助函数只服务当前主路径：

- `createUnsafeOpenAiProvider`

## 存储语义

`IndexedDbAgentStorage` 现在只负责两类数据：

- session metadata
- opaque session document

也就是说，浏览器端存储不再维护旧的 `messages` object store，不再暴露基于 `messages[]` 快照的读写接口。

## 宿主接入方式

新宿主统一按下面的边界接入：

- `llmProvider`
- `storage`
- `tools`
- 可选的 `promptComposer`

宿主只持有 session id、runtime state 和自己的 host context，不直接拼接旧 chat transport 或 UIMessage payload。

## 测试基线

收敛后继续以 runtime 主链路为测试中心：

- contract tests
  - `session-data-codec.test.ts`
  - `storage-provider-contract.test.ts`
  - `llm-provider-contract.test.ts`
- runtime behavior tests
  - `agent-loop.test.ts`
  - `agent-runtime.test.ts`
  - `fork-session.test.ts`
  - `compaction.test.ts`
- regression tests
  - `agent-runtime-errors.test.ts`
  - 覆盖 revision conflict、codec failure、tool abort、非法 continue

## 后续重点

- 继续完善 Office.js 等真实宿主集成
- 评估自动 compaction 是否进入后续版本
- 视需要补充多标签页并发冲突的宿主侧 UX
