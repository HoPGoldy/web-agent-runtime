# 浏览器 Agent SDK V1 - 任务清单

> **状态**: 全部阶段已完成
> **设计文档**: [design.md](./design.md)
> **开始日期**: 2026-04-09
> **目标完成日期**: 2026-04-16

---

## 🎛️ 执行模式 (AI Agent 必读)

**支持三种执行模式，用户可自由选择：**

| 模式                | 触发词                            | 行为                         |
| ------------------- | --------------------------------- | ---------------------------- |
| **单步模式** (默认) | "开始执行"、"start"               | 执行一个任务，等待确认，重复 |
| **批量模式**        | "全部执行"、"一口气执行"、"batch" | 连续执行所有任务，最后汇报   |
| **阶段模式**        | "执行第一阶段"、"execute setup"   | 执行一个阶段的任务，然后等待 |

**所有模式必须遵守：**

1. ✅ 严格按顺序执行 - 从第一个 `- [ ]` 开始
2. ✅ 检查依赖 - 执行前确认依赖任务已完成 (`- [x]`)
3. ✅ 更新状态 - 完成后将 `- [ ]` 改为 `- [x]`
4. ✅ 报告进度 - 显示 (N/Total)
5. ✅ 遇错即停 - 出错时立即停止，等待用户指示

**额外约束：** 6. ✅ 采用 TDD - 每个功能切片先写失败测试，再写实现 7. ✅ 不确定行为优先参考 `pi-mono/packages/agent` 和 `pi-mono/packages/coding-agent`

**禁止行为：**

- ❌ 跳过任务
- ❌ 不按顺序执行
- ❌ 执行任务列表之外的工作
- ❌ 出错后继续执行
- ❌ 在没有失败测试的情况下直接实现新行为

---

## 概览

| 阶段     | 任务数 | 已完成 | 进度     |
| -------- | ------ | ------ | -------- |
| 准备     | 2      | 2      | 100%     |
| 实现     | 12     | 12     | 100%     |
| 测试     | 2      | 2      | 100%     |
| 文档     | 2      | 2      | 100%     |
| **总计** | **18** | **18** | **100%** |

## 任务拆分

### 第一阶段：准备

- [x] **T-001**: 固化目标模块边界与导出基线
  - **复杂度**: 低
  - **文件**: `src/index.ts`, `docs/browser-agent-sdk-interface-draft.md`
  - **依赖**: 无
  - **说明**: 明确 provider、runtime、session codec 的公开边界，冻结当前迁移目标

- [x] **T-002**: 建立新的目标模块目录和占位导出
  - **复杂度**: 低
  - **文件**: `src/runtime/`, `src/session/`, `src/providers/`, `src/index.ts`
  - **依赖**: T-001
  - **说明**: 只创建结构和最小占位，不实现行为

### 第二阶段：核心实现

- [x] **T-010**: 先写失败测试，定义 runtime 内部 session graph 与 codec 行为
  - **复杂度**: 中
  - **文件**: `test/session-data-codec.test.ts`, `test/session-graph.test.ts`
  - **依赖**: T-002
  - **说明**: 覆盖 `RuntimeSessionData`、entry graph、serialize/deserialize 基线

- [x] **T-011**: 实现 runtime 内部 session graph 与 `SessionDataCodec`
  - **复杂度**: 中
  - **文件**: `src/session/session-types.ts`, `src/session/session-data-codec.ts`
  - **依赖**: T-010
  - **说明**: storage 只看 opaque document，runtime 保留强类型 graph

- [x] **T-012**: 先写失败测试，定义 `StorageProvider` 的 opaque session document 语义
  - **复杂度**: 中
  - **文件**: `test/storage-provider-contract.test.ts`, `test/indexed-db-agent-storage.test.ts`
  - **依赖**: T-011
  - **说明**: 覆盖 revision、load/save session data、冲突处理

- [x] **T-013**: 实现新的 storage provider 契约和默认浏览器适配
  - **复杂度**: 中
  - **文件**: `src/storage/storage-interface.ts`, `src/storage/indexed-db-agent-storage.ts`
  - **依赖**: T-012
  - **说明**: 从 `loadMessages/saveMessages` 迁移到 `loadSessionData/saveSessionData`

