# 浏览器 Agent SDK V1 - 需求

> **状态**: 草稿
> **提案文档**: [proposal.md](./proposal.md)
> **最近更新**: 2026-04-09

## 概述

本需求文档定义 `web-agent-runtime` 演进为浏览器优先 Agent SDK 的功能与非功能要求。目标是得到一套可嵌入浏览器应用的 runtime API，并通过 provider 机制接入模型调用、session 存储和宿主工具系统。

当设计语义出现不确定时，应以 `pi-mono/packages/agent` 和 `pi-mono/packages/coding-agent` 的既有行为作为参考基线。

## 功能需求

### 通用需求

- **FR-001**: 系统应暴露一套浏览器优先的 runtime API，可通过 `model`、`llmProvider`、`storage` 和 `toolProvider` 创建。
- **FR-002**: 系统应定义自己的 `AgentMessage`、`AssistantStreamEvent` 和 runtime state model，不再要求 `UIMessage` 作为唯一内部消息表示。
- **FR-003**: 系统应维护一套强类型的 runtime 内部 session graph，用于表示消息条目、模型变更、thinking level 变更、compaction 条目和宿主专用数据。
- **FR-004**: 系统应将 storage 视为只负责持久化 session metadata 和 opaque session document 的 provider，而不是持久化强类型 runtime entries 的组件。
- **FR-005**: 系统应将 TDD 作为默认实现纪律，即每个新增行为先由失败测试定义，再由实现使其通过。

### 事件驱动需求

- **FR-010**: 当 runtime 被创建时，系统应初始化状态、工具注册解析以及 storage/session 集成，且不依赖特定 UI 框架。
- **FR-011**: 当调用方提交 `prompt()` 时，系统应追加新的用户消息、流式输出 assistant events、更新 runtime 状态并持久化 session data。
- **FR-012**: 当 assistant 发出 tool call 时，系统应通过配置的 `ToolProvider` 解析工具，并按配置的执行模式执行。
- **FR-013**: 当 agent 运行中调用方提交 `steer()` 时，系统应将该消息入队，并在当前 assistant turn 完成 tool execution 之后、下一次模型调用之前投递。
- **FR-014**: 当 agent 运行中调用方提交 `followUp()` 时，系统应将该消息入队，并仅在 agent 原本将要停止时投递。
- **FR-015**: 当调用方请求 `compact()` 时，系统应使用当前主模型总结较早上下文，将 compaction 结果写入 runtime session graph，并从 storage 重建 active context。
- **FR-016**: 当调用方请求 session fork 时，系统应基于指定源 session 和可选源 entry 创建新 session。
- **FR-017**: 当 runtime 保存 session data 时，系统应通过配置的 `StorageProvider` 和可选的 `SessionDataCodec` 完成持久化。
- **FR-018**: 当 runtime 语义存在歧义时，除非 SDK 规格明确覆写，否则系统应与 pi coding-agent 的语义保持一致。

### 状态驱动需求

- **FR-020**: 当 runtime 处于 streaming 状态时，系统应维护 `streamMessage`，并通过 runtime events 暴露中间更新。
- **FR-021**: 当未配置 `promptComposer` 时，系统应直接使用调用方提供的纯 `systemPrompt` 字符串。
- **FR-022**: 当配置了 `promptComposer` 时，系统应在每次相关模型调用前生成有效的 system prompt。
- **FR-023**: 当存在 storage revision 时，系统应在 runtime state 或 session 持久化流程中保留它，以便检测 stale write。
- **FR-024**: 当工具正在执行时，系统应支持 `AbortSignal` 取消和可选的 partial result update。

### 负向约束

- **FR-030**: 如果配置的 codec 无法反序列化 session data，系统不得静默覆盖已存储的数据。
- **FR-031**: 如果工具执行被中止或失败，系统不得为该 tool call 发出成功的 tool result event。
- **FR-032**: 如果 `LlmProvider` 返回无效或不完整的终止流结果，系统不得让 runtime state 永久停留在 streaming 状态。
- **FR-033**: 如果持久化写入因 `expectedRevision` 过期而被拒绝，系统不得静默丢弃该冲突。

### 可选能力

- **FR-040**: 当启用 `promptComposer` 时，系统应允许宿主根据 runtime state、model 和 tool set 计算动态 system prompt。
- **FR-041**: 当启用自定义 session codec 时，系统应允许 storage payload 与 runtime 内部 session graph 形状不同。
- **FR-042**: 当启用兼容适配层时，系统应允许将现有 AI SDK 风格集成封装到统一的 `LlmProvider` 契约之后。

## 非功能需求

### 性能

- **NFR-001**: 在典型单 session 浏览器使用场景下，系统应完成本地 runtime state 转换，而不产生可感知的 UI 阻塞。
- **NFR-002**: 除非 codec 或 storage provider 行为要求，否则系统应避免在内部 runtime 逻辑中执行整 session 重写。

### 安全性

- **NFR-010**: 系统不应要求在浏览器 runtime 代码中直接持有上游模型提供方的 API key。
- **NFR-011**: 默认情况下，系统不应通过 runtime events 或持久化 session data 暴露包含敏感信息的 provider 配置。

