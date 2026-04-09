# 浏览器 Agent SDK V1 - 提案

> **状态**: 草稿
> **作者**: GitHub Copilot
> **创建日期**: 2026-04-09
> **最近更新**: 2026-04-09

## 背景

当前 `web-agent-runtime` 已经具备基础的 agent、tool、storage 和 LLM 调用封装，但整体设计仍然偏向“基于 chat SDK 的 Web demo runtime”，还不是一个真正可嵌入的浏览器 Agent SDK。

现状的主要问题包括：

- 核心消息模型直接绑定 `UIMessage`，UI 语义和 agent 语义混杂
- LLM 边界依赖特定 chat transport，而不是统一的流式 assistant event
- storage 以消息快照为中心，不适合 fork、compaction、branch 恢复
- runtime、session、tool 执行、持久化边界耦合较重

目标是把该包演进为一个浏览器优先的 Agent SDK，使开发者可以在浏览器中运行类似 pi coding-agent 的 agent runtime，并通过 provider 接口接入：

- LLM provider
- storage provider
- tool provider

这个 SDK 的首个直接应用场景是 Office 插件环境，但设计不应绑定 Office.js 本身，而应保持宿主无关。

在行为定义存在不确定性的地方，以 `pi-mono/packages/agent` 和 `pi-mono/packages/coding-agent` 为参考实现，优先复用其已验证的语义。

## 目标

- [ ] Goal 1: 将 `web-agent-runtime` 演进为浏览器优先、provider-based 的 Agent SDK。
- [ ] Goal 2: 在 v1 中支持 session CRUD、session fork、compaction、steering、follow-up 和 tool execution。
- [ ] Goal 3: 将 storage 边界收敛为“session metadata + opaque session document”，由 runtime 自身解释 session graph。
- [ ] Goal 4: 以 TDD 方式推进实现，优先通过测试锁定行为，再进行重构和迁移。

## 非目标

- 在 v1 中实现浏览器内动态 TypeScript extension loading
- 在 v1 中补齐 Node/bash/file-system 工具能力
- 在 v1 中提供 Office.js 的完整权限确认和审批流程
- 在 v1 中完整解决多标签页冲突合并 UX

## 范围

### 范围内

- 统一的浏览器 Agent SDK 核心接口
- 统一的 LLM provider、storage provider、tool provider 边界
- runtime 内部 session graph、session codec 与 opaque storage document 方案
- session fork、manual compaction、steering、follow-up 的语义落地
- 与现有包兼容的公开导出收敛方案
- 以测试驱动方式逐步迁移现有实现

### 范围外

- Office.js 工具集合的完整业务实现
- 浏览器宿主的 UI 组件库或现成聊天界面
- 针对任意第三方后端的全量协议适配器矩阵
- 复杂的权限弹窗、审批策略、组织级安全治理功能

## 方案

采用三层结构：

1. **Core 层**：负责 agent loop、消息模型、tool 生命周期、steering 和 follow-up 语义。
2. **Runtime Session 层**：负责 session open/create/fork/delete、context rebuild、compaction、tool 装配和 system prompt 解析。
3. **Provider 层**：对外暴露 `LlmProvider`、`StorageProvider`、`ToolProvider`，并允许可选的 `PromptComposer` 与 `SessionDataCodec`。

Storage provider 不直接理解 `AgentMessage` 或 `SessionEntry` 语义，而只保存 opaque session document。runtime 内部再通过 codec 把该 document 解释成强类型 session graph。

行为上尽量对齐 pi：

- steering 在当前 turn 的 tool calls 完成后、下次模型调用前生效
- follow-up 在 agent 本该停止时才生效
- compaction 默认使用当前主模型
- tool hook 保留 `beforeToolCall` 和 `afterToolCall`

## 备选方案

| 备选方案                                                                  | 优点                           | 缺点                                                       | 放弃原因                            |
| ------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| 继续在现有 `UIMessage + ChatTransport + messages[] snapshot` 结构上补功能 | 改动表面较小                   | 边界不清，fork/compaction 会越来越难补                     | 只能延后问题，无法形成稳定 SDK 边界 |
| 让 storage provider 直接理解 `SessionEntry[]`                             | runtime 实现直接、类型信息完整 | storage provider 耦合 runtime 内部结构，扩展和后向兼容更差 | 不符合“简单 provider”目标           |
| 直接把 `pi-coding-agent` 整包移植到浏览器                                 | 能最大化复用现有行为           | Node/TUI/资源加载假设过重，浏览器端不现实                  | 宿主假设不匹配，迁移成本过高        |

## 风险与缓解

| 风险                                              | 发生概率 | 影响 | 缓解方式                                                       |
| ------------------------------------------------- | -------- | ---- | -------------------------------------------------------------- |
| 运行时重构范围过大，导致迁移中断                  | 中       | 高   | 采用 TDD，按 provider/session/core 三个切片逐步重构            |
| 与 pi 的行为语义出现偏差                          | 中       | 高   | 在不确定处明确参考 `packages/agent` 和 `packages/coding-agent` |
| storage 抽象过度简化，导致 fork/compaction 难实现 | 中       | 高   | 将 runtime 内部 graph 和 codec 作为正式设计的一部分            |
| 对现有导出和测试影响较大                          | 高       | 中   | 保留过渡适配层，并先补回归测试再重构                           |

## 依赖

- `docs/browser-agent-sdk-interface-draft.md`
- `pi-mono/packages/agent`
- `pi-mono/packages/coding-agent`
- 现有 `vitest` 测试体系
- 当前 `web-agent-runtime` 导出入口与已有测试文件

## 成功指标

| 指标                                                | 当前状态 | 目标状态 | 衡量方式                            |
| --------------------------------------------------- | -------- | -------- | ----------------------------------- |
| 核心运行时是否脱离 `UIMessage` 作为唯一内部消息模型 | 否       | 是       | 新核心类型与运行时测试              |
| storage 是否只需理解 opaque session data            | 否       | 是       | `StorageProvider` 接口与 codec 测试 |
| 是否支持 fork、compaction、steering、follow-up      | 否       | 是       | 行为测试与集成测试                  |
| 是否按 TDD 交付                                     | 未要求   | 是       | 任务执行记录和新增测试先于实现提交  |
| 是否能作为浏览器嵌入式 SDK 暴露统一 provider 接口   | 否       | 是       | 公开类型与创建 runtime 的接口测试   |

## 待确认问题

- [ ] v1 是否需要交付自动 compaction 触发策略，还是先提供手动 `compact()` API 并预留自动策略接口？
- [ ] 现有 `ai` SDK 风格的 LLM 适配器是否作为迁移过渡层保留到 v1，还是直接迁移到统一 `LlmProvider` 接口？

## 参考资料

- [浏览器 Agent SDK 接口草案](../../../docs/browser-agent-sdk-interface-draft.md)
- `pi-mono/packages/agent`
- `pi-mono/packages/coding-agent`
