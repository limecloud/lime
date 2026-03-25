# Tauri 命令边界

## 这份文档回答什么

本文件用于说明 Lime 中 Tauri 命令的工程边界，主要回答：

- 命令改动应该从哪里进入，而不是到处直接 `invoke`
- 哪些文件共同构成命令契约的事实源
- 新增、迁移、下线命令时，最低要同步哪些位置
- 怎样避免 compat / deprecated 路径重新长出新表面

## 推荐调用路径

前端业务代码**不应直接散落 `invoke`**。

推荐路径是：

`组件 / Hook -> src/lib/api/* 网关 -> safeInvoke -> Rust command`

这样做的目的不是“多包一层”，而是为了保证：

- 前端只有一个可治理的调用出口
- Rust 命令可以按 `current / compat / deprecated / dead-candidate` 演进
- 新旧命令并存时，迁移边界清晰，不会继续扩散
- 契约检查脚本能稳定扫描并阻止回流

## 命令契约的五个事实源

命令边界不是单文件事实，至少要同时看下面五处：

1. **前端实际调用**  
   `src/` 下运行时代码里的 `safeInvoke(...)` / `invoke(...)`

2. **Rust 实际注册**  
   `src-tauri/src/app/runner.rs` 中的 `tauri::generate_handler![...]`

3. **治理目录册**  
   `src/lib/governance/agentCommandCatalog.json`

4. **Bridge mock 优先集合**  
   `src/lib/dev-bridge/mockPriorityCommands.ts`

5. **默认 mock 实现**  
   `src/lib/tauri-mock/core.ts` 中的 `defaultMocks`

只看其中一侧都不够。只要能力仍然依赖命令边界，就至少要同时核对前端调用、Rust 注册、治理目录册、mock 集合这几面。

## 命令分类语言

命令治理统一沿用 `governance.md` 的分类语言：

- `current`：当前主路径，后续能力继续向这里收敛
- `compat`：兼容层，只允许委托、适配、告警，不允许长新逻辑
- `deprecated`：废弃层，只允许迁移与下线，不允许新增依赖
- `dead`：已停用或确认无入口，优先删除

脚本或治理报告里还可能看到：

- `dead-candidate`

它表示“删除候选信号”，不是自动等于 `dead`。

如果本次改动说不清自己属于哪一类，先不要写代码，先读 `docs/aiprompts/governance.md`。

## 新增或改命令的标准步骤

### 1. 先判断是不是应该新增命令

先问三个问题：

- 当前需求能不能落到已有 `current` 主链？
- 这次是补能力，还是只是在给 compat 层续命？
- 有没有已经存在但尚未收口的旧入口？

如果答案是“已有主链可承接”，优先补现有主链，不再新开平级命令。

### 2. 前端只从 API 网关进入

- 在 `src/lib/api/*` 下新增或扩展对应网关
- 页面、组件、普通 Hook 不要直接调用裸 `invoke`
- 尽量把命令名、参数整理、返回类型都收在网关层

推荐写法：

```typescript
// src/lib/api/serverRuntime.ts
import { safeInvoke } from "@/lib/dev-bridge";

export async function getServerStatus() {
  return safeInvoke<ServerStatus>("get_server_status");
}
```

业务层只消费网关：

```typescript
import { getServerStatus } from "@/lib/api/serverRuntime";

const status = await getServerStatus();
```

### 3. Rust 命令与注册表同步

- 在 `src-tauri/src/commands/` 下落到对应模块
- 在 `src-tauri/src/app/runner.rs` 的 `tauri::generate_handler!` 中注册
- 不要只写命令实现，不补注册

### 4. 治理目录册与 mock 同步

命令边界发生变化时，按需同步：

- `src/lib/governance/agentCommandCatalog.json`
- `src/lib/dev-bridge/mockPriorityCommands.ts`
- `src/lib/tauri-mock/core.ts`

尤其是以下场景：

- 新命令属于 runtime gateway
- 旧命令进入 `deprecated`
- 旧 helper 被替换
- Bridge 优先命令需要本地 mock

### 5. 文档同步

至少同步更新：

- 本文档 `docs/aiprompts/commands.md`
- `docs/aiprompts/quality-workflow.md`
- 如涉及 GUI 续测，再看 `docs/aiprompts/playwright-e2e.md`

### 6. 跑最低校验

至少运行：

```bash
npm run test:contracts
```

必要时补：

```bash
npm run governance:legacy-report
npm run verify:local
```

如果命令边界改动影响会话运行时恢复语义，例如：

- `agent_runtime_update_session` 新增或调整 `provider_name / model_name / execution_strategy`
- 话题切换时的 provider/model 恢复从本地 fallback 向 `execution_runtime` 收敛

除了契约检查，还应补对应 Hook / UI 稳定回归，确认切换话题后模型选择器恢复的是会话 runtime，而不是陈旧本地缓存。

## 变更完成定义

一次命令边界改动，至少满足以下条件才算完成：

1. 前端调用已经收口到 `src/lib/api/*`
2. Rust 命令已在 `runner.rs` 注册
3. `agentCommandCatalog.json` 中的治理口径已同步
4. `mockPriorityCommands` 与 `defaultMocks` 没有漂移
5. `npm run test:contracts` 通过
6. 涉及 compat / deprecated 的改动，已补 `governance:legacy-report` 或明确说明不需要

## 自动化 `agent_turn` 负载补充约定

当 `create_automation_job` / `update_automation_job` 的 `payload.kind = "agent_turn"` 用于持续产出交付物时，允许并推荐透传以下字段：

- `content_id`：绑定长期内容主线，供自动化版本持续沉淀到同一交付链
- `request_metadata`：与运行时 turn 保持同合同，至少可包含 `artifact` 与 `harness` 两层

推荐形态：

- `request_metadata.artifact`：`artifact_mode / artifact_kind / artifact_stage / workbench_surface`
- `request_metadata.harness`：`theme / session_mode / content_id`

这样做的目的不是给自动化新增第二套协议，而是让自动化直接复用现有 runtime turn 的 Artifact 主链。

## 明确禁止

- 在页面、组件、普通 Hook 中直接散落 `invoke`
- 给 `compat` 路径继续长新业务逻辑
- 把已经进入 `deprecated` / `dead-candidate` / `dead` 的命令重新接回主链
- 只改前端或只改 Rust，一侧通过就宣布完成
- 用“先兼容一下”作为长期保留第二套入口的理由

## 当前主链示例

以下是仓库当前已经明确收敛的几个方向：

- **Agent / Codex 主命令**：继续收敛到 `agent_runtime_*`
- **会话状态回写主链**：继续收敛到 `agent_runtime_update_session`，用于名称、执行策略以及 session provider/model 的轻量持久化回写
- **运行态摘要主链**：Aster `runtime_status` item -> timeline `turn_summary`
- **旧 `chat_*` 命令**：已停止注册，不应重新回到 `commands::mod` 或 `generate_handler!`
- **旧 `general_chat_*` 边界**：前端 compat 网关与 Rust 命令都已移除，不应重新接入
- **记忆系统**：统一沉淀优先走 `unified_memory_*`，runtime / 上下文视图优先走 `memory_runtime_*`

这些示例的意义不是列清单，而是提醒：

**不要再造第三套入口，优先继续把能力收敛到已存在的主链。**

## 相关检查脚本

```bash
# 命令契约检查
npm run test:contracts

# 旧边界与死链收口
npm run governance:legacy-report

# 本地统一校验
npm run verify:local
```

## 相关文档

- `docs/aiprompts/governance.md`
- `docs/aiprompts/quality-workflow.md`
- `docs/aiprompts/credential-pool.md`