### 可靠性

- **NFR-020**: 系统应能在重载后基于已存储的 session data 以确定性方式重建 runtime context。
- **NFR-021**: 当 prompt 执行、tool 执行或 compaction 被中断时，系统应保持 session 一致性。

### 易用性

- **NFR-040**: 对接自定义工具和 storage provider 的应用开发者应能够理解并使用公开 SDK 接口。

### 可维护性

- **NFR-050**: 系统应采用 TDD 开发，在实现变更之前先补齐行为级测试。
- **NFR-051**: 系统应将 provider 契约与 runtime 内部 session graph 细节隔离，避免未来重构时必须破坏现有 storage 实现。

## 约束

- **C-001**: 实现必须运行在浏览器环境，不应依赖 Node-only 的 shell、filesystem 或 TUI 能力。
- **C-002**: 语义不明确时，优先参考 `pi-mono/packages/agent` 和 `pi-mono/packages/coding-agent`。
- **C-003**: 实现过程采用 TDD，新增能力需先写失败测试，再补实现。
- **C-004**: v1 的 storage provider 边界应尽量简单，不要求其理解 `AgentMessage` 或 `SessionEntry` 的细节。

## 假设

- **A-001**: 模型请求通过后端代理完成，浏览器只依赖统一的 `LlmProvider` 接口。
- **A-002**: v1 允许先按单活跃写入方来设计运行时行为，但接口会保留 revision 以支持未来并发扩展。
- **A-003**: Office.js 只是首个宿主场景，具体工具集合可在后续实现中补齐。

## 验收标准

### 核心功能

- [ ] **AC-001**: 给定一个通过 `llmProvider`、`storage` 和 `toolProvider` 创建的 runtime，当调用 `prompt()` 时，runtime 应发出 start/update/end 事件，并通过 storage 持久化更新后的 session data。
- [ ] **AC-002**: 给定一个正在运行的 agent，当调用 `steer()` 时，steering message 应在下一次模型 turn 前、且在当前 turn 完成 tool execution 后被投递。
- [ ] **AC-003**: 给定一个正在运行的 agent，当调用 `followUp()` 时，follow-up message 应仅在 agent 原本将要停止时被投递。
- [ ] **AC-004**: 给定一个已持久化 session data 的 session，当 runtime 重新加载它时，应能基于 codec 解码后的 session graph 以确定性方式重建 active context。
- [ ] **AC-005**: 给定一个包含源 session 和源 entry 的 fork 请求，当 `sessions.fork()` 成功时，应创建具有独立 session metadata 和 revision 的新 session。
- [ ] **AC-006**: 给定一个 compaction 请求，当 `compact()` 完成时，应持久化 compaction 结果，并基于压缩后的 graph 重建 runtime context。

### 边界情况

- [ ] **AC-010**: 给定过期的 `expectedRevision`，当 runtime 尝试持久化 session data 时，storage 层应拒绝写入，并将冲突暴露给调用方或 runtime。
- [ ] **AC-011**: 给定 codec 反序列化失败，当打开 session 时，runtime 应安全失败，且不得覆盖已存储的 session data。
- [ ] **AC-012**: 给定被中止的工具执行，当工具终止时，runtime 应发出错误或已中止结果，而不是成功结果。
- [ ] **AC-013**: 给定未配置 `promptComposer`，当 runtime 准备 LLM 调用时，应原样使用配置的纯 `systemPrompt`。

### 性能与过程

- [ ] **AC-020**: 核心 runtime 测试应覆盖 prompt 流程、tool 流程、steering、follow-up、fork、compaction 和 storage 持久化行为。
- [ ] **AC-021**: 每个实现切片都应先由失败测试引入，最终测试套件在 `vitest` 下通过。

## 追踪矩阵

| 需求           | 验收标准       | 测试用例                          |
| -------------- | -------------- | --------------------------------- |
| FR-001, FR-011 | AC-001         | TC-001 Runtime 创建与 prompt 流程 |
| FR-013         | AC-002         | TC-010 Steering 投递顺序          |
| FR-014         | AC-003         | TC-011 Follow-up 投递顺序         |
| FR-015, FR-017 | AC-006         | TC-020 Compaction 持久化与重建    |
| FR-016         | AC-005         | TC-030 Forked session 创建        |
| FR-030, FR-033 | AC-010, AC-011 | TC-040 Storage 冲突与 codec 失败  |
| NFR-050        | AC-021         | TC-090 TDD 任务审计               |

## 术语表

| 术语                    | 定义                                                                            |
| ----------------------- | ------------------------------------------------------------------------------- |
| Runtime Session Graph   | runtime 内部维护的强类型 session 结构，用于 fork、compaction 和 context rebuild |
| Opaque Session Document | storage provider 持久化的 session data blob，本身不要求理解运行时语义           |
| Steering                | 当前 turn 完成 tool execution 后、下一次模型调用前插入的消息                    |
| Follow-up               | agent 原本准备停止时才投递的消息                                                |