- [x] **T-014**: 先写失败测试，定义统一 `LlmProvider` 与 assistant stream normalization
  - **复杂度**: 中
  - **文件**: `test/llm-provider-contract.test.ts`, `test/create-ai-sdk-llm-caller.test.ts`
  - **依赖**: T-013
  - **说明**: 用现有 AI SDK 适配器作为过渡参考，但目标接口对齐新设计

- [x] **T-015**: 实现 `LlmProvider` 契约与兼容适配层
  - **复杂度**: 中
  - **文件**: `src/llm/llm-provider-interface.ts`, `src/llm/create-ai-sdk-llm-caller.ts`
  - **依赖**: T-014
  - **说明**: 输出统一 `AssistantStreamEvent`

- [x] **T-016**: 先写失败测试，定义 agent loop 的 prompt、tool、steering、follow-up 语义
  - **复杂度**: 高
  - **文件**: `test/agent-loop.test.ts`, `test/agent.test.ts`
  - **依赖**: T-015
  - **说明**: 语义不明确时参考 pi agent core 和 pi coding-agent

- [x] **T-017**: 实现浏览器版 agent loop 与 tool execution hooks
  - **复杂度**: 高
  - **文件**: `src/runtime/agent-loop.ts`, `src/tools/tool-interface.ts`, `src/agent.ts`
  - **依赖**: T-016
  - **说明**: 保留 `beforeToolCall` / `afterToolCall`、AbortSignal、partial update

- [x] **T-018**: 先写失败测试，定义 `AgentRuntime` 的 session 打开、创建、fork、重建行为
  - **复杂度**: 高
  - **文件**: `test/agent-runtime.test.ts`, `test/fork-session.test.ts`
  - **依赖**: T-017
  - **说明**: 覆盖 session 创建、打开、fork、context rebuild、状态同步

- [x] **T-019**: 实现 `AgentRuntime`、`RuntimeSession` 与 fork 流程
  - **复杂度**: 高
  - **文件**: `src/runtime/agent-runtime.ts`, `src/session/runtime-session.ts`, `src/index.ts`
  - **依赖**: T-018
  - **说明**: 统一对外对象 API 和内部 session orchestration

- [x] **T-020**: 先写失败测试，定义 compaction 语义与当前主模型策略
  - **复杂度**: 中
  - **文件**: `test/compaction.test.ts`, `test/agent-runtime.test.ts`
  - **依赖**: T-019
  - **说明**: 覆盖 manual compaction、compaction entry 持久化、rebuild 后继续运行

- [x] **T-021**: 实现 compaction 服务与 runtime 重建流程
  - **复杂度**: 中
  - **文件**: `src/runtime/compaction.ts`, `src/runtime/agent-runtime.ts`, `src/session/runtime-session.ts`
  - **依赖**: T-020
  - **说明**: 默认使用当前主模型，自动 compaction 是否首版交付取决于评审结果

### 第三阶段：测试

- [x] **T-030**: 补齐回归测试，覆盖 revision 冲突、codec 失败、tool abort 和非法 continue
  - **复杂度**: 中
  - **文件**: `test/agent-runtime-errors.test.ts`, `test/storage-provider-contract.test.ts`, `test/agent-loop.test.ts`
  - **依赖**: T-021
  - **说明**: 重点覆盖非 happy path

- [x] **T-031**: 跑完整测试套件并收敛失败项
  - **复杂度**: 中
  - **文件**: `test/**/*.ts`
  - **依赖**: T-030
  - **说明**: 不新增能力，只修复与本 spec 相关的失败

### 第四阶段：文档

- [x] **T-040**: 更新公开导出文档和接口使用说明
  - **复杂度**: 低
  - **文件**: `docs/browser-agent-sdk-interface-draft.md`, `src/index.ts`
  - **依赖**: T-031
  - **说明**: 确保文档与实际导出一致

- [x] **T-041**: 补充迁移说明与测试策略说明
  - **复杂度**: 低
  - **文件**: `docs/browser-agent-sdk-migration-plan.md`, `.spec-flow/active/browser-agent-sdk-v1/tasks.md`
  - **依赖**: T-040
  - **说明**: 说明旧结构如何过渡到新接口

