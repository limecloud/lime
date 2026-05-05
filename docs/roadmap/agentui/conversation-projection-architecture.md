# AgentUI 对话投影架构

> 状态：current planning source
> 更新时间：2026-05-05
> 范围：`src/components/agent/chat` 对话 UI、状态投影、旧会话恢复、流式显示、MessageList 渲染与性能排查。

## 1. 事实源声明

本计划不新增 Lime 底层运行事实源。底层事实源继续以 `docs/roadmap/warp` 为准：

```text
Agent runtime identity
  -> ModalityRuntimeContract
  -> Capability Matrix
  -> Execution Profile
  -> Artifact Graph
  -> Evidence / Replay / Task Index
```

AgentUI 对话层只做 UI 投影：

```text
agent_runtime_* / thread_read / runtime event / artifact graph
  -> Conversation Projection Store
  -> Session / Stream / Queue / Render controllers
  -> React selectors
  -> UI
```

固定约束：

1. `Conversation Projection Store` 不是 runtime owner。
2. UI 层不写 `ModalityRuntimeContract`、`ExecutionProfile`、`ArtifactGraph`、Evidence。
3. `@` 命令、button、Scene 仍只是 Warp `entry_binding`，不是对话层事实源。
4. viewer / MessageList 不允许从文本猜 artifact kind；必须消费 artifact graph、thread read 或 task index。
5. Agent loop、tool protocol、permission、slash command 继续优先参考 ClaudeCode；execution profile、artifact graph、LimeCore policy、task index 继续优先参考 Warp。

## 2. 当前痛点

当前对话主链已经拆出不少文件，但职责仍堆叠：

| Surface | 当前问题 | 目标 |
| --- | --- | --- |
| `AgentChatWorkspace` | 布局、tab、发送、workspace、artifact、task、性能分支混在一起 | 只做 workspace shell 与 panel 编排 |
| `useAgentSession` | session lifecycle、topic list、hydrate、cache、metadata sync、tab 恢复交织 | 拆成 lifecycle / hydration / list / persistence controller |
| `useAgentStream` 及 stream helpers | submit、listener、queue、runtime event、render flush 仍耦合 | 拆成 stream submission / event reducer / queue |
| `MessageList` | 同步构建 timeline、message group、artifact/tool 展示 | 只消费预投影的 render model |
| 旧会话恢复 | detail、timeline、sidebar、MessageList 可能同时抢主线程或 invoke | shell / cache / recent messages 先显示，重投影后台化 |

问题不是“文件不够多”，而是事实源、投影、控制器、UI 边界不够清晰。

## 3. 目标分层

```text
AgentChatWorkspace
  AgentWorkspaceShell
    SessionChrome
    ConversationPane
    WorkbenchPane
    ProcessDrawer

Conversation Projection Store
  sessionSlice
  streamSlice
  queueSlice
  renderSlice
  diagnosticsSlice

Controllers
  sessionLifecycleController
  sessionHydrationController
  topicListController
  sessionPersistenceController
  streamSubmissionController
  streamEventReducer
  streamQueueController
  messageRenderProjection
```

职责边界：

| 层 | 允许做 | 禁止做 |
| --- | --- | --- |
| Runtime / Bridge | 产生 session、thread、turn、runtime event、artifact、evidence | 依赖 React UI 状态 |
| Projection Store | 缓存 UI 需要的轻量状态和引用 | 成为新的 runtime / artifact / evidence 事实源 |
| Controllers | 把 runtime 事实折叠成 UI action | 直接渲染组件或写 UI 样式 |
| Selectors | 选择切片、构建轻量 render model | 返回新对象导致无关重渲染 |
| UI | 展示、交互、打开 panel / viewer | 推断底层合同、直接写 artifact/evidence |

## 4. 数据流

### 4.1 新会话首轮发送

```text
Home/Inputbar
  -> streamSubmissionController.prepare
  -> sessionLifecycleController.ensureSession
  -> Projection Store: shell + waiting status
  -> bind runtime listener
  -> agent_runtime_submit_turn
  -> streamEventReducer
  -> renderSlice first status / first text
  -> MessageList render model
```

首字慢必须能拆到这些阶段：

1. `ensureSession.start / done`
2. `listener.bound`
3. `submitTurn.dispatched / accepted`
4. `firstEvent`
5. `firstRuntimeStatus`
6. `firstTextDelta`
7. `firstTextPaint`

### 4.2 打开旧会话

```text
Topic click
  -> sessionLifecycleController.switchSession
  -> Projection Store: target shell
  -> cached snapshot / recent messages
  -> getSession(historyLimit)
  -> message render projection
  -> timeline / tool / artifact projection idle hydrate
```

旧会话首帧不等待完整 detail、timeline、artifact preview、sidebar list。

### 4.3 Artifact 展示

```text
runtime event / thread_read / task index
  -> artifact graph reference
  -> render projection artifact summary
  -> MessageList card / Workbench viewer
```

MessageList 只能展示摘要和入口；完整编辑、预览、diff、保存进入 Workbench / viewer。

## 5. 与 Warp 的关系

本计划是 Warp 路线图的 UI / projection 子计划。

| Warp 事实源 | AgentUI 消费方式 |
| --- | --- |
| `agent_runtime_identity` | render model 保留 session/thread/turn/task 引用 |
| `modality_runtime_contract` | UI 展示 contract key，不创建或改写 contract |
| `execution_profile` | capsule / status / diagnostics 展示 profile 摘要 |
| `domain_artifact_graph` | artifact card / viewer 只读 graph |
| `evidence_pack` | harness panel / replay 入口只读 evidence |
| `entry_binding` | `@` / button / Scene 只作为启动 metadata |

如果某个 UI 优化需要绕过这些事实源才能工作，它不能进入 current 主线。

## 6. 非目标

短期不做：

1. 不新增第二套 event bus。
2. 不把 Pi 的 JSONL/RPC 作为 Lime 新协议。
3. 不把 artifact / evidence 事实塞回 MessageList。
4. 不为了拆文件新增平行 compat 组件。
5. 不把视觉重做、协议重构、store 重构混在同一刀。
