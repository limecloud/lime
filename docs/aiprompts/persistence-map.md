# Runtime Persistence Map

本文件定义 Lime 当前与 Claude Code 持久化对齐相关的单一事实源，重点回答：

- 线程里的文件快照到底从哪里来
- `SessionDetail / thread_read / export / replay` 各自应该消费哪层事实
- 哪些路径属于 current，哪些只是 sidecar 或兼容辅助层

## Current 主链

当前文件持久化主链固定为：

`runtime_turn ArtifactSnapshot -> AgentTimeline FileArtifact -> artifact_document_service sidecar versions -> SessionDetail / AgentRuntimeThreadReadModel / agent_runtime_* -> evidence / replay`

含义如下：

1. `RuntimeAgentEvent::ArtifactSnapshot` 是运行时写入文件快照的唯一事件入口
2. 时间线里的 `AgentThreadItemPayload::FileArtifact` 是线程侧唯一事实源
3. `artifact_document_service` 负责把当前文档与 `versions/vNNNN.artifact.json` 历史快照落到工作区 sidecar
4. `AgentRuntimeThreadReadModel.file_checkpoint_summary` 只做轻量摘要，不复制第二套 transcript
5. 深一点的读取统一走：
   - `agent_runtime_list_file_checkpoints`
   - `agent_runtime_get_file_checkpoint`
   - `agent_runtime_diff_file_checkpoint`
6. `runtime_evidence_pack_service` 与 `runtime_replay_case_service` 统一消费同一份 file checkpoint 读模型，不再各自重新解析 artifact 状态

## 事实源分层

### 1. Timeline facts

文件：

- `src-tauri/src/services/agent_timeline_service.rs`
- `src-tauri/crates/core/src/database/dao/agent_timeline.rs`

职责：

- 记录线程里“有哪份文件快照”
- 保留 `path / source / content / metadata`
- 为 `SessionDetail.items` 与 `thread_read` 提供稳定事实

约束：

- 不再为“文件持久化”新增第二套并列事件模型
- 不从 UI 状态反写 timeline 真相

### 2. Sidecar snapshot store

文件：

- `src-tauri/src/services/artifact_document_service.rs`

职责：

- 把当前 artifact 文档落到工作区
- 维护 `artifactVersion*` metadata 与历史 `versions/` 快照
- 提供 `artifactVersionDiff / artifactVersions / artifactDocument / previewText`

约束：

- sidecar 负责详情补充，不单独定义 thread 真相
- 当前 / 历史版本路径都必须继续走工作区相对路径

### 3. Runtime read models

文件：

- `src-tauri/src/services/runtime_file_checkpoint_service.rs`
- `src-tauri/src/commands/aster_agent_cmd/dto.rs`
- `src/lib/api/agentRuntime/threadClient.ts`

职责：

- 把 `FileArtifact + metadata + sidecar snapshot` 收敛成统一读模型
- 在线程面板暴露“最近文件快照”摘要
- 给前端、导出与后续治理提供稳定命令边界

约束：

- `thread_read` 只保留轻摘要
- list / detail / diff 复用同一 service，不在各个导出服务重复解析

## Export / Replay 消费口径

文件：

- `src-tauri/src/services/runtime_evidence_pack_service.rs`
- `src-tauri/src/services/runtime_replay_case_service.rs`

当前约束：

1. `runtime.json` 与 `artifacts.json` 必须带 `fileCheckpoints / fileCheckpointCount`
2. replay `input.json` 必须带 `fileCheckpoints / fileCheckpointCount`
3. `recentArtifacts` 继续保留，用于路径级快速摘要；`fileCheckpoints` 才是正式快照读模型

## 非 current 路径

以下不再视为文件持久化 current 主链：

- 组件本地推导的 artifact 状态
- 额外维护一套 Claude Code 式 transcript 文件真相
- analysis / replay / review 各自单独扫描工作区再猜“最新版本”

如果需要补持久化能力，优先继续扩展：

- `runtime_file_checkpoint_service`
- `AgentRuntimeThreadReadModel.file_checkpoint_summary`
- `agent_runtime_*file_checkpoint*` 命令边界

而不是再开平级旁路。
