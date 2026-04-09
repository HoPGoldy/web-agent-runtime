# 浏览器 Agent SDK 迁移计划

## 目标

将当前以 `Agent + RuntimeChat + UIMessage` 为中心的浏览器实现，迁移到以 `AgentRuntime + LLM/storage contracts + runtime session graph` 为中心的 SDK 结构，同时保留旧 API 作为过渡适配层。

## 当前状态

已经落地的部分：

- 新 runtime 主链路：`createAgentRuntime`
- 新 session graph 与 codec：`RuntimeSessionData`、`createJsonSessionDataCodec`
- 新 LLM provider 适配入口：`createAiSdkLlmProvider`
- 新 storage 语义：`StorageProvider` + opaque session document + revision
- 新能力语义：steering、follow-up、fork、manual compaction
- 旧 `Agent` 仍可继续使用，并已兼容新的 session record 语义

## 新旧结构映射

### 保留

- `Agent`
  - 作为 legacy façade 保留，避免现有浏览器调用方立刻断裂
- `createAiSdkLlmCaller`
  - 继续服务旧 `RuntimeChat` 路径
- `IndexedDbAgentStorage`
  - 同时支持 legacy `loadMessages/saveMessages` 和新 `loadSessionData/saveSessionData`
- tool factories
  - 继续作为宿主快速接入工具的基础设施

### 新增主路径

- `createAgentRuntime`
  - 新浏览器 agent SDK 主入口
- `createAiSdkLlmProvider`
  - 面向新 runtime 的 AI SDK 兼容 provider
- `createJsonSessionDataCodec`
  - 默认 runtime session document codec
- `runtime` / `session` / `providers` 类型导出
  - 作为宿主集成和自定义 provider 的稳定边界

### 后续逐步收敛

- `Agent`
  - 后续应逐步收敛为基于 `AgentRuntime` 的兼容适配层，而不是继续扩张功能
- `RuntimeChat`
  - 不再作为新能力的承载面，只维持 legacy 路径
- 直接依赖 `UIMessage` 的扩展点
  - 新能力不再围绕它设计，未来仅保留兼容用途

## 建议迁移顺序

### 1. 新宿主直接走新 runtime

适用于 Office.js 等新宿主：

- 使用 `createAgentRuntime`
- 使用 `createAiSdkLlmProvider`
- 使用 `IndexedDbAgentStorage` + `createJsonSessionDataCodec`
- 通过 `tools[]` 和 `getHostContext` 注入宿主能力

### 2. 老宿主维持 `Agent`，不立即重写

适用于已经绑定 `UIMessage` 或 `RuntimeChat` 的页面：

- 继续使用旧 `Agent`
- 不再给旧接口增加新的 session/fork/compaction 需求
- 新需求优先在 `AgentRuntime` 路径实现

### 3. 宿主层逐步转向清晰边界

从“直接拼接 transport 和消息快照”迁移到：

- `llmProvider`
- `storage`
- `tools`
- 可选的 `promptComposer`

这样宿主边界更清晰，也更接近 pi mono 目前对外的 `tools[]` 习惯用法。

## 删除与冻结策略

短期内不删除：

- `Agent`
- `RuntimeChat`
- `LlmCallInterface`
- legacy tool factories

短期内冻结，不再扩展：

- 直接基于 `UIMessage` 的新能力设计
- 只保存 `messages[]` 快照的 session 能力假设

中期候选清理项：

- 仅服务旧路径、且新 runtime 已完全覆盖的包装逻辑
- 与 provider 契约重复的 legacy transport glue

## 测试策略

本次迁移采用 TDD 切片推进，后续保持同样策略：

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
- full suite validation
  - 每次阶段收尾执行 `npm test`
  - 类型边界变化同步执行 `npm run typecheck`

## 宿主接入建议

Office.js 首版建议：

- 由 host context 暴露 `Office` 对象和文档选择态
- 工具先直接通过 `tools[]` 传入，复杂场景再评估是否需要回引入 registry 层
- 前端只持有 session id 和 runtime state，不直接拼接 LLM payload
- 后端代理统一负责模型协议转换

## 已知未决项

- 自动 compaction 是否进入后续小版本，而不是继续停留在 manual-only
- 旧 `Agent` 何时彻底切到基于 `AgentRuntime` 的内部实现
- 多标签页并发冲突是否只做 provider 级拒绝，还是补一层宿主 UX

## 推荐落地方式

对新代码：直接依赖根入口的新 runtime API。

对存量代码：先保持旧 `Agent` 路径稳定，新增能力只在新 runtime 上实现，等宿主逐步迁移完成后再收敛 legacy façade。