## 进度跟踪

| 任务  | 状态      | 负责人         | 开始时间   | 完成时间   | 备注                                                          |
| ----- | --------- | -------------- | ---------- | ---------- | ------------------------------------------------------------- |
| T-001 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 固化根入口迁移边界并补充接口草案说明                          |
| T-002 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 建立 runtime/session/providers 占位模块与 namespaced 导出     |
| T-010 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 session graph 与 codec 失败测试，明确序列化与分支行为    |
| T-011 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 实现 `RuntimeSessionData`、entry graph 与 JSON codec          |
| T-012 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 storage provider 契约测试，覆盖 revision 与 session data |
| T-013 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 扩展 IndexedDB storage 支持 opaque session document           |
| T-014 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 LLM provider 兼容测试，定义统一 stream 事件              |
| T-015 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 实现 `LlmProvider` 契约与 AI SDK 兼容适配层                   |
| T-016 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 agent loop 行为测试，固定 prompt/tool/steering 语义      |
| T-017 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 实现浏览器 agent loop、tool hook 与旧 Agent 兼容收敛          |
| T-018 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 runtime/session/fork 测试，固定会话编排行为              |
| T-019 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 实现 `AgentRuntime`、`RuntimeSessionStore` 与 fork            |
| T-020 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 先写 compaction 测试，固定当前主模型摘要策略                  |
| T-021 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 实现 compaction 服务与 runtime 重建流程                       |
| T-030 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 补齐 revision、codec、abort、非法 continue 的错误路径回归测试 |
| T-031 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 运行完整测试套件并收敛到全绿                                  |
| T-040 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 对齐根导出、接口草案与当前 runtime SDK 实现                   |
| T-041 | ✅ 已完成 | GitHub Copilot | 2026-04-09 | 2026-04-09 | 补充迁移计划文档和测试策略说明                                |

**图例**:

- ⏳ 待开始
- 🔄 进行中
- ✅ 已完成
- ❌ 已阻塞
- ⏸️ 暂缓

## 依赖图

```mermaid
graph LR
    T001[T-001] --> T002[T-002]
    T002 --> T010[T-010]
    T010 --> T011[T-011]
    T011 --> T012[T-012]
    T012 --> T013[T-013]
    T013 --> T014[T-014]
    T014 --> T015[T-015]
    T015 --> T016[T-016]
    T016 --> T017[T-017]
    T017 --> T018[T-018]
    T018 --> T019[T-019]
    T019 --> T020[T-020]
    T020 --> T021[T-021]
    T021 --> T030[T-030]
    T030 --> T031[T-031]
    T031 --> T040[T-040]
    T040 --> T041[T-041]
```

## 阻塞项

| 阻塞项                                 | 影响任务     | 提出时间   | 负责人 | 状态     | 处理方式                    |
| -------------------------------------- | ------------ | ---------- | ------ | -------- | --------------------------- |
| 自动 compaction 是否进入 v1 范围待确认 | 后续版本规划 | 2026-04-09 | User   | 已转后续 | v1 先交付 manual compaction |

## 变更记录

| 日期       | 变更                 | 原因                                          |
| ---------- | -------------------- | --------------------------------------------- |
| 2026-04-09 | 初始化任务拆分       | 基于 fast mode spec-flow 生成                 |
| 2026-04-09 | 完成第一阶段准备任务 | 固化 SDK 迁移边界并建立目录骨架               |
| 2026-04-09 | 完成第二阶段核心实现 | 基于 TDD 完成 session/runtime/provider 主链路 |
| 2026-04-09 | 完成第三阶段测试收敛 | 补齐错误路径回归并完成全量测试验证            |
| 2026-04-09 | 完成第四阶段文档收尾 | 对齐根导出、接口草案与迁移计划文档            |

## 完成检查清单

在标记完成前：

- [x] 所有任务均标记为已完成
- [x] 所有测试通过
- [ ] 代码已评审
- [x] 文档已更新
- [ ] 如有需要，更新 changelog
- [ ] 已通知相关方
- [ ] Spec 已归档到 `.spec-flow/archive/browser-agent-sdk-v1/`
